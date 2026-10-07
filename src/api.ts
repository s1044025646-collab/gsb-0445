import http from 'node:http';
import { KanonService } from './service';
import { ApiError } from './errors';

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('BAD_REQUEST', '请求体不是合法 JSON');
  }
}

export function createServer(service: KanonService): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      const method = req.method ?? 'GET';
      const body = method === 'POST' || method === 'PUT' ? await readBody(req) : {};

      // POST /datasets  创建数据集首版本
      if (method === 'POST' && parts[0] === 'datasets' && parts.length === 1) {
        return send(res, 201, service.createVersion(body));
      }
      // POST /datasets/:id/versions  修订输入创建新版本
      if (method === 'POST' && parts[0] === 'datasets' && parts[2] === 'versions') {
        return send(res, 201, service.createVersion(body, Number(parts[1])));
      }
      // GET /datasets/:id/versions
      if (method === 'GET' && parts[0] === 'datasets' && parts[2] === 'versions') {
        return send(res, 200, service.listVersions(Number(parts[1])));
      }
      const versionId = parts[0] === 'versions' ? Number(parts[1]) : NaN;
      if (parts[0] === 'versions' && !Number.isInteger(versionId)) {
        throw new ApiError('BAD_REQUEST', '版本号必须是整数');
      }
      // POST /versions/:id/validate
      if (method === 'POST' && parts[2] === 'validate') {
        return send(res, 200, service.validate(versionId));
      }
      // POST /versions/:id/search  body 可带 constraints 覆盖
      if (method === 'POST' && parts[2] === 'search') {
        return send(res, 200, service.search(versionId, body.constraints));
      }
      // GET /versions/:id/groups?vector=1,0
      if (method === 'GET' && parts[2] === 'groups') {
        const vector = (url.searchParams.get('vector') ?? '').split(',').filter(Boolean).map(Number);
        return send(res, 200, service.groups(versionId, vector));
      }
      // POST /versions/:id/verify {vector:[...]}
      if (method === 'POST' && parts[2] === 'verify') {
        return send(res, 200, service.verify(versionId, body.vector));
      }
      // POST /versions/:id/compare-constraints {sets:[{name,constraints}]}
      if (method === 'POST' && parts[2] === 'compare-constraints') {
        return send(res, 200, service.compareConstraints(versionId, body.sets ?? []));
      }
      // POST /versions/:id/publish {vector:[...]}
      if (method === 'POST' && parts[2] === 'publish') {
        return send(res, 200, service.publish(versionId, body.vector));
      }
      // GET /versions/:id/publish
      if (method === 'GET' && parts[2] === 'publish') {
        return send(res, 200, service.getPublished(versionId));
      }
      // GET /reports/:id
      if (method === 'GET' && parts[0] === 'reports') {
        return send(res, 200, service.getReport(Number(parts[1])));
      }
      throw new ApiError('NOT_FOUND', `未知路由：${method} ${url.pathname}`);
    } catch (e) {
      if (e instanceof ApiError) {
        return send(res, 400, { error: { code: e.code, message: e.message, details: e.details } });
      }
      send(res, 500, { error: { code: 'INTERNAL', message: String(e) } });
    }
  });
}

/** 默认选择空闲端口 */
export function listen(server: http.Server, port = 0): Promise<number> {
  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    });
  });
}
