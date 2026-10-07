import type { DatasetInput } from '../core/types.js';

/**
 * 题目给定示例：全部为虚构演示数据。
 * 年龄 20/21/30/31，城市 甲/甲/乙/乙。
 * 年龄：层级0 原值；层级1 十段（20段/30段）；层级2 根 ALL_AGE
 * 城市：层级0 原值；层级1 根 ALL_CITY
 */
export function demoDataset(): DatasetInput {
  const ages = ['20', '21', '30', '31'];
  const ageChains: Record<string, string[]> = {};
  for (const age of ages) {
    const decade = Number(age) < 25 ? '20段' : '30段';
    ageChains[age] = [age, decade, 'ALL_AGE'];
  }

  return {
    name: '年龄城市示例',
    k: 2,
    quasiIdentifiers: ['age', 'city'],
    records: [
      { rowId: 'r1', values: { age: '20', city: '甲' } },
      { rowId: 'r2', values: { age: '21', city: '甲' } },
      { rowId: 'r3', values: { age: '30', city: '乙' } },
      { rowId: 'r4', values: { age: '31', city: '乙' } },
    ],
    hierarchies: [
      { field: 'age', chains: ageChains },
      {
        field: 'city',
        chains: {
          甲: ['甲', 'ALL_CITY'],
          乙: ['乙', 'ALL_CITY'],
        },
      },
    ],
  };
}

/** k=1、全部记录相同的边界示例 */
export function identicalDataset(): DatasetInput {
  return {
    name: '全同记录示例',
    k: 1,
    quasiIdentifiers: ['age', 'city'],
    records: [
      { rowId: 'a1', values: { age: '20', city: '甲' } },
      { rowId: 'a2', values: { age: '20', city: '甲' } },
    ],
    hierarchies: [
      { field: 'age', chains: { '20': ['20', 'ALL_AGE'] } },
      { field: 'city', chains: { 甲: ['甲', 'ALL_CITY'] } },
    ],
  };
}
