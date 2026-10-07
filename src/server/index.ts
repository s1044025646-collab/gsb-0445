import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { resolve } from 'node:path';
import { AnalysisService } from '../core/service.js';
import { Store } from '../core/db.js';
import { AppError } from '../core/errors.js';

const DATA_DIR = process.env.KANON_DATA_DIR ?? resolve(process.cwd(), 'data');
const DB_PATH = resolve(DATA_DIR, 'kanon.sqlite');

/** 返回一个当前空闲的端口（端口 0 由操作系统分配） */
export function pickFreePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createNetServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => res(port));
      } else {
        srv.close(() => rej(new Error('无法获取空闲端口')));
      }
    });
    srv.on('error', rej);
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveJson, rejectJson) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolveJson({});
      try {
        resolveJson(JSON.parse(raw));
      } catch {
        rejectJson(new AppError('VALIDATION_ERROR', '请求体不是合法 JSON'));
      }
    });
    req.on('error', rejectJson);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(json);
}

export function createApp(service: AnalysisService) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    try {
      if (method === 'GET' && path === '/health') {
        return send(res, 200, { ok: true });
      }

      // 检查输入（不落库）
      if (method === 'POST' && path === '/api/inspect') {
        const body = await readJson(req);
        return send(res, 200, service.inspect(body));
      }

      // 保存数据与层级版本
      const saveMatch = path.match(/^\/api\/datasets(?:\/(\d+))?\/versions$/);
      if (method === 'POST' && saveMatch) {
        const datasetId = saveMatch[1] ? Number(saveMatch[1]) : null;
        const body = (await readJson(req)) as { input?: unknown; note?: string };
        const saveInput = body.input ?? body;
        const result = service.saveInput(saveInput, datasetId, body.note ?? '');
        return send(res, 201, result);
      }

      // 版本详情 / 版本列表
      const versionsMatch = path.match(/^\/api\/datasets\/(\d+)\/versions$/);
      if (method === 'GET' && versionsMatch) {
        const dsId = Number(versionsMatch[1]);
        return send(res, 200, service.listVersions(dsId));
      }
      if (method === 'GET' && path.match(/^\/api\/versions\/\d+$/)) {
        const id = Number(path.split('/').pop());
        return send(res, 200, service.getVersion(id));
      }
      if (method === 'GET' && path.match(/^\/api\/versions\/\d+\/solution$/)) {
        const id = Number(path.split('/')[3]);
        return send(res, 200, service.getSolution(id));
      }

      // 搜索方案
      if (method === 'POST' && path.match(/^\/api\/versions\/\d+\/search$/)) {
        const id = Number(path.split('/')[3]);
        const result = service.search(id);
        return send(res, 200, serializeResult(result));
      }

      // 核验指定向量
      if (method === 'POST' && path.match(/^\/api\/versions\/\d+\/verify$/)) {
        const id = Number(path.split('/')[3]);
        const body = (await readJson(req)) as { vector: number[] };
        return send(res, 200, service.verify(id, body.vector));
      }

      // 查询等价组
      if (method === 'POST' && path.match(/^\/api\/versions\/\d+\/groups$/)) {
        const id = Number(path.split('/')[3]);
        const body = (await readJson(req)) as { vector: number[] };
        return send(res, 200, service.groups(id, body.vector));
      }

      // 比较限制
      if (method === 'POST' && path.match(/^\/api\/versions\/\d+\/compare$/)) {
        const id = Number(path.split('/')[3]);
        const body = (await readJson(req)) as { restrictions: Array<Record<string, number>> };
        return send(res, 200, service.compare(id, body.restrictions ?? []));
      }

      // 导出发布表
      if (method === 'POST' && path.match(/^\/api\/versions\/\d+\/publish$/)) {
        const id = Number(path.split('/')[3]);
        const body = (await readJson(req)) as { vector: number[] };
        return send(res, 201, service.publish(id, body.vector));
      }

      // 复查发布记录
      if (method === 'GET' && path.match(/^\/api\/publications\/\d+$/)) {
        const id = Number(path.split('/').pop());
        return send(res, 200, service.getPublication(id));
      }

      return send(res, 404, { code: 'NOT_FOUND', message: `无此路由：${method} ${path}` });
    } catch (err) {
      if (err instanceof AppError) {
        return send(res, statusForCode(err.code), {
          code: err.code,
          message: err.message,
          details: err.details ?? null,
        });
      }
      return send(res, 500, {
        code: 'INTERNAL',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

function statusForCode(code: string): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'VALIDATION_ERROR':
    case 'UNKNOWN_LEAF':
    case 'CHAIN_LENGTH_MISMATCH':
    case 'CONFLICT_PARENT':
    case 'ILLEGAL_FIELD':
    case 'DUPLICATE_ROW_ID':
    case 'EMPTY_RECORDS':
    case 'INVALID_K':
    case 'INVALID_VECTOR':
      return 400;
    case 'K_TOO_LARGE':
    case 'NO_SOLUTION':
      return 422;
    default:
      return 400;
  }
}

function serializeResult(result: ReturnType<AnalysisService['search']>) {
  return {
    feasible: result.feasible,
    k: result.k,
    totalRows: result.totalRows,
    fields: result.fields,
    feasibleVectorCount: result.feasibleVectorCount,
    reason: result.reason ?? null,
    best: result.best
      ? {
          vector: result.best.vector,
          loss: result.best.loss,
          feasible: result.best.feasible,
          minGroupSize: result.best.minGroupSize,
          maxGroupSize: result.best.maxGroupSize,
          groupSizeSum: result.best.groupSizeSum,
          groups: result.best.groups.map((g) => ({
            key: g.key,
            size: g.size,
            rowIds: g.rowIds,
          })),
        }
      : null,
  };
}

async function main(): Promise<void> {
  const store = new Store(DB_PATH);
  const service = new AnalysisService(store);
  const app = createApp(service);
  const requested = process.env.PORT ? Number(process.env.PORT) : 0;
  const port = requested > 0 ? requested : await pickFreePort();
  app.listen(port, '127.0.0.1', () => {
    console.log(`k 匿名泛化服务已启动：http://127.0.0.1:${port}`);
    console.log(`数据目录：${DATA_DIR}`);
    console.log('提示：设置 PORT 环境变量可指定端口，否则自动选择空闲端口。');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
