# 有限层级 k 匿名泛化与等价组核验后端

纯本地、零运行时第三方依赖的演示项目：TypeScript + Node.js（内置 `node:sqlite` 与 `node:http`）。
只处理自造演示数据，不处理真实个人信息；不做字段令牌化、差分隐私加噪或机器学习。

## 模型说明

- **全局泛化**：一列的所有行使用同一层级，不能逐行选择。层级 0 保留原值，逐级更一般。
- **层级体系**：每个原始叶子给出从自身到根的完整祖先链；同列链长一致、末位同根；
  同层同节点只能有一个父节点。未知叶子、长度不齐、冲突父节点、非法字段一律拒绝。
- **等价组**：按泛化后的准标识组合分组。准标识值完全相同的不同记录仍是不同人，计数不去重。
- **可行性**：所有等价组大小均 >= k 才可发布（不看平均组大小，不删除小组，不调小 k）。
- **信息损失口径**：损失 = 所选各列层级编号之和；损失相同按字段声明顺序的向量字典序取最小。
- **限制**：1~4 个准标识字段，每列最多 4 个可选层级（0..3），每列可指定允许的最高层级；
  在此有限空间内枚举全部向量求解，不调用现成匿名化求解器。
- **未解决风险（重要）**：k 匿名不等于完整隐私安全保证。本工具不处理同质性攻击
  （组内敏感值相同）、背景知识攻击、组合推断等问题；本项目也不发布额外敏感字段、不做记录抑制。

## 构建 / 测试 / 启动 / 演示

```powershell
npm install        # 仅安装 typescript 与 @types/node（开发依赖）
npm run build      # 编译到 dist/
npm test           # 构建并运行全部单元测试
npm run demo       # 运行内置演示（搜索 / 核验 / 限制无解 / 发布）
npm start          # 启动 API 服务（默认自动选择空闲端口）
node dist/src/cli.js serve 8123   # 指定端口
```

数据目录为项目内 `data/`（可用环境变量 `KANON_DB` 指定数据库文件路径）。

## CLI

```
node dist/src/cli.js demo                            内置演示
node dist/src/cli.js serve [端口]                    启动 API（默认空闲端口）
node dist/src/cli.js create <input.json> [数据集ID]  保存数据集新版本（修订输入即新版本）
node dist/src/cli.js validate <版本ID>               检查输入
node dist/src/cli.js search <版本ID> [限制JSON]      搜索最优层级向量（显示向量/损失/组大小）
node dist/src/cli.js groups <版本ID> <向量如1,0>     查询等价组
node dist/src/cli.js verify <版本ID> <向量>          核验外部层级向量（列出不满足 k 的小组）
node dist/src/cli.js publish <版本ID> <向量>         导出发布表（事务化，不可行则拒绝）
node dist/src/cli.js report <报告ID>                 查看本地核验报告（含源行->组映射）
```

输入 JSON 格式见 `src/demoData.ts` 的演示数据集。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/datasets` | 创建数据集首版本 |
| POST | `/datasets/:id/versions` | 修订输入创建新版本 |
| GET  | `/datasets/:id/versions` | 列出版本 |
| POST | `/versions/:id/validate` | 检查输入 |
| POST | `/versions/:id/search` | 搜索最优向量（body 可带 `constraints` 覆盖限制） |
| GET  | `/versions/:id/groups?vector=1,0` | 查询等价组 |
| POST | `/versions/:id/verify` | 核验外部向量 `{vector:[...]}`，重新分组并列出小组 |
| POST | `/versions/:id/compare-constraints` | 比较多组限制 `{sets:[{name,constraints}]}` |
| POST | `/versions/:id/publish` | 导出发布表（仅泛化后准标识，无内部行编号） |
| GET  | `/versions/:id/publish` | 查看已发布表 |
| GET  | `/reports/:id` | 查看本地核验报告 |

错误统一返回 `{ "error": { "code", "message", "details?" } }`，错误码见 `src/errors.ts`，
例如 `EMPTY_RECORDS`、`K_TOO_LARGE`、`DUPLICATE_ROW_ID`、`UNKNOWN_LEAF`、
`CHAIN_LENGTH_MISMATCH`、`CONFLICTING_PARENT`、`NO_FEASIBLE_SOLUTION`、`INFEASIBLE_VECTOR` 等。

## 持久化与事务

SQLite 保存原数据、层级、限制、参数 k、最优向量报告与分组摘要；修订输入创建新版本，
旧报告仍引用旧版本。发布与报告保存在同一事务中提交，失败回滚，不会留下被标为可发布的半表。

## 已知演示例

年龄 20/21/30/31、城市 甲/甲/乙/乙，k=2：

- 最优向量 `[年龄=1, 城市=0]`，损失 1，两个等价组各 2 人；
- 只泛化城市 `[0,1]` 仍有 4 个单人组，不可行；
- 限制年龄最高层级为 0 时，即使城市全部合并也无解（`NO_FEASIBLE_SOLUTION`）。

## 限制

- 仅演示用途；Node.js 的 `node:sqlite` 目前为实验特性（启动时有 ExperimentalWarning，不影响功能）。
- 枚举空间上限为 4 字段 x 4 层级，超出即拒绝，不做大规模优化。
