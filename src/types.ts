export interface RecordInput {
  rowId: string;
  values: Record<string, string>;
}

/** 每个叶子 -> 从自身到根的完整祖先链（含叶子自身，末位为根） */
export type HierarchyMap = Record<string, Record<string, string[]>>;

export interface DatasetInput {
  name: string;
  fields: string[];
  records: RecordInput[];
  hierarchies: HierarchyMap;
  k: number;
  constraints?: Record<string, number>;
}

export interface GroupInfo {
  key: string;
  generalizedValues: Record<string, string>;
  size: number;
  rowIds: string[];
}

export interface EvalResult {
  vector: number[];
  loss: number;
  feasible: boolean;
  groups: GroupInfo[];
  violatingGroups: GroupInfo[];
}
