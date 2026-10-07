import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGroups,
  evaluateVector,
  searchOptimal,
  validateConstraints,
  validateDataset,
  validateHierarchies,
} from '../src/core';
import { demoDataset } from '../src/demoData';
import { ApiError } from '../src/errors';

const demo = demoDataset();
const vh = validateHierarchies(demo.fields, demo.hierarchies);

test('演示例：k=2 时最优向量为 [1,0]，损失 1', () => {
  const constraints = validateConstraints(demo.fields, vh, {});
  const r = searchOptimal(demo.fields, demo.records, vh, 2, constraints);
  assert.deepEqual(r.vector, [1, 0]);
  assert.equal(r.loss, 1);
  assert.ok(r.feasible);
  assert.deepEqual(r.groups.map((g) => g.size).sort(), [2, 2]);
});

test('只泛化城市 [0,1] 仍有单人组', () => {
  const r = evaluateVector(demo.fields, demo.records, vh, 2, [0, 1]);
  assert.equal(r.feasible, false);
  assert.equal(r.violatingGroups.length, 4);
  assert.ok(r.violatingGroups.every((g) => g.size === 1));
});

test('限制年龄最高层级为 0 时无解', () => {
  assert.throws(
    () => searchOptimal(demo.fields, demo.records, vh, 2, { 年龄: 0, 城市: 1 }),
    (e: ApiError) => e.code === 'NO_FEASIBLE_SOLUTION'
  );
});

test('k=1 时零损失向量 [0,0] 可行', () => {
  const r = searchOptimal(demo.fields, demo.records, vh, 1, { 年龄: 2, 城市: 1 });
  assert.deepEqual(r.vector, [0, 0]);
  assert.equal(r.loss, 0);
});

test('全部记录相同时 k=4 也可行（不去重计数）', () => {
  const records = [1, 2, 3, 4].map((i) => ({
    rowId: `r${i}`,
    values: { 年龄: '20', 城市: '甲' },
  }));
  const r = searchOptimal(demo.fields, records, vh, 4, { 年龄: 2, 城市: 1 });
  assert.deepEqual(r.vector, [0, 0]);
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].size, 4);
});

test('多个同损失方案取字典序最小（[0,1] 先于 [1,0]）', () => {
  const records = [
    { rowId: 'a', values: { 年龄: '20', 城市: '甲' } },
    { rowId: 'b', values: { 年龄: '20', 城市: '乙' } },
    { rowId: 'c', values: { 年龄: '30', 城市: '甲' } },
    { rowId: 'd', values: { 年龄: '30', 城市: '乙' } },
  ];
  const r = searchOptimal(demo.fields, records, vh, 2, { 年龄: 2, 城市: 1 });
  assert.equal(r.loss, 1);
  assert.deepEqual(r.vector, [0, 1]);
});

test('未知叶子被拒绝', () => {
  assert.throws(
    () =>
      validateDataset(
        demo.fields,
        [{ rowId: 'x', values: { 年龄: '99', 城市: '甲' } }],
        1,
        vh
      ),
    (e: ApiError) => e.code === 'VALUE_NOT_IN_HIERARCHY'
  );
});

test('重复内部编号被拒绝', () => {
  const records = [
    { rowId: 'r1', values: { 年龄: '20', 城市: '甲' } },
    { rowId: 'r1', values: { 年龄: '21', 城市: '甲' } },
  ];
  assert.throws(
    () => validateDataset(demo.fields, records, 1, vh),
    (e: ApiError) => e.code === 'DUPLICATE_ROW_ID'
  );
});

test('k 大于人数被拒绝', () => {
  assert.throws(
    () => validateDataset(demo.fields, demo.records, 5, vh),
    (e: ApiError) => e.code === 'K_TOO_LARGE'
  );
});

test('空记录被拒绝', () => {
  assert.throws(
    () => validateDataset(demo.fields, [], 1, vh),
    (e: ApiError) => e.code === 'EMPTY_RECORDS'
  );
});

test('链长不一致被拒绝', () => {
  assert.throws(
    () =>
      validateHierarchies(['f'], {
        f: { a: ['a', '根'], b: ['b', '中', '根'] },
      }),
    (e: ApiError) => e.code === 'CHAIN_LENGTH_MISMATCH'
  );
});

test('冲突父节点被拒绝', () => {
  assert.throws(
    () =>
      validateHierarchies(['f'], {
        f: {
          a: ['a', 'm', 'p', '根'],
          b: ['b', 'm', 'q', '根'],
        },
      }),
    (e: ApiError) => e.code === 'CONFLICTING_PARENT'
  );
});

test('根不一致被拒绝', () => {
  assert.throws(
    () =>
      validateHierarchies(['f'], {
        f: { a: ['a', '根1'], b: ['b', '根2'] },
      }),
    (e: ApiError) => e.code === 'ROOT_MISMATCH'
  );
});

test('允许层级边界：限制超出列最大层级被拒绝', () => {
  assert.throws(
    () => validateConstraints(demo.fields, vh, { 年龄: 3 }),
    (e: ApiError) => e.code === 'CONSTRAINT_OUT_OF_RANGE'
  );
  const c = validateConstraints(demo.fields, vh, { 年龄: 2, 城市: 1 });
  assert.deepEqual(c, { 年龄: 2, 城市: 1 });
});

test('手工核对：逐行沿祖先链检查发布值，每行恰好一组且组大小总和等于行数', () => {
  const vector = [1, 0];
  const groups = buildGroups(demo.fields, demo.records, vh, vector);
  const byKey = new Map(groups.map((g) => [g.key, g]));
  assert.deepEqual(byKey.get('二十段甲')?.rowIds, ['r1', 'r2']);
  assert.deepEqual(byKey.get('三十段乙')?.rowIds, ['r3', 'r4']);
  for (const rec of demo.records) {
    demo.fields.forEach((f, i) => {
      const expected = vh.chains[f][rec.values[f]][vector[i]];
      const g = groups.find((g) => g.rowIds.includes(rec.rowId))!;
      assert.equal(g.generalizedValues[f], expected);
    });
  }
  const allRowIds = groups.flatMap((g) => g.rowIds);
  assert.equal(new Set(allRowIds).size, demo.records.length);
  assert.equal(groups.reduce((s, g) => s + g.size, 0), demo.records.length);
});

test('全局层级：一列所有行使用同一层级', () => {
  const groups = buildGroups(demo.fields, demo.records, vh, [1, 0]);
  for (const g of groups) {
    assert.ok(['二十段', '三十段'].includes(g.generalizedValues['年龄']));
  }
});
