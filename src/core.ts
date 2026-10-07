import { ApiError } from './errors';
import { EvalResult, GroupInfo, HierarchyMap, RecordInput } from './types';

export const MAX_FIELDS = 4;
export const MAX_LEVELS = 4; // 每列最多 4 个可选层级（0..3）

export interface ValidatedHierarchies {
  /** field -> leaf -> chain */
  chains: HierarchyMap;
  /** field -> 最大层级编号（链长-1） */
  maxLevel: Record<string, number>;
}

/**
 * 校验层级体系合法性：
 * - 每条链非空，首元素必须等于叶子名
 * - 同字段所有链长度一致
 * - 同字段所有链末位为同一根
 * - 同层同节点只能有一个父节点（无冲突父节点）
 * - 层级数（链长-1）不超过 MAX_LEVELS
 */
export function validateHierarchies(
  fields: string[],
  hierarchies: HierarchyMap
): ValidatedHierarchies {
  const maxLevel: Record<string, number> = {};
  for (const field of fields) {
    const table = hierarchies[field];
    if (!table || typeof table !== 'object') {
      throw new ApiError('MISSING_HIERARCHY', `字段 ${field} 缺少层级定义`);
    }
    const leaves = Object.keys(table);
    if (leaves.length === 0) {
      throw new ApiError('MISSING_HIERARCHY', `字段 ${field} 层级表为空`);
    }
    let expectedLen = -1;
    let root: string | null = null;
    // parentOf[level][node] = parent，检测同层同节点冲突父节点
    const parentOf: Map<string, string>[] = [];
    for (const leaf of leaves) {
      const chain = table[leaf];
      if (!Array.isArray(chain) || chain.length === 0) {
        throw new ApiError('UNKNOWN_LEAF', `字段 ${field} 叶子 ${leaf} 的祖先链为空`);
      }
      if (chain[0] !== leaf) {
        throw new ApiError(
          'UNKNOWN_LEAF',
          `字段 ${field} 叶子 ${leaf} 的祖先链必须以自身开头`
        );
      }
      if (expectedLen === -1) expectedLen = chain.length;
      if (chain.length !== expectedLen) {
        throw new ApiError(
          'CHAIN_LENGTH_MISMATCH',
          `字段 ${field} 的祖先链长度不一致（叶子 ${leaf}）`
        );
      }
      if (root === null) root = chain[chain.length - 1];
      if (chain[chain.length - 1] !== root) {
        throw new ApiError('ROOT_MISMATCH', `字段 ${field} 的祖先链末位根不一致`);
      }
      for (let lvl = 0; lvl < chain.length - 1; lvl++) {
        while (parentOf.length <= lvl) parentOf.push(new Map());
        const seen = parentOf[lvl].get(chain[lvl]);
        if (seen !== undefined && seen !== chain[lvl + 1]) {
          throw new ApiError(
            'CONFLICTING_PARENT',
            `字段 ${field} 第 ${lvl} 层节点 ${chain[lvl]} 存在冲突父节点：${seen} 与 ${chain[lvl + 1]}`
          );
        }
        parentOf[lvl].set(chain[lvl], chain[lvl + 1]);
      }
    }
    const levels = expectedLen - 1;
    if (levels > MAX_LEVELS) {
      throw new ApiError(
        'TOO_MANY_LEVELS',
        `字段 ${field} 层级数 ${levels} 超过上限 ${MAX_LEVELS}`
      );
    }
    maxLevel[field] = levels;
  }
  return { chains: hierarchies, maxLevel };
}

/** 校验数据集输入（记录、字段、k、值是否在层级表中） */
export function validateDataset(
  fields: string[],
  records: RecordInput[],
  k: number,
  vh: ValidatedHierarchies
): void {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new ApiError('NO_FIELDS', '至少需要一个准标识字段');
  }
  if (fields.length > MAX_FIELDS) {
    throw new ApiError('TOO_MANY_FIELDS', `准标识字段数超过上限 ${MAX_FIELDS}`);
  }
  if (new Set(fields).size !== fields.length) {
    throw new ApiError('INVALID_FIELD', '准标识字段存在重复');
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw new ApiError('EMPTY_RECORDS', '记录为空，无法分析');
  }
  if (!Number.isInteger(k) || k < 1) {
    throw new ApiError('K_INVALID', 'k 必须是正整数');
  }
  if (k > records.length) {
    throw new ApiError('K_TOO_LARGE', `k=${k} 大于总行数 ${records.length}，必然无解`);
  }
  const seen = new Set<string>();
  for (const rec of records) {
    if (typeof rec.rowId !== 'string' || rec.rowId.length === 0) {
      throw new ApiError('BAD_REQUEST', '内部行编号必须是非空字符串');
    }
    if (seen.has(rec.rowId)) {
      throw new ApiError('DUPLICATE_ROW_ID', `内部行编号重复：${rec.rowId}`);
    }
    seen.add(rec.rowId);
    for (const field of fields) {
      const v = rec.values?.[field];
      if (typeof v !== 'string') {
        throw new ApiError('INVALID_FIELD', `行 ${rec.rowId} 缺少字段 ${field} 的值`);
      }
      if (!vh.chains[field][v]) {
        throw new ApiError(
          'VALUE_NOT_IN_HIERARCHY',
          `行 ${rec.rowId} 字段 ${field} 的值 "${v}" 不在层级表中（未知叶子）`
        );
      }
    }
  }
}

/** 校验每列允许最高层级限制 */
export function validateConstraints(
  fields: string[],
  vh: ValidatedHierarchies,
  constraints: Record<string, number>
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const field of fields) {
    const c = constraints?.[field];
    if (c === undefined || c === null) {
      result[field] = vh.maxLevel[field];
      continue;
    }
    if (!Number.isInteger(c) || c < 0 || c > vh.maxLevel[field]) {
      throw new ApiError(
        'CONSTRAINT_OUT_OF_RANGE',
        `字段 ${field} 的最高层级限制 ${c} 超出允许范围 0..${vh.maxLevel[field]}`
      );
    }
    result[field] = c;
  }
  return result;
}

/** 按层级向量泛化单条记录 */
export function generalizeRecord(
  fields: string[],
  values: Record<string, string>,
  vh: ValidatedHierarchies,
  vector: number[]
): Record<string, string> {
  const out: Record<string, string> = {};
  fields.forEach((field, i) => {
    const chain = vh.chains[field][values[field]];
    out[field] = chain[vector[i]];
  });
  return out;
}

/** 构造等价组：同一泛化组合的所有行（不去重，逐行计数） */
export function buildGroups(
  fields: string[],
  records: RecordInput[],
  vh: ValidatedHierarchies,
  vector: number[]
): GroupInfo[] {
  const map = new Map<string, GroupInfo>();
  for (const rec of records) {
    const gv = generalizeRecord(fields, rec.values, vh, vector);
    const key = fields.map((f) => gv[f]).join('');
    let g = map.get(key);
    if (!g) {
      g = { key, generalizedValues: gv, size: 0, rowIds: [] };
      map.set(key, g);
    }
    g.size += 1;
    g.rowIds.push(rec.rowId);
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** 评估一个层级向量：分组 + 可行性（所有组 >= k） */
export function evaluateVector(
  fields: string[],
  records: RecordInput[],
  vh: ValidatedHierarchies,
  k: number,
  vector: number[]
): EvalResult {
  if (vector.length !== fields.length) {
    throw new ApiError(
      'VECTOR_LENGTH_MISMATCH',
      `层级向量长度 ${vector.length} 与字段数 ${fields.length} 不一致`
    );
  }
  fields.forEach((field, i) => {
    const lvl = vector[i];
    if (!Number.isInteger(lvl) || lvl < 0 || lvl > vh.maxLevel[field]) {
      throw new ApiError(
        'VECTOR_LEVEL_OUT_OF_RANGE',
        `字段 ${field} 的层级 ${lvl} 超出范围 0..${vh.maxLevel[field]}`
      );
    }
  });
  const groups = buildGroups(fields, records, vh, vector);
  const violatingGroups = groups.filter((g) => g.size < k);
  return {
    vector,
    loss: vector.reduce((a, b) => a + b, 0),
    feasible: violatingGroups.length === 0,
    groups,
    violatingGroups,
  };
}

/**
 * 全空间枚举搜索最优层级向量。
 * 目标：损失（各列层级之和）最小；平局按字段声明顺序的向量字典序最小。
 */
export function searchOptimal(
  fields: string[],
  records: RecordInput[],
  vh: ValidatedHierarchies,
  k: number,
  constraints: Record<string, number>
): EvalResult {
  const limits = fields.map((f) => constraints[f]);
  let best: EvalResult | null = null;
  const vector = new Array<number>(fields.length).fill(0);
  const walk = (idx: number): void => {
    if (idx === fields.length) {
      const res = evaluateVector(fields, records, vh, k, [...vector]);
      if (!res.feasible) return;
      if (
        !best ||
        res.loss < best.loss ||
        (res.loss === best.loss && lexLess(res.vector, best.vector))
      ) {
        best = res;
      }
      return;
    }
    for (let lvl = 0; lvl <= limits[idx]; lvl++) {
      vector[idx] = lvl;
      walk(idx + 1);
    }
  };
  walk(0);
  if (!best) {
    throw new ApiError(
      'NO_FEASIBLE_SOLUTION',
      '在当前层级上限约束下不存在满足 k 匿名的层级向量（不允许删除小组或调小 k）',
      { k, constraints }
    );
  }
  return best;
}

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}
