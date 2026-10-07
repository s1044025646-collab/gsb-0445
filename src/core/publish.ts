import { AppError, ErrorCodes } from './errors.js';
import { verifyVector } from './groups.js';
import { generalize } from './hierarchy.js';
import type {
  InputRecord,
  NormalizedHierarchy,
  PublishedRow,
  PublishReport,
  VerificationResult,
} from './types.js';

export interface PublishOutput {
  publishedTable: PublishedRow[];
  report: PublishReport;
  verification: VerificationResult;
}

/**
 * 生成发布表与本地核验报告。
 * 只有所有组大小均达到 k 才允许发布；不做记录抑制。
 * 发布表只含泛化后的准标识字段，不含内部行编号。
 */
export function publish(
  records: InputRecord[],
  hierarchies: NormalizedHierarchy[],
  vector: number[],
  k: number,
): PublishOutput {
  const verification = verifyVector(records, hierarchies, vector, k);
  if (!verification.feasible) {
    throw new AppError(
      ErrorCodes.NO_SOLUTION,
      `层级向量 [${vector.join(', ')}] 不可发布：有 ${verification.failingGroups.length} 个组小于 k=${k}`,
      {
        failingGroups: verification.failingGroups.map((g) => ({
          key: g.key,
          size: g.size,
        })),
      },
    );
  }

  const fields = hierarchies.map((h) => h.field);
  const publishedTable: PublishedRow[] = records.map((rec) => {
    const row: PublishedRow = {};
    for (let i = 0; i < hierarchies.length; i++) {
      const h = hierarchies[i]!;
      row[h.field] = generalize(h, rec.values[h.field]!, vector[i]!);
    }
    return row;
  });

  const groups = verification.groups.map((g, index) => ({
    index,
    key: g.key,
    size: g.size,
  }));
  const keyIndex = new Map(verification.groups.map((g, i) => [g.key.join(''), i]));

  const rowToGroup = records.map((rec) => {
    const key: string[] = [];
    for (let i = 0; i < hierarchies.length; i++) {
      const h = hierarchies[i]!;
      key.push(generalize(h, rec.values[h.field]!, vector[i]!));
    }
    const groupIndex = keyIndex.get(key.join(''))!;
    return { rowId: rec.rowId, groupIndex, groupKey: key };
  });

  const report: PublishReport = {
    vector: [...vector],
    loss: verification.loss,
    k,
    groupCount: groups.length,
    minGroupSize: verification.minGroupSize,
    rowCount: records.length,
    rowToGroup,
    groups,
  };

  return { publishedTable, report, verification };
}
