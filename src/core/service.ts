import { Store, type VersionRow } from './db.js';
import { validateDataset, type ValidatedDataset } from './validate.js';
import { searchBest, verifyVector } from './groups.js';
import { publish } from './publish.js';
import { AppError, ErrorCodes } from './errors.js';
import type { DatasetInput } from './types.js';

export class AnalysisService {
  constructor(private readonly store: Store) {}

  /** 仅检查输入，不落库 */
  inspect(input: unknown): ValidatedDataset & { vectorSpaceSize: number } {
    const validated = validateDataset(input);
    const vectorSpaceSize = validated.hierarchies.reduce(
      (acc, h) => acc * (h.maxLevel + 1),
      1,
    );
    return { ...validated, vectorSpaceSize };
  }

  /** 校验并保存为版本（datasetId 为空则新建数据集） */
  saveInput(
    input: unknown,
    datasetId: number | null,
    note = '',
  ): ReturnType<Store['saveVersion']> {
    validateDataset(input);
    // 输入已通过完整校验，保存原始层级定义（含祖先链）作为版本
    return this.store.saveVersion(input as DatasetInput, datasetId, note);
  }

  private loadValidated(versionId: number): ValidatedDataset {
    const row = this.store.getVersion(versionId);
    if (!row) {
      throw new AppError(ErrorCodes.NOT_FOUND, `版本 ${versionId} 不存在`);
    }
    return this.fromVersion(row);
  }

  private fromVersion(row: VersionRow): ValidatedDataset {
    return validateDataset({
      name: row.name,
      k: row.k,
      quasiIdentifiers: row.qiFields,
      records: row.records,
      hierarchies: row.hierarchies,
      maxLevels: row.maxLevels ?? undefined,
    });
  }

  /** 搜索最优可行向量并持久化摘要 */
  search(versionId: number) {
    const v = this.loadValidated(versionId);
    const result = searchBest(v.records, v.hierarchies, v.k);
    this.store.saveSolution(versionId, {
      vector: result.best ? result.best.vector : null,
      loss: result.best ? result.best.loss : null,
      feasible: result.feasible,
      feasibleVectorCount: result.feasibleVectorCount,
      groupSummary: result.best
        ? result.best.groups.map((g) => ({ key: g.key, size: g.size }))
        : null,
    });
    return result;
  }

  /** 核验指定向量（外部方案也必须重新分组） */
  verify(versionId: number, vector: number[]) {
    const v = this.loadValidated(versionId);
    return verifyVector(v.records, v.hierarchies, vector, v.k);
  }

  /** 查询某版本某向量的等价组 */
  groups(versionId: number, vector: number[]) {
    return this.verify(versionId, vector);
  }

  /** 比较不同最高层级限制：返回每个限制下的搜索结果 */
  compare(
    versionId: number,
    restrictions: Array<Record<string, number>>,
  ): unknown[] {
    const row = this.store.getVersion(versionId);
    if (!row) {
      throw new AppError(ErrorCodes.NOT_FOUND, `版本 ${versionId} 不存在`);
    }
    return restrictions.map((maxLevels) => {
      const v = validateDataset({
        name: row.name,
        k: row.k,
        quasiIdentifiers: row.qiFields,
        records: row.records,
        hierarchies: row.hierarchies,
        maxLevels,
      });
      const result = searchBest(v.records, v.hierarchies, v.k);
      return {
        maxLevels,
        feasible: result.feasible,
        bestVector: result.best?.vector ?? null,
        loss: result.best?.loss ?? null,
        feasibleVectorCount: result.feasibleVectorCount,
        reason: result.reason ?? null,
      };
    });
  }

  /** 校验可行后，事务化导出发布表与核验报告 */
  publish(versionId: number, vector: number[]) {
    const v = this.loadValidated(versionId);
    const output = publish(v.records, v.hierarchies, vector, v.k);
    const publicationId = this.store.savePublication(versionId, {
      vector,
      loss: output.verification.loss,
      k: v.k,
      publishedTable: output.publishedTable,
      report: output.report,
    });
    return { publicationId, ...output };
  }

  getPublication(publicationId: number) {
    const pub = this.store.getPublication(publicationId);
    if (!pub) {
      throw new AppError(
        ErrorCodes.NOT_FOUND,
        `发布记录 ${publicationId} 不存在`,
      );
    }
    return pub;
  }

  listVersions(datasetId: number) {
    if (!this.store.getDatasetId(datasetId)) {
      throw new AppError(ErrorCodes.NOT_FOUND, `数据集 ${datasetId} 不存在`);
    }
    return this.store.listVersions(datasetId);
  }

  getVersion(versionId: number) {
    const row = this.store.getVersion(versionId);
    if (!row) {
      throw new AppError(ErrorCodes.NOT_FOUND, `版本 ${versionId} 不存在`);
    }
    return {
      versionId: row.id,
      datasetId: row.datasetId,
      versionNo: row.versionNo,
      name: row.name,
      k: row.k,
      quasiIdentifiers: row.qiFields,
      recordCount: row.records.length,
      maxLevels: row.maxLevels,
      note: row.note,
      createdAt: row.createdAt,
    };
  }

  getSolution(versionId: number) {
    this.getVersion(versionId);
    return this.store.getSolution(versionId);
  }
}
