import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppError, ErrorCodes } from './errors.js';
import type {
  DatasetInput,
  PublishReport,
  PublishedRow,
} from './types.js';

export interface VersionRow {
  id: number;
  datasetId: number;
  versionNo: number;
  name: string;
  k: number;
  qiFields: string[];
  records: DatasetInput['records'];
  hierarchies: DatasetInput['hierarchies'];
  maxLevels: Record<string, number> | null;
  note: string;
  createdAt: string;
}

export interface PublicationRow {
  id: number;
  versionId: number;
  vector: number[];
  loss: number;
  k: number;
  publishedTable: PublishedRow[];
  report: PublishReport;
  createdAt: string;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS datasets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dataset_id INTEGER NOT NULL REFERENCES datasets(id),
        version_no INTEGER NOT NULL,
        name TEXT NOT NULL,
        k INTEGER NOT NULL,
        qi_fields TEXT NOT NULL,
        records TEXT NOT NULL,
        hierarchies TEXT NOT NULL,
        max_levels TEXT,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(dataset_id, version_no)
      );
      CREATE TABLE IF NOT EXISTS solutions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id INTEGER NOT NULL UNIQUE REFERENCES versions(id),
        vector TEXT,
        loss INTEGER,
        feasible INTEGER NOT NULL,
        feasible_vector_count INTEGER NOT NULL,
        group_summary TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS publications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id INTEGER NOT NULL REFERENCES versions(id),
        vector TEXT NOT NULL,
        loss INTEGER NOT NULL,
        k INTEGER NOT NULL,
        published_table TEXT NOT NULL,
        report TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  /** 新建数据集 */
  createDataset(name: string): number {
    const stmt = this.db.prepare('INSERT INTO datasets (name) VALUES (?)');
    const info = stmt.run(name);
    return Number(info.lastInsertRowid);
  }

  getDatasetId(datasetId: number): { id: number; name: string } | null {
    const row = this.db
      .prepare('SELECT id, name FROM datasets WHERE id = ?')
      .get(datasetId) as { id: number; name: string } | undefined;
    return row ?? null;
  }

  /**
   * 保存一个版本。datasetId 为空则新建数据集；
   * 已存在则追加新版本（version_no 递增），旧版本与报告保留。
   */
  saveVersion(
    input: DatasetInput,
    datasetId: number | null,
    note = '',
  ): { datasetId: number; versionId: number; versionNo: number } {
    const run = () => {
      let dsId = datasetId;
      if (dsId === null) {
        dsId = this.createDataset(input.name);
      } else if (!this.getDatasetId(dsId)) {
        throw new AppError(
          ErrorCodes.NOT_FOUND,
          `数据集 ${datasetId} 不存在`,
        );
      }
      const maxRow = this.db
        .prepare('SELECT COALESCE(MAX(version_no), 0) AS m FROM versions WHERE dataset_id = ?')
        .get(dsId) as { m: number };
      const versionNo = maxRow.m + 1;
      const info = this.db
        .prepare(
          `INSERT INTO versions
            (dataset_id, version_no, name, k, qi_fields, records, hierarchies, max_levels, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          dsId,
          versionNo,
          input.name,
          input.k,
          JSON.stringify(input.quasiIdentifiers),
          JSON.stringify(input.records),
          JSON.stringify(input.hierarchies),
          input.maxLevels ? JSON.stringify(input.maxLevels) : null,
          note,
        );
      return {
        datasetId: dsId!,
        versionId: Number(info.lastInsertRowid),
        versionNo,
      };
    };
    return this.withTransaction(run);
  }

  getVersion(versionId: number): VersionRow | null {
    const row = this.db
      .prepare('SELECT * FROM versions WHERE id = ?')
      .get(versionId) as
      | {
          id: number;
          dataset_id: number;
          version_no: number;
          name: string;
          k: number;
          qi_fields: string;
          records: string;
          hierarchies: string;
          max_levels: string | null;
          note: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      datasetId: row.dataset_id,
      versionNo: row.version_no,
      name: row.name,
      k: row.k,
      qiFields: JSON.parse(row.qi_fields) as string[],
      records: JSON.parse(row.records) as DatasetInput['records'],
      hierarchies: JSON.parse(row.hierarchies) as DatasetInput['hierarchies'],
      maxLevels: row.max_levels
        ? (JSON.parse(row.max_levels) as Record<string, number>)
        : null,
      note: row.note,
      createdAt: row.created_at,
    };
  }

  listVersions(datasetId: number): Array<{
    versionId: number;
    versionNo: number;
    name: string;
    k: number;
    createdAt: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, version_no, name, k, created_at FROM versions
         WHERE dataset_id = ? ORDER BY version_no`,
      )
      .all(datasetId) as Array<{
      id: number;
      version_no: number;
      name: string;
      k: number;
      created_at: string;
    }>;
    return rows.map((r) => ({
      versionId: r.id,
      versionNo: r.version_no,
      name: r.name,
      k: r.k,
      createdAt: r.created_at,
    }));
  }

  /** 保存（或更新）最优方案摘要 */
  saveSolution(
    versionId: number,
    data: {
      vector: number[] | null;
      loss: number | null;
      feasible: boolean;
      feasibleVectorCount: number;
      groupSummary: unknown;
    },
  ): void {
    this.withTransaction(() => {
      this.db.prepare('DELETE FROM solutions WHERE version_id = ?').run(versionId);
      this.db
        .prepare(
          `INSERT INTO solutions
            (version_id, vector, loss, feasible, feasible_vector_count, group_summary)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          data.vector ? JSON.stringify(data.vector) : null,
          data.loss,
          data.feasible ? 1 : 0,
          data.feasibleVectorCount,
          JSON.stringify(data.groupSummary),
        );
    });
  }

  getSolution(versionId: number): unknown | null {
    const row = this.db
      .prepare('SELECT * FROM solutions WHERE version_id = ?')
      .get(versionId) as
      | {
          vector: string | null;
          loss: number | null;
          feasible: number;
          feasible_vector_count: number;
          group_summary: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      vector: row.vector ? (JSON.parse(row.vector) as number[]) : null,
      loss: row.loss,
      feasible: row.feasible === 1,
      feasibleVectorCount: row.feasible_vector_count,
      groupSummary: JSON.parse(row.group_summary),
      createdAt: row.created_at,
    };
  }

  /**
   * 事务化保存发布表与核验报告：两者要么同时提交，要么都不留存。
   * 调用前必须已确认可行，这里仍作为原子写保护。
   */
  savePublication(
    versionId: number,
    data: {
      vector: number[];
      loss: number;
      k: number;
      publishedTable: PublishedRow[];
      report: PublishReport;
    },
  ): number {
    return this.withTransaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO publications
            (version_id, vector, loss, k, published_table, report)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          JSON.stringify(data.vector),
          data.loss,
          data.k,
          JSON.stringify(data.publishedTable),
          JSON.stringify(data.report),
        );
      return Number(info.lastInsertRowid);
    });
  }

  getPublication(publicationId: number): PublicationRow | null {
    const row = this.db
      .prepare('SELECT * FROM publications WHERE id = ?')
      .get(publicationId) as
      | {
          id: number;
          version_id: number;
          vector: string;
          loss: number;
          k: number;
          published_table: string;
          report: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      versionId: row.version_id,
      vector: JSON.parse(row.vector) as number[],
      loss: row.loss,
      k: row.k,
      publishedTable: JSON.parse(row.published_table) as PublishedRow[],
      report: JSON.parse(row.report) as PublishReport,
      createdAt: row.created_at,
    };
  }

  listPublications(versionId: number): Array<{
    id: number;
    vector: number[];
    loss: number;
    createdAt: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, vector, loss, created_at FROM publications
         WHERE version_id = ? ORDER BY id`,
      )
      .all(versionId) as Array<{
      id: number;
      vector: string;
      loss: number;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      vector: JSON.parse(r.vector) as number[],
      loss: r.loss,
      createdAt: r.created_at,
    }));
  }

  private withTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // 忽略回滚错误，抛出原始异常
      }
      throw err;
    }
  }
}
