import { AppError, ErrorCodes } from './errors.js';
import { normalizeHierarchy } from './hierarchy.js';
import type {
  DatasetInput,
  InputRecord,
  NormalizedHierarchy,
} from './types.js';

export interface ValidatedDataset {
  name: string;
  k: number;
  quasiIdentifiers: string[];
  records: InputRecord[];
  hierarchies: NormalizedHierarchy[];
}

const MAX_FIELDS = 4;

/** 校验完整输入并规范化层级 */
export function validateDataset(input: unknown): ValidatedDataset {
  if (typeof input !== 'object' || input === null) {
    throw new AppError(ErrorCodes.VALIDATION, '输入必须为对象');
  }
  const obj = input as Partial<DatasetInput>;

  const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name : '未命名数据集';

  const qi = obj.quasiIdentifiers;
  if (!Array.isArray(qi) || qi.length < 1 || qi.length > MAX_FIELDS) {
    throw new AppError(
      ErrorCodes.VALIDATION,
      `准标识字段数量必须在 1..${MAX_FIELDS} 之间`,
    );
  }
  if (qi.some((f) => typeof f !== 'string' || !f)) {
    throw new AppError(ErrorCodes.ILLEGAL_FIELD, '准标识字段名必须为非空字符串');
  }
  if (new Set(qi).size !== qi.length) {
    throw new AppError(ErrorCodes.ILLEGAL_FIELD, '准标识字段存在重复');
  }

  const k = obj.k;
  if (typeof k !== 'number' || !Number.isInteger(k) || k < 1) {
    throw new AppError(ErrorCodes.INVALID_K, 'k 必须为正整数');
  }

  const records = obj.records;
  if (!Array.isArray(records) || records.length === 0) {
    throw new AppError(ErrorCodes.EMPTY_RECORDS, '记录为空，无法进行泛化分析');
  }

  const normalizedRecords: InputRecord[] = [];
  const seenIds = new Set<string>();
  for (const rec of records) {
    if (
      typeof rec !== 'object' ||
      rec === null ||
      typeof rec.rowId !== 'string' ||
      !rec.rowId
    ) {
      throw new AppError(
        ErrorCodes.VALIDATION,
        '每条记录必须包含非空字符串类型的内部行编号 rowId',
      );
    }
    if (seenIds.has(rec.rowId)) {
      throw new AppError(
        ErrorCodes.DUPLICATE_ROW_ID,
        `内部行编号重复：${rec.rowId}`,
        { rowId: rec.rowId },
      );
    }
    seenIds.add(rec.rowId);
    if (typeof rec.values !== 'object' || rec.values === null) {
      throw new AppError(
        ErrorCodes.VALIDATION,
        `记录 ${rec.rowId} 缺少 values 字段映射`,
      );
    }
    const values: Record<string, string> = {};
    for (const field of qi) {
      const raw = (rec.values as Record<string, unknown>)[field];
      if (typeof raw !== 'string' || raw === '') {
        throw new AppError(
          ErrorCodes.ILLEGAL_FIELD,
          `记录 ${rec.rowId} 的字段 ${field} 值缺失或非字符串`,
        );
      }
      values[field] = raw;
    }
    normalizedRecords.push({ rowId: rec.rowId, values });
  }

  if (k > normalizedRecords.length) {
    throw new AppError(
      ErrorCodes.K_TOO_LARGE,
      `k=${k} 大于记录总数 ${normalizedRecords.length}，任何方案都不可行`,
      { k, totalRows: normalizedRecords.length },
    );
  }

  if (!Array.isArray(obj.hierarchies)) {
    throw new AppError(ErrorCodes.VALIDATION, 'hierarchies 必须为数组');
  }
  const hierarchyByField = new Map(obj.hierarchies.map((h) => [h.field, h]));
  const hierarchies: NormalizedHierarchy[] = [];
  for (const field of qi) {
    const def = hierarchyByField.get(field);
    if (!def) {
      throw new AppError(
        ErrorCodes.ILLEGAL_FIELD,
        `准标识字段 ${field} 缺少层级定义`,
      );
    }
    const maxLevel = obj.maxLevels?.[field];
    hierarchies.push(
      normalizeHierarchy(def, normalizedRecords, maxLevel, {
        maxLevelCap: 4,
        maxFieldCount: MAX_FIELDS,
      }),
    );
  }

  return {
    name,
    k,
    quasiIdentifiers: [...qi],
    records: normalizedRecords,
    hierarchies,
  };
}
