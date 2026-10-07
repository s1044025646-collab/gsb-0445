/**
 * 领域类型定义。
 *
 * 层级模型：每个原始叶子值给出从自身到根的完整祖先链，
 * chain[0] 是叶子原值，chain[depth] 是根。
 * 同列所有链长度一致，根节点相同。
 */

/** 单列层级定义：字段名 -> 叶子值 -> 祖先链（含叶子自身） */
export interface HierarchyDef {
  field: string;
  /** key 为叶子原值，value 为从叶子到根的节点链 */
  chains: Record<string, string[]>;
}

/** 输入记录：内部行编号 + 若干字段值（均以字符串表示） */
export interface InputRecord {
  rowId: string;
  values: Record<string, string>;
}

/** 完整分析输入 */
export interface DatasetInput {
  name: string;
  quasiIdentifiers: string[];
  records: InputRecord[];
  hierarchies: HierarchyDef[];
  /** 每列允许的最高层级（可选，默认取该列最深层级） */
  maxLevels?: Record<string, number>;
  k: number;
}

/** 一列在某个层级上的泛化结果：叶子值 -> 该层级节点 */
export type LevelMap = Map<string, string>;

/** 规范化后的列层级结构 */
export interface NormalizedHierarchy {
  field: string;
  /** 总深度（根所在层级编号），层数 = depth + 1 */
  depth: number;
  root: string;
  /** levelMap[level] 给出该层级所有叶子的泛化值 */
  levelMaps: LevelMap[];
  /** 允许使用的最高层级 */
  maxLevel: number;
}

/** 一个等价组 */
export interface EquivalenceGroup {
  /** 组键：各准标识字段泛化值，按字段声明顺序 */
  key: string[];
  /** 组内内部行编号 */
  rowIds: string[];
  size: number;
}

/** 层级向量核验结果 */
export interface VerificationResult {
  vector: number[];
  loss: number;
  feasible: boolean;
  k: number;
  totalRows: number;
  groups: EquivalenceGroup[];
  /** 不满足 k 的小组 */
  failingGroups: EquivalenceGroup[];
  minGroupSize: number;
  maxGroupSize: number;
  /** 组大小总和，必须等于总行数 */
  groupSizeSum: number;
}

export interface SearchResult {
  feasible: boolean;
  k: number;
  totalRows: number;
  fields: string[];
  best: VerificationResult | null;
  /** 枚举到的可行向量数量 */
  feasibleVectorCount: number;
  reason?: string;
}

export interface PublishedRow {
  [field: string]: string;
}

export interface PublishReport {
  vector: number[];
  loss: number;
  k: number;
  groupCount: number;
  minGroupSize: number;
  rowCount: number;
  /** 源行 -> 等价组序号 的本地核验映射（不进入发布表） */
  rowToGroup: Array<{ rowId: string; groupIndex: number; groupKey: string[] }>;
  groups: Array<{ index: number; key: string[]; size: number }>;
}
