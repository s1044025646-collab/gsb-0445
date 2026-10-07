import { AppError, ErrorCodes } from './errors.js';
import type {
  HierarchyDef,
  NormalizedHierarchy,
  InputRecord,
} from './types.js';

export interface ValidateOptions {
  maxLevelCap?: number;
  maxFieldCount?: number;
}

/**
 * 校验并规范化单列层级。
 * 规则：
 *  - 每个叶子都必须给出从自身到根的链
 *  - 同列链长一致
 *  - 同层同节点只能有一个父节点（任意两个链在 level h 节点相同，
 *    则在 h+1 层节点也必须相同），保证为合法层级体系
 *  - 所有链最末节点为同一个根
 *  - 链内不能为空
 */
export function normalizeHierarchy(
  def: HierarchyDef,
  records: InputRecord[],
  maxLevelAllowed: number | undefined,
  opts: ValidateOptions = {},
): NormalizedHierarchy {
  const cap = opts.maxLevelCap ?? 4;
  if (!def.field || typeof def.field !== 'string') {
    throw new AppError(ErrorCodes.ILLEGAL_FIELD, '存在空名称的字段');
  }

  const leafSet = new Set<string>();
  for (const rec of records) {
    if (!(def.field in rec.values)) {
      throw new AppError(
        ErrorCodes.ILLEGAL_FIELD,
        `记录 ${rec.rowId} 缺少字段 ${def.field}`,
      );
    }
    leafSet.add(rec.values[def.field]!);
  }

  const chains = def.chains ?? {};
  // 未知叶子：数据中出现但层级未定义
  for (const leaf of leafSet) {
    if (!(leaf in chains)) {
      throw new AppError(
        ErrorCodes.UNKNOWN_LEAF,
        `字段 ${def.field} 存在未定义层级的叶子值：${leaf}`,
        { field: def.field, leaf },
      );
    }
  }

  let expectedLen = -1;
  let root: string | undefined;
  for (const [leaf, chain] of Object.entries(chains)) {
    if (!Array.isArray(chain) || chain.length === 0) {
      throw new AppError(
        ErrorCodes.CHAIN_LENGTH,
        `字段 ${def.field} 的叶子 ${leaf} 的祖先链为空`,
      );
    }
    if (chain.some((node) => typeof node !== 'string' || node === '')) {
      throw new AppError(
        ErrorCodes.ILLEGAL_FIELD,
        `字段 ${def.field} 的叶子 ${leaf} 的链含非法节点`,
      );
    }
    if (chain[0] !== leaf) {
      throw new AppError(
        ErrorCodes.CHAIN_LENGTH,
        `字段 ${def.field} 的叶子 ${leaf} 的链首节点必须等于叶子原值`,
      );
    }
    if (expectedLen === -1) {
      expectedLen = chain.length;
      root = chain[chain.length - 1];
    } else if (chain.length !== expectedLen) {
      throw new AppError(
        ErrorCodes.CHAIN_LENGTH,
        `字段 ${def.field} 祖先链长度不一致：叶子 ${leaf} 长度 ${chain.length}，应为 ${expectedLen}`,
        { field: def.field, leaf, got: chain.length, expected: expectedLen },
      );
    } else if (chain[chain.length - 1] !== root) {
      throw new AppError(
        ErrorCodes.CONFLICT_PARENT,
        `字段 ${def.field} 根节点不一致：叶子 ${leaf} 根为 ${chain[chain.length - 1]}，应为 ${root}`,
      );
    }
  }

  const depth = expectedLen - 1;
  if (depth < 0) {
    throw new AppError(ErrorCodes.CHAIN_LENGTH, `字段 ${def.field} 无有效层级`);
  }
  // 每列最多四个可选层级（层级 0..3）
  if (depth + 1 > cap) {
    throw new AppError(
      ErrorCodes.VALIDATION,
      `字段 ${def.field} 有 ${depth + 1} 个层级，超过每列最多 ${cap} 层的限制`,
    );
  }

  // 合法层级体系要求每个节点最多一个父节点（构成汇聚到同根的树/DAG 分类）。
  // 判定：同一层的同一个节点值，在任意链中其上一层父节点必须相同。
  // （一个父节点挂多个不同子节点是合法的，如 20、21 -> 20段。）
  const chainList = Object.values(chains);
  for (let h = 0; h < depth; h++) {
    const parentOf = new Map<string, string>();
    for (const chain of chainList) {
      const node = chain[h]!;
      const parent = chain[h + 1]!;
      const seenParent = parentOf.get(node);
      if (seenParent !== undefined && seenParent !== parent) {
        throw new AppError(
          ErrorCodes.CONFLICT_PARENT,
          `字段 ${def.field} 节点 ${node} 在层级 ${h} 存在冲突父节点：${seenParent} 与 ${parent}`,
          { field: def.field, node, level: h, parents: [seenParent, parent] },
        );
      }
      parentOf.set(node, parent);
    }
  }

  // 构造每个层级的叶子 -> 节点映射
  const levelMaps: Map<string, string>[] = [];
  for (let level = 0; level <= depth; level++) {
    const m = new Map<string, string>();
    for (const [leaf, chain] of Object.entries(chains)) {
      m.set(leaf, chain[level]!);
    }
    levelMaps.push(m);
  }

  let maxLevel = depth;
  if (maxLevelAllowed !== undefined) {
    if (
      !Number.isInteger(maxLevelAllowed) ||
      maxLevelAllowed < 0 ||
      maxLevelAllowed > depth
    ) {
      throw new AppError(
        ErrorCodes.VALIDATION,
        `字段 ${def.field} 允许的最高层级 ${maxLevelAllowed} 非法（应在 0..${depth}）`,
      );
    }
    maxLevel = maxLevelAllowed;
  }

  return {
    field: def.field,
    depth,
    root: root!,
    levelMaps,
    maxLevel,
  };
}

/** 取叶子值在指定层级的泛化值 */
export function generalize(
  h: NormalizedHierarchy,
  leaf: string,
  level: number,
): string {
  const value = h.levelMaps[level]?.get(leaf);
  if (value === undefined) {
    throw new AppError(
      ErrorCodes.UNKNOWN_LEAF,
      `字段 ${h.field} 叶子 ${leaf} 在层级 ${level} 无泛化值`,
    );
  }
  return value;
}
