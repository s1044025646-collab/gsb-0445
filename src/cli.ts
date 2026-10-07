import { openDb } from './db';
import { KanonService } from './service';
import { demoDataset } from './demoData';
import { createServer, listen } from './api';
import { ApiError } from './errors';
import { EvalResult } from './types';
import fs from 'node:fs';

function printResult(r: EvalResult): void {
  console.log(`层级向量: [${r.vector.join(', ')}]  损失: ${r.loss}  可行: ${r.feasible ? '是' : '否'}`);
  console.log(`等价组数: ${r.groups.length}  组大小: [${r.groups.map((g) => g.size).join(', ')}]`);
  for (const g of r.groups) {
    console.log(`  ${g.key}  大小=${g.size}`);
  }
  if (!r.feasible) {
    console.log('不满足 k 的小组:');
    for (const g of r.violatingGroups) console.log(`  ${g.key}  大小=${g.size}`);
  }
}

function loadInput(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main(): Promise<void> {
  const [, , cmd, ...args] = process.argv;
  const db = openDb(process.env.KANON_DB);
  const svc = new KanonService(db);

  switch (cmd) {
    case 'demo': {
      const { versionId } = svc.createVersion(demoDataset());
      console.log(`已创建演示数据集版本 versionId=${versionId}（k=2）`);
      console.log('--- 搜索最优方案 ---');
      printResult(svc.search(versionId));
      console.log('--- 核验外部向量 [0,1]（只泛化城市） ---');
      printResult(svc.verify(versionId, [0, 1]));
      console.log('--- 限制年龄最高层级为 0 后搜索 ---');
      try {
        printResult(svc.search(versionId, { 年龄: 0 }));
      } catch (e) {
        if (e instanceof ApiError) console.log(`无解[${e.code}]: ${e.message}`);
        else throw e;
      }
      console.log('--- 发布向量 [1,0] ---');
      const pub = svc.publish(versionId, [1, 0]);
      console.log(`发布表 ${pub.rows.length} 行（reportId=${pub.reportId}）:`);
      for (const row of pub.rows) console.log(' ', JSON.stringify(row));
      break;
    }
    case 'serve': {
      const portArg = args[0] ? Number(args[0]) : 0;
      const port = await listen(createServer(svc), portArg);
      console.log(`API 服务已启动: http://127.0.0.1:${port}`);
      break;
    }
    case 'create': {
      const input = loadInput(args[0]);
      console.log(svc.createVersion(input, args[1] ? Number(args[1]) : undefined));
      break;
    }
    case 'validate':
      console.log(svc.validate(Number(args[0])));
      break;
    case 'search': {
      const r = svc.search(Number(args[0]), args[1] ? JSON.parse(args[1]) : undefined);
      printResult(r);
      console.log(`reportId=${r.reportId}`);
      break;
    }
    case 'groups':
      printResult(svc.groups(Number(args[0]), args[1].split(',').map(Number)));
      break;
    case 'verify': {
      const r = svc.verify(Number(args[0]), args[1].split(',').map(Number));
      printResult(r);
      console.log(`reportId=${r.reportId}`);
      break;
    }
    case 'publish': {
      const r = svc.publish(Number(args[0]), args[1].split(',').map(Number));
      console.log(`已发布 ${r.rows.length} 行，reportId=${r.reportId}`);
      break;
    }
    case 'report':
      console.log(JSON.stringify(svc.getReport(Number(args[0])), null, 2));
      break;
    default:
      console.log(`用法: node dist/src/cli.js <命令>
  demo                          运行内置演示（搜索/核验/限制/发布）
  serve [端口]                  启动 API 服务（默认自动选空闲端口）
  create <input.json> [数据集ID] 保存数据集新版本
  validate <版本ID>             检查输入
  search <版本ID> [限制JSON]    搜索最优层级向量
  groups <版本ID> <向量如1,0>   查询等价组
  verify <版本ID> <向量>        核验外部层级向量
  publish <版本ID> <向量>       导出发布表
  report <报告ID>               查看本地核验报告`);
  }
}

main().catch((e) => {
  if (e instanceof ApiError) {
    console.error(`错误[${e.code}]: ${e.message}`);
    if (e.details) console.error(JSON.stringify(e.details, null, 2));
    process.exit(2);
  }
  console.error(e);
  process.exit(1);
});
