#!/usr/bin/env node
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Store } from '../core/db.js';
import { AnalysisService } from '../core/service.js';
import { AppError } from '../core/errors.js';
import { demoDataset, identicalDataset } from '../demo/data.js';
import type { SearchResult, VerificationResult } from '../core/types.js';

const DATA_DIR = process.env.KANON_DATA_DIR ?? resolve(process.cwd(), 'data');
const DB_PATH = resolve(DATA_DIR, 'kanon.sqlite');

function printVector(vector: number[]): string {
  return `[${vector.join(', ')}]`;
}

function printVerification(label: string, v: VerificationResult): void {
  console.log(`\n${label}`);
  console.log(`  层级向量: ${printVector(v.vector)}  损失: ${v.loss}`);
  console.log(
    `  可行: ${v.feasible ? '是' : '否'}  k=${v.k}  组数=${v.groups.length}  ` +
      `最小组=${v.minGroupSize}  最大组=${v.maxGroupSize}  组大小总和=${v.groupSizeSum}`,
  );
  console.log('  等价组:');
  for (const g of v.groups) {
    const flag = g.size < v.k ? '  <-- 小于 k' : '';
    console.log(
      `    键=(${g.key.join(', ')})  大小=${g.size}  行=[${g.rowIds.join(', ')}]${flag}`,
    );
  }
}

function printSearch(label: string, r: SearchResult): void {
  console.log(`\n${label}`);
  console.log(
    `  字段=[${r.fields.join(', ')}]  k=${r.k}  总行数=${r.totalRows}  可行向量数=${r.feasibleVectorCount}`,
  );
  if (r.best) {
    printVerification('  最优方案:', r.best);
  } else {
    console.log(`  无可行方案。原因：${r.reason}`);
  }
}

function demoCommand(): void {
  const store = new Store(DB_PATH);
  const service = new AnalysisService(store);
  try {
    console.log('=== k 匿名全局泛化演示（虚构数据）===');

    const input = demoDataset();
    const saved = service.saveInput(input, null, '题目示例 k=2');
    console.log(`已保存 dataset=${saved.datasetId} version=${saved.versionId}`);

    // 错误对照：只泛化城市、保留精确年龄 [0,1]
    const cityOnly = service.verify(saved.versionId, [0, 1]);
    printVerification('对照向量 [0,1]（只泛化城市，年龄精确）:', cityOnly);

    // 最优搜索
    const best = service.search(saved.versionId);
    printSearch('搜索结果:', best);

    // 限制年龄最高层级为 0：即使城市全合并也无解
    const restricted = service.compare(saved.versionId, [{ age: 0 }]);
    console.log('\n限制 age 最高层级=0 的比较结果:');
    console.log(JSON.stringify(restricted, null, 2));

    // 发布最优方案并导出
    if (best.best) {
      const pub = service.publish(saved.versionId, best.best.vector);
      const version = service.getVersion(saved.versionId);
      const outDir = resolve(DATA_DIR, 'exports');
      mkdirSync(outDir, { recursive: true });
      const csvPath = resolve(outDir, `publish_v${saved.versionId}.csv`);
      writeFileSync(csvPath, toCsv(pub.publishedTable, version.quasiIdentifiers), 'utf8');
      console.log(`\n已发布 publication=${pub.publicationId}，CSV 导出：${csvPath}`);
      console.log(`发布表（不含内部行编号，共 ${pub.publishedTable.length} 行）:`);
      console.table(pub.publishedTable);
      console.log('本地核验报告的源行映射（不进入发布表）:');
      console.table(pub.report.rowToGroup);
    }

    // k=1 全同记录边界示例
    const idInput = identicalDataset();
    const idSaved = service.saveInput(idInput, saved.datasetId, 'k=1 全同');
    const idBest = service.search(idSaved.versionId);
    printSearch('边界示例（k=1，全同记录）:', idBest);

    console.log('\n演示完成。');
  } finally {
    store.close();
  }
}

function toCsv(rows: Array<Record<string, string>>, fields: string[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = fields.map(esc).join(',');
  const body = rows.map((row) => fields.map((f) => esc(row[f] ?? '')).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

function usage(): void {
  console.log(`用法:
  kanon demo                         运行内置演示并写库/导出
  kanon inspect <file.json>          仅检查输入
  kanon save <file.json> [note]      保存为新版本（新数据集）
  kanon search <versionId>           搜索最优层级向量
  kanon verify <versionId> 0,1,0     核验指定层级向量并列出小组
  kanon groups <versionId> 0,1,0     查询等价组
  kanon compare <versionId> <json>   比较最高层级限制，如 '{"age":0}'
  kanon publish <versionId> 0,1,0    事务化发布并导出 CSV
  kanon pub <publicationId>          复查已保存的发布与报告
  kanon versions <datasetId>         列出数据集的版本

环境变量:
  KANON_DATA_DIR   数据目录（默认 ./data）
  PORT             HTTP 端口（默认自动选择空闲端口）`);
}

function loadJson(path: string): unknown {
  return requireJson(path);
}

async function requireJson(path: string): Promise<unknown> {
  const url = new URL(`file:///${resolve(path).replace(/\\/g, '/')}`);
  return (await import(url.href, { with: { type: 'json' } })).default as unknown;
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === '-h' || cmd === '--help') {
    usage();
    return;
  }

  if (cmd === 'demo') {
    demoCommand();
    return;
  }

  const store = new Store(DB_PATH);
  const service = new AnalysisService(store);
  try {
    switch (cmd) {
      case 'inspect': {
        const result = service.inspect(await loadJson(args[0]!));
        console.log(
          `输入合法：字段=[${result.quasiIdentifiers.join(', ')}] ` +
            `记录=${result.records.length} 层级空间=${result.vectorSpaceSize}`,
        );
        break;
      }
      case 'save': {
        const saved = service.saveInput(await loadJson(args[0]!), null, args[1] ?? '');
        console.log(`已保存 dataset=${saved.datasetId} version=${saved.versionId}`);
        break;
      }
      case 'search': {
        printSearch('搜索结果:', service.search(Number(args[0])));
        break;
      }
      case 'verify': {
        const vector = parseVector(args[1]);
        printVerification('核验结果:', service.verify(Number(args[0]), vector));
        break;
      }
      case 'groups': {
        const vector = parseVector(args[1]);
        printVerification('等价组:', service.groups(Number(args[0]), vector));
        break;
      }
      case 'compare': {
        const restrictions = JSON.parse(args[1]!) as Record<string, number>;
        console.log(JSON.stringify(service.compare(Number(args[0]), [restrictions]), null, 2));
        break;
      }
      case 'publish': {
        const versionId = Number(args[0]);
        const vector = parseVector(args[1]);
        const pub = service.publish(versionId, vector);
        const version = service.getVersion(versionId);
        const outDir = resolve(DATA_DIR, 'exports');
        mkdirSync(outDir, { recursive: true });
        const csvPath = resolve(outDir, `publish_v${versionId}.csv`);
        writeFileSync(csvPath, toCsv(pub.publishedTable, version.quasiIdentifiers), 'utf8');
        console.log(`已发布 publication=${pub.publicationId}，CSV：${csvPath}`);
        printVerification('发布方案:', pub.verification);
        break;
      }
      case 'pub': {
        console.log(JSON.stringify(service.getPublication(Number(args[0])), null, 2));
        break;
      }
      case 'versions': {
        console.table(service.listVersions(Number(args[0])));
        break;
      }
      default:
        usage();
    }
  } catch (err) {
    if (err instanceof AppError) {
      console.error(`错误 [${err.code}] ${err.message}`);
      if (err.details) console.error(JSON.stringify(err.details));
      process.exitCode = 1;
    } else {
      throw err;
    }
  } finally {
    store.close();
  }
}

function parseVector(raw: string | undefined): number[] {
  if (!raw) throw new AppError('INVALID_VECTOR', '缺少层级向量，例如 0,1,0');
  const parts = raw.split(',').map((s) => Number(s.trim()));
  if (parts.some((n) => !Number.isInteger(n))) {
    throw new AppError('INVALID_VECTOR', `层级向量非法：${raw}`);
  }
  return parts;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
