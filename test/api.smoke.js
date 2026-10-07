// API 冒烟测试：node dist/test/api.smoke.js（先 npm run build）
const { openDb } = require('../dist/src/db');
const { KanonService } = require('../dist/src/service');
const { createServer, listen } = require('../dist/src/api');
const { demoDataset } = require('../dist/src/demoData');

(async () => {
  const svc = new KanonService(openDb(require('path').join(process.cwd(), 'data', 'api-smoke.db')));
  const server = createServer(svc);
  const port = await listen(server, 0);
  const base = `http://127.0.0.1:${port}`;
  const post = async (p, body) => {
    const r = await fetch(base + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    return { status: r.status, body: await r.json() };
  };
  const created = await post('/datasets', demoDataset());
  console.log('POST /datasets ->', created.status, JSON.stringify(created.body));
  const vid = created.body.versionId;
  const search = await post(`/versions/${vid}/search`);
  console.log('search ->', search.body.vector, 'loss', search.body.loss, 'feasible', search.body.feasible);
  const verify = await post(`/versions/${vid}/verify`, { vector: [0, 1] });
  console.log('verify [0,1] -> feasible', verify.body.feasible, 'violating', verify.body.violatingGroups.length);
  const badPub = await post(`/versions/${vid}/publish`, { vector: [0, 1] });
  console.log('publish [0,1] ->', badPub.status, badPub.body.error.code);
  const pub = await post(`/versions/${vid}/publish`, { vector: [1, 0] });
  console.log('publish [1,0] ->', pub.status, 'rows', pub.body.rows.length);
  const cmp = await post(`/versions/${vid}/compare-constraints`, {
    sets: [{ name: '默认', constraints: {} }, { name: '年龄封顶0', constraints: { 年龄: 0 } }],
  });
  console.log('compare ->', JSON.stringify(cmp.body));
  const rep = await fetch(`${base}/reports/${pub.body.reportId}`).then((r) => r.json());
  console.log('report ->', rep.vector, 'mapping keys', Object.keys(rep.mapping).join(','));
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
