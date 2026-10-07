import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDataset } from '../dist/core/validate.js';
import { searchBest, verifyVector } from '../dist/core/groups.js';
import { publish } from '../dist/core/publish.js';
import { AppError } from '../dist/core/errors.js';
import { demoDataset } from '../dist/demo/data.js';

function prepare(input: unknown) {
  const v = validateDataset(input);
  return v;
}

test('示例：年龄层级1+城市层级0可行，损失1', () => {
  const v = prepare(demoDataset());
  const result = searchBest(v.records, v.hierarchies, v.k);
  assert.equal(result.feasible, true);
  assert.deepEqual(result.best!.vector, [1, 0]);
  assert.equal(result.best!.loss, 1);
});

test('只泛化城市保留精确年龄仍有单人组', () => {
  const v = prepare(demoDataset());
  const result = verifyVector(v.records, v.hierarchies, [0, 1], 2);
  assert.equal(result.feasible, false);
  assert.equal(result.failingGroups.length, 4);
});

test('限制年龄最高层级0时即使城市全合并也无解', () => {
  const input = { ...demoDataset(), maxLevels: { age: 0 } };
  const v = prepare(input);
  const result = searchBest(v.records, v.hierarchies, 2);
  assert.equal(result.feasible, false);
  assert.equal(result.best, null);
});

test('k=1 且全部记录相同：层级0即可行', () => {
  const v = prepare({
    name: 'x',
    k: 1,
    quasiIdentifiers: ['age'],
    records: [
      { rowId: 'a', values: { age: '20' } },
      { rowId: 'b', values: { age: '20' } },
    ],
    hierarchies: [{ field: 'age', chains: { '20': ['20', 'ALL'] } }],
  });
  const result = searchBest(v.records, v.hierarchies, 1);
  assert.deepEqual(result.best!.vector, [0]);
  // 两条完全相同记录是不同的人，计数不去重
  assert.equal(result.best!.groups[0].size, 2);
});

test('多个同损失方案取字典序最小', () => {
  // 两列都必须到层级1才可行；损失同为2的向量唯一，这里构造存在 [1,1] 与备选
  const v = prepare({
    name: 'tie',
    k: 2,
    quasiIdentifiers: ['a', 'b'],
    records: [
      { rowId: '1', values: { a: 'x', b: 'p' } },
      { rowId: '2', values: { a: 'y', b: 'q' } },
    ],
    hierarchies: [
      { field: 'a', chains: { x: ['x', 'A'], y: ['y', 'A'] } },
      { field: 'b', chains: { p: ['p', 'B'], q: ['q', 'B'] } },
    ],
  });
  const result = searchBest(v.records, v.hierarchies, 2);
  // 只有 [1,1] 可行，损失 2
  assert.deepEqual(result.best!.vector, [1, 1]);
  assert.equal(result.feasibleVectorCount, 1);
});

test('同损失字典序：单列泛化两种路径选靠前字段更小层级', () => {
  // 任意单列到根即可满足 k=2；[1,0] 与 [0,1] 损失均为1，取 [0,1]（字典序）
  const v = prepare({
    name: 'tie2',
    k: 2,
    quasiIdentifiers: ['a', 'b'],
    records: [
      // [1,0]：a 归 A 后按 b 各成 2 人组；[0,1]：b 归 B 后按 a 各成 2 人组
      { rowId: '1', values: { a: 'x', b: 'p' } },
      { rowId: '2', values: { a: 'x', b: 'q' } },
      { rowId: '3', values: { a: 'y', b: 'p' } },
      { rowId: '4', values: { a: 'y', b: 'q' } },
    ],
    hierarchies: [
      { field: 'a', chains: { x: ['x', 'A'], y: ['y', 'A'] } },
      { field: 'b', chains: { p: ['p', 'B'], q: ['q', 'B'] } },
    ],
  });
  const result = searchBest(v.records, v.hierarchies, 2);
  assert.deepEqual(result.best!.vector, [0, 1]);
  assert.equal(result.best!.loss, 1);
  assert.equal(result.feasibleVectorCount, 3); // [0,1]、[1,0]、[1,1]
});

test('未知叶子被拒绝', () => {
  assert.throws(
    () =>
      prepare({
        name: 'x',
        k: 1,
        quasiIdentifiers: ['a'],
        records: [{ rowId: '1', values: { a: 'zzz' } }],
        hierarchies: [{ field: 'a', chains: { x: ['x', 'A'] } }],
      }),
    (err: Error) => err instanceof AppError && err.code === 'UNKNOWN_LEAF',
  );
});

test('链长度不齐被拒绝', () => {
  assert.throws(
    () =>
      prepare({
        name: 'x',
        k: 1,
        quasiIdentifiers: ['a'],
        records: [
          { rowId: '1', values: { a: 'x' } },
          { rowId: '2', values: { a: 'y' } },
        ],
        hierarchies: [
          { field: 'a', chains: { x: ['x', 'A'], y: ['y'] } },
        ],
      }),
 (err: Error) => err instanceof AppError && err.code === 'CHAIN_LENGTH_MISMATCH',
  );
});

test('冲突父节点被拒绝', () => {
  assert.throws(
    () =>
      prepare({
        name: 'x',
        k: 1,
        quasiIdentifiers: ['a'],
        records: [
          { rowId: '1', values: { a: 'x' } },
          { rowId: '2', values: { a: 'w' } },
        ],
        hierarchies: [
          {
            field: 'a',
            chains: {
              // 同一节点 m 在一条链中父为 R1，另一条中父为 R2：冲突父节点
              x: ['x', 'm', 'R1'],
              w: ['w', 'm', 'R2'],
            },
          },
        ],
      }),
    (err: Error) => err instanceof AppError && err.code === 'CONFLICT_PARENT',
  );
});

test('重复内部行编号被拒绝', () => {
  assert.throws(
    () =>
      prepare({
        name: 'x',
        k: 1,
        quasiIdentifiers: ['a'],
        records: [
          { rowId: '1', values: { a: 'x' } },
          { rowId: '1', values: { a: 'y' } },
        ],
        hierarchies: [
          { field: 'a', chains: { x: ['x', 'A'], y: ['y', 'A'] } },
        ],
      }),
    (err: Error) => err instanceof AppError && err.code === 'DUPLICATE_ROW_ID',
  );
});

test('空记录被拒绝', () => {
  assert.throws(
    () => validateDataset({ name: 'x', k: 1, quasiIdentifiers: ['a'], records: [], hierarchies: [] }),
    (err: Error) => err instanceof AppError && err.code === 'EMPTY_RECORDS',
  );
});

test('k 大于人数被拒绝', () => {
  assert.throws(
    () =>
      prepare({
        name: 'x',
        k: 5,
        quasiIdentifiers: ['a'],
        records: [{ rowId: '1', values: { a: 'x' } }],
        hierarchies: [{ field: 'a', chains: { x: ['x', 'A'] } }],
      }),
    (err: Error) => err instanceof AppError && err.code === 'K_TOO_LARGE',
  );
});

test('k 非正整数被拒绝', () => {
  const base = demoDataset();
  assert.throws(
    () => prepare({ ...base, k: 0 }),
    (err: Error) => err instanceof AppError && err.code === 'INVALID_K',
  );
});

test('允许层级边界：maxLevel 等于深度允许，超出拒绝', () => {
  assert.doesNotThrow(() => prepare({ ...demoDataset(), maxLevels: { age: 2, city: 1 } }));
  assert.throws(
    () => prepare({ ...demoDataset(), maxLevels: { age: 3 } }),
    (err: Error) => err instanceof AppError && err.code === 'VALIDATION_ERROR',
  );
});

test('超过4个字段被拒绝', () => {
  assert.throws(
    () =>
      validateDataset({
        name: 'x',
        k: 1,
        quasiIdentifiers: ['a', 'b', 'c', 'd', 'e'],
        records: [],
        hierarchies: [],
      }),
    (err: Error) => err instanceof AppError && err.code === 'VALIDATION_ERROR',
  );
});

test('每行恰好进入一组且组大小总和等于行数，逐行链值核对', () => {
  const v = prepare(demoDataset());
  const vector = [1, 0];
  const result = verifyVector(v.records, v.hierarchies, vector, 2);
  assert.equal(result.groupSizeSum, v.records.length);
  let covered = 0;
  for (const g of result.groups) covered += g.rowIds.length;
  assert.equal(covered, v.records.length);

  // 逐行沿所选祖先链核对发布值
  const pub = publish(v.records, v.hierarchies, vector, 2);
  const expectedAge: Record<string, string> = {
    '20': '20段',
    '21': '20段',
    '30': '30段',
    '31': '30段',
  };
  pub.publishedTable.forEach((row, i) => {
    const original = v.records[i]!;
    assert.equal(row.age, expectedAge[original.values.age]);
    assert.equal(row.city, original.values.city);
    // 发布表不含内部行编号字段名
    assert.ok(!('rowId' in row));
  });
});

test('不可行向量不允许发布且列出实际小组', () => {
  const v = prepare(demoDataset());
  assert.throws(
    () => publish(v.records, v.hierarchies, [0, 1], 2),
    (err: Error) => err instanceof AppError && err.code === 'NO_SOLUTION',
  );
});
