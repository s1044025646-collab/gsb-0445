import { AppError, ErrorCodes } from './errors.js';
import { generalize } from './hierarchy.js';
import type {
  InputRecord,
  NormalizedHierarchy,
  EquivalenceGroup,
  VerificationResult,
  SearchResult,
} from './types.js';

/**
 * 依据一个全局层级向量构造等价组。
 * 一列的所有行使用同一层级（不允许逐行选择）。
 */
export function buildGroups(
  records: InputRecord[],
  hierarchies: NormalizedHierarchy[],
  vector: number[],
): EquivalenceGroup[] {
  if (vector.length !== hierarchies.length) {
    throw new AppError(
      ErrorCodes.INVALID_VECTOR,
      `层级向量长度 ${vector.length} 与字段数 ${hierarchies.length} 不符`,
    );
  }
  for (let i = 0; i < hierarchies.length; i++) {
    const level = vector[i]!;
    const h = hierarchies[i]!;
    if (
      !Number.isInteger(level) ||
      level < 0 ||
      level > h.depth
    ) {
      throw new AppError(
        ErrorCodes.INVALID_VECTOR,
        `字段 ${h.field} 的层级 ${level} 超出 0..${h.depth}`,
      );
    }
  }

  const buckets = new Map<string, EquivalenceGroup>();
  for (const rec of records) {
    const key: string[] = [];
    for (let i = 0; i < hierarchies.length; i++) {
      const h = hierarchies[i]!;
      key.push(generalize(h, rec.values[h.field]!, vector[i]!));
    }
    const joined = key.join('');
    let group = buckets.get(joined);
    if (!group) {
      group = { key, rowIds: [], size: 0 };
      buckets.set(joined, group);
    }
    group.rowIds.push(rec.rowId);
    group.size++;
  }

  // 稳定排序：按组键字典序，保证输出确定
  return [...buckets.values()].sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) {
      if (a.key[i]! < b.key[i]!) return -1;
      if (a.key[i]! > b.key[i]!) return 1;
    }
    return 0;
  });
}

/** 核验给定层级向量：分组并检查是否所有组均达到 k */
export function verifyVector(
  records: InputRecord[],
  hierarchies: NormalizedHierarchy[],
  vector: number[],
  k: number,
): VerificationResult {
  const groups = buildGroups(records, hierarchies, vector);
  const failingGroups = groups.filter((g) => g.size < k);
  let minGroupSize = Infinity;
  let maxGroupSize = 0;
  let groupSizeSum = 0;
  for (const g of groups) {
    minGroupSize = Math.min(minGroupSize, g.size);
    maxGroupSize = Math.max(maxGroupSize, g.size);
    groupSizeSum += g.size;
  }
  if (groups.length === 0) {
    minGroupSize = 0;
  }
  return {
    vector: [...vector],
    loss: vector.reduce((acc, v) => acc + v, 0),
    feasible: failingGroups.length === 0,
    k,
    totalRows: records.length,
    groups,
    failingGroups,
    minGroupSize,
    maxGroupSize,
    groupSizeSum,
  };
}

/** 枚举一个闭区间内的全部向量（笛卡尔积），字段顺序即声明顺序 */
function enumerateVectors(upperBounds: number[]): number[][] {
  let result: number[][] = [[]];
  for (const upper of upperBounds) {
    const next: number[][] = [];
    for (const prefix of result) {
      for (let level = 0; level <= upper; level++) {
        next.push([...prefix, level]);
      }
    }
    result = next;
  }
  return result;
}

/**
 * 在允许层级范围内搜索最优可行向量。
 * 损失 = 各列层级编号之和；损失相同，按字段声明顺序的向量字典序取最小。
 */
export function searchBest(
  records: InputRecord[],
  hierarchies: NormalizedHierarchy[],
  k: number,
): SearchResult {
  const fields = hierarchies.map((h) => h.field);
  const upperBounds = hierarchies.map((h) => h.maxLevel);
  const allVectors = enumerateVectors(upperBounds);

  let best: VerificationResult | null = null;
  let feasibleCount = 0;

  for (const vector of allVectors) {
    const result = verifyVector(records, hierarchies, vector, k);
    if (!result.feasible) continue;
    feasibleCount++;
    if (best === null || isBetter(vector, result.loss, best.vector, best.loss)) {
      best = result;
    }
  }

  return {
    feasible: best !== null,
    k,
    totalRows: records.length,
    fields,
    best,
    feasibleVectorCount: feasibleCount,
    reason:
      best === null
        ? '在各列允许的最高层级范围内，不存在使所有等价组大小均达到 k 的层级向量'
        : undefined,
  };
}

/** 损失更小，或损失相等时字典序更小 */
function isBetter(
  a: number[],
  lossA: number,
  b: number[],
  lossB: number,
): boolean {
  if (lossA !== lossB) return lossA < lossB;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]!;
  }
  return false;
}
