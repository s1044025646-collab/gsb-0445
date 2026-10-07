import { DatabaseSync } from 'node:sqlite';
import {
  evaluateVector,
  generalizeRecord,
  searchOptimal,
  validateConstraints,
  validateDataset,
  validateHierarchies,
  ValidatedHierarchies,
} from './core';
import { ApiError } from './errors';
import { DatasetInput, EvalResult, RecordInput } from './types';

export class KanonService {
  constructor(private db: DatabaseSync) {}

  /** 保存数据集新版本（同一数据集修订输入即产生新版本） */
  createVersion(input: DatasetInput, datasetId?: number): { datasetId: number; versionId: number; versionNo: number } {
    const vh = validateHierarchies(input.fields, input.hierarchies);
    validateDataset(input.fields, input.records, input.k, vh);
    const constraints = validateConstraints(input.fields, vh, input.constraints ?? {});

    this.db.exec('BEGIN');
    try {
      let dsId = datasetId;
      if (dsId === undefined) {
        const r = this.db
          .prepare('INSERT INTO datasets(name) VALUES (?)')
          .run(input.name ?? '未命名数据集');
        dsId = Number(r.lastInsertRowid);
      } else {
        const row = this.db.prepare('SELECT id FROM datasets WHERE id=?').get(dsId);
        if (!row) throw new ApiError('NOT_FOUND', `数据集 ${dsId} 不存在`);
      }
      const prev = this.db
        .prepare('SELECT MAX(version_no) AS v FROM versions WHERE dataset_id=?')
        .get(dsId) as { v: number | null };
      const versionNo = (prev.v ?? 0) + 1;
      const vr = this.db
        .prepare(
          'INSERT INTO versions(dataset_id, version_no, fields_json, k, constraints_json, hierarchies_json) VALUES (?,?,?,?,?,?)'
        )
        .run(
          dsId,
          versionNo,
          JSON.stringify(input.fields),
          input.k,
          JSON.stringify(constraints),
          JSON.stringify(input.hierarchies)
        );
      const versionId = Number(vr.lastInsertRowid);
      const ins = this.db.prepare('INSERT INTO records(version_id, row_id, values_json) VALUES (?,?,?)');
      for (const rec of input.records) {
        ins.run(versionId, rec.rowId, JSON.stringify(rec.values));
      }
      this.db.exec('COMMIT');
      return { datasetId: dsId, versionId, versionNo };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  private loadVersion(versionId: number): {
    fields: string[];
    k: number;
    constraints: Record<string, number>;
    vh: ValidatedHierarchies;
    records: RecordInput[];
  } {
    const v = this.db.prepare('SELECT * FROM versions WHERE id=?').get(versionId) as
      | { fields_json: string; k: number; constraints_json: string; hierarchies_json: string }
      | undefined;
    if (!v) throw new ApiError('NOT_FOUND', `版本 ${versionId} 不存在`);
    const fields = JSON.parse(v.fields_json) as string[];
    const hierarchies = JSON.parse(v.hierarchies_json);
    const vh = validateHierarchies(fields, hierarchies);
    const rows = this.db
      .prepare('SELECT row_id, values_json FROM records WHERE version_id=? ORDER BY row_id')
      .all(versionId) as { row_id: string; values_json: string }[];
    const records = rows.map((r) => ({ rowId: r.row_id, values: JSON.parse(r.values_json) }));
    return {
      fields,
      k: v.k,
      constraints: JSON.parse(v.constraints_json),
      vh,
      records,
    };
  }

  /** 输入检查 */
  validate(versionId: number) {
    const ctx = this.loadVersion(versionId);
    validateDataset(ctx.fields, ctx.records, ctx.k, ctx.vh);
    return { ok: true, rows: ctx.records.length, fields: ctx.fields, k: ctx.k, constraints: ctx.constraints };
  }

  /** 搜索最优方案并保存报告 */
  search(versionId: number, overrideConstraints?: Record<string, number>) {
    const ctx = this.loadVersion(versionId);
    const constraints = overrideConstraints
      ? validateConstraints(ctx.fields, ctx.vh, overrideConstraints)
      : ctx.constraints;
    const result = searchOptimal(ctx.fields, ctx.records, ctx.vh, ctx.k, constraints);
    const reportId = this.saveReport(versionId, 'search', result);
    return { ...result, reportId, constraints };
  }

  /** 查询等价组 */
  groups(versionId: number, vector: number[]) {
    const ctx = this.loadVersion(versionId);
    return evaluateVector(ctx.fields, ctx.records, ctx.vh, ctx.k, vector);
  }

  /** 核验外部指定层级向量：重新分组并列出不满足 k 的实际小组 */
  verify(versionId: number, vector: number[]) {
    const ctx = this.loadVersion(versionId);
    const result = evaluateVector(ctx.fields, ctx.records, ctx.vh, ctx.k, vector);
    const reportId = this.saveReport(versionId, 'verify', result);
    return { ...result, reportId };
  }

  /** 比较多组限制下的搜索结果 */
  compareConstraints(versionId: number, sets: { name: string; constraints: Record<string, number> }[]) {
    const ctx = this.loadVersion(versionId);
    return sets.map((s) => {
      try {
        const constraints = validateConstraints(ctx.fields, ctx.vh, s.constraints);
        const r = searchOptimal(ctx.fields, ctx.records, ctx.vh, ctx.k, constraints);
        return { name: s.name, feasible: true, vector: r.vector, loss: r.loss };
      } catch (e) {
        if (e instanceof ApiError && e.code === 'NO_FEASIBLE_SOLUTION') {
          return { name: s.name, feasible: false, reason: e.message };
        }
        throw e;
      }
    });
  }

  private saveReport(versionId: number, kind: string, result: EvalResult): number {
    const mapping: Record<string, string> = {};
    for (const g of result.groups) {
      for (const rowId of g.rowIds) mapping[rowId] = g.key;
    }
    const r = this.db
      .prepare(
        'INSERT INTO reports(version_id, kind, vector_json, loss, feasible, groups_json, mapping_json) VALUES (?,?,?,?,?,?,?)'
      )
      .run(
        versionId,
        kind,
        JSON.stringify(result.vector),
        result.loss,
        result.feasible ? 1 : 0,
        JSON.stringify(result.groups),
        JSON.stringify(mapping)
      );
    return Number(r.lastInsertRowid);
  }

  /**
   * 导出发布表（事务化）：先核验可行性，同一事务内写报告与发布表。
   * 发布表只含泛化后的准标识字段，不含内部行编号。
   */
  publish(versionId: number, vector: number[]) {
    const ctx = this.loadVersion(versionId);
    const result = evaluateVector(ctx.fields, ctx.records, ctx.vh, ctx.k, vector);
    if (!result.feasible) {
      throw new ApiError('INFEASIBLE_VECTOR', '该层级向量不满足 k 匿名，拒绝发布', {
        violatingGroups: result.violatingGroups.map((g) => ({ key: g.key, size: g.size })),
      });
    }
    this.db.exec('BEGIN');
    try {
      const reportId = this.saveReport(versionId, 'publish', result);
      const rows = ctx.records.map((rec) =>
        generalizeRecord(ctx.fields, rec.values, ctx.vh, vector)
      );
      this.db
        .prepare(
          'INSERT INTO published(version_id, vector_json, rows_json, report_id) VALUES (?,?,?,?) ' +
            'ON CONFLICT(version_id) DO UPDATE SET vector_json=excluded.vector_json, rows_json=excluded.rows_json, report_id=excluded.report_id, created_at=datetime(\'now\')'
        )
        .run(versionId, JSON.stringify(vector), JSON.stringify(rows), reportId);
      this.db.exec('COMMIT');
      return { reportId, rows, vector, loss: result.loss };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  getPublished(versionId: number) {
    const row = this.db
      .prepare('SELECT * FROM published WHERE version_id=?')
      .get(versionId) as { vector_json: string; rows_json: string; report_id: number } | undefined;
    if (!row) throw new ApiError('NOT_FOUND', `版本 ${versionId} 尚未发布`);
    return {
      vector: JSON.parse(row.vector_json),
      rows: JSON.parse(row.rows_json),
      reportId: row.report_id,
    };
  }

  getReport(reportId: number) {
    const row = this.db.prepare('SELECT * FROM reports WHERE id=?').get(reportId) as
      | {
          id: number;
          version_id: number;
          kind: string;
          vector_json: string;
          loss: number;
          feasible: number;
          groups_json: string;
          mapping_json: string;
          created_at: string;
        }
      | undefined;
    if (!row) throw new ApiError('NOT_FOUND', `报告 ${reportId} 不存在`);
    return {
      id: row.id,
      versionId: row.version_id,
      kind: row.kind,
      vector: JSON.parse(row.vector_json),
      loss: row.loss,
      feasible: row.feasible === 1,
      groups: JSON.parse(row.groups_json),
      mapping: JSON.parse(row.mapping_json),
      createdAt: row.created_at,
    };
  }

  listVersions(datasetId: number) {
    return this.db
      .prepare('SELECT id, version_no, k, created_at FROM versions WHERE dataset_id=? ORDER BY version_no')
      .all(datasetId);
  }
}
