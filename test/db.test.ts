import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../dist/core/db.js';
import { AnalysisService } from '../dist/core/service.js';
import { demoDataset } from '../dist/demo/data.js';
import { AppError } from '../dist/core/errors.js';

function tempDb(): string {
  const dir = join(tmpdir(), `kanon-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return join(dir, 'kanon.sqlite');
}

test('版本化：修订输入创建新版本，旧版本保留', () => {
  const path = tempDb();
  const store = new Store(path);
  const service = new AnalysisService(store);
  const saved1 = service.saveInput(demoDataset(), null, 'v1');
  const revised = demoDataset();
  revised.k = 1;
  const saved2 = service.saveInput(revised, saved1.datasetId, 'v2 k=1');
  assert.equal(saved2.versionNo, 2);
  const versions = service.listVersions(saved1.datasetId);
  assert.equal(versions.length, 2);
  assert.equal(service.getVersion(saved1.versionId).k, 2);
  assert.equal(service.getVersion(saved2.versionId).k, 1);
  store.close();
  rmSync(join(path, '..'), { recursive: true, force: true });
});

test('发布与报告事务完整提交，重启后可复查', () => {
  const path = tempDb();
  const store = new Store(path);
  const service = new AnalysisService(store);
  const saved = service.saveInput(demoDataset(), null, 'v1');
  const pub = service.publish(saved.versionId, [1, 0]);
  assert.equal(pub.publishedTable.length, 4);
  assert.equal(pub.report.rowToGroup.length, 4);
  store.close();

  // 重新打开同一数据库文件
  const store2 = new Store(path);
  const service2 = new AnalysisService(store2);
  const reloaded = service2.getPublication(pub.publicationId);
  assert.deepEqual(reloaded.vector, [1, 0]);
  assert.equal(reloaded.report.minGroupSize, 2);
  assert.equal(reloaded.report.groupCount, 2);
  store2.close();
  rmSync(join(path, '..'), { recursive: true, force: true });
});

test('不可行发布回滚，不留下被标为可发布的半表', () => {
  const path = tempDb();
  const store = new Store(path);
  const service = new AnalysisService(store);
  const saved = service.saveInput(demoDataset(), null, 'v1');
  assert.throws(
    () => service.publish(saved.versionId, [0, 1]),
    (err: Error) => err instanceof AppError && err.code === 'NO_SOLUTION',
  );
  assert.equal(store.listPublications(saved.versionId).length, 0);
  store.close();
  rmSync(join(path, '..'), { recursive: true, force: true });
});
