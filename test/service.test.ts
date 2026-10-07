import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db';
import { KanonService } from '../src/service';
import { demoDataset } from '../src/demoData';
import { ApiError } from '../src/errors';

function freshService(): KanonService {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanon-'));
  return new KanonService(openDb(path.join(dir, 't.db')));
}

test('保存版本、搜索、核验、发布、报告复查', () => {
  const svc = freshService();
  const { versionId } = svc.createVersion(demoDataset());
  const s = svc.search(versionId);
  assert.deepEqual(s.vector, [1, 0]);
  assert.ok(s.reportId > 0);

  const v = svc.verify(versionId, [0, 1]);
  assert.equal(v.feasible, false);
  assert.equal(v.violatingGroups.length, 4);

  const pub = svc.publish(versionId, [1, 0]);
  assert.equal(pub.rows.length, 4);
  for (const row of pub.rows) {
    assert.deepEqual(Object.keys(row).sort(), ['城市', '年龄'].sort());
  }
  const report = svc.getReport(pub.reportId);
  assert.deepEqual(Object.keys(report.mapping).sort(), ['r1', 'r2', 'r3', 'r4']);
  assert.equal(report.mapping['r1'], report.mapping['r2']);
});

test('不可行向量拒绝发布且不留下发布表', () => {
  const svc = freshService();
  const { versionId } = svc.createVersion(demoDataset());
  assert.throws(
    () => svc.publish(versionId, [0, 1]),
    (e: ApiError) => e.code === 'INFEASIBLE_VECTOR'
  );
  assert.throws(() => svc.getPublished(versionId), (e: ApiError) => e.code === 'NOT_FOUND');
});

test('修订输入创建新版本，旧报告仍引用旧版本', () => {
  const svc = freshService();
  const { datasetId, versionId: v1 } = svc.createVersion(demoDataset());
  const r1 = svc.search(v1);
  const modified = demoDataset();
  modified.k = 3;
  modified.records.push({ rowId: 'r5', values: { 年龄: '20', 城市: '甲' } });
  const { versionId: v2, versionNo } = svc.createVersion(modified, datasetId);
  assert.equal(versionNo, 2);
  const report = svc.getReport(r1.reportId);
  assert.equal(report.versionId, v1);
  assert.notEqual(report.versionId, v2);
});

test('限制比较', () => {
  const svc = freshService();
  const { versionId } = svc.createVersion(demoDataset());
  const cmp = svc.compareConstraints(versionId, [
    { name: '默认', constraints: {} },
    { name: '年龄封顶0', constraints: { 年龄: 0 } },
  ]);
  assert.equal(cmp[0].feasible, true);
  assert.deepEqual((cmp[0] as { vector: number[] }).vector, [1, 0]);
  assert.equal(cmp[1].feasible, false);
});

test('重启后报告可复查（重新打开同一数据库文件）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanon-'));
  const dbFile = path.join(dir, 't.db');
  const svc1 = new KanonService(openDb(dbFile));
  const { versionId } = svc1.createVersion(demoDataset());
  const { reportId } = svc1.search(versionId);
  const svc2 = new KanonService(openDb(dbFile));
  const report = svc2.getReport(reportId);
  assert.deepEqual(report.vector, [1, 0]);
  assert.equal(report.feasible, true);
  assert.equal(
    report.groups.reduce((s: number, g: { size: number }) => s + g.size, 0),
    4
  );
});
