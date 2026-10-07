# 有限层级 k 匿名泛化与等价组核验后端

一个只做 **API 与 CLI** 的本地后端，针对虚构表格数据执行**全局层级 k 匿名泛化**分析：
为每个准标识列**统一**选择一个泛化层级（一个层级向量），使泛化后每种准标识组合
（等价组）至少出现 `k` 次，并在有限层级空间中搜索**信息损失最小**的向量。

技术栈：TypeScript + Node.js（内置 `node:sqlite`，无需原生编译）+ 内置 HTTP 模块。
不依赖 Docker、WSL、付费服务或任何外部在线 API。仅使用自造演示数据。

> 重要边界：k 匿名**不是**完整隐私安全保证。本项目不做字段令牌化、差分隐私加噪或机器学习。

## 它做什么 / 不做什么

- 一列的**所有行必须使用同一层级**，不允许逐行挑选最有利的层级。
- 每个原始叶子值给出**从自身到根的完整祖先链**；同列链长一致、末端为同一根。
- 校验“同层同节点只有一个父节点”，保证是合法层级体系，而非临时任意分组。
- 层级 `0` 保留原值，逐级更一般。未知叶子、链长不齐、冲突父节点、非法字段一律**先拒绝**。
- **只有所有等价组大小都达到 k 才可发布**；不看平均组大小，不删除小组、不改小 k、不超允许层级。
- 不做记录抑制（suppression），也不发布额外敏感字段。
- 发布表**只含泛化后的准标识字段**，不含内部行编号；源行→等价组映射只保存在本地核验报告。
- 内部行编号唯一，但准标识值完全相同的记录仍是不同的人，计数**不去重**。

## 信息损失口径

- 损失 = 所选各列**层级编号之和**（层级越深越一般，损失越大）。
- 损失相同时，按**字段声明顺序**的层级向量取**字典序最小**者。
- 每列可设置允许的最高层级 `maxLevels`，用于限制过度泛化。
- 准标识字段限定 1–4 个，每列最多 4 个可选层级（`0..3`），因此直接枚举整个有限空间；
  分组、可行性判定与排序均为自行实现，未调用任何现成匿名化求解器。

## 尚未解决的风险（请知悉）

- **同质性攻击**：k 匿名只保证组内至少 k 人，不保证组内敏感属性多样，无法抵御同质性/背景知识攻击。
- **重识别仍可能发生**：外部数据变化或额外准标识被引入时，k 匿名结论可能失效。
- **泛化偏粗**：层级由人工定义，层级损失只反映“深度”，不刻画每一步实际语义损失。
- **无高维/大数据能力**：枚举方案面向小规模演示，字段和层级数受严格上限约束。
- 本项目不含访问控制、多用户隔离或传输加密，仅供本地单机使用。

## 环境要求

- Node.js `>= 22.5`（开发与实测于 Node `25.5`，使用内置实验性 `node:sqlite`，启动时会有实验警告，可忽略）。
- Windows 本地 PowerShell 直接运行；数据默认写入项目内 `data/`。

## 构建、测试、启动

```powershell
npm install        # 安装 typescript / 类型声明
npm run build      # 编译到 dist/
npm test           # 编译并运行 node:test 全部测试
npm start          # 启动 HTTP 服务（默认自动选择空闲端口）
npm run demo       # 运行内置 CLI 端到端演示
```

启动后控制台打印实际端口，例如 `http://127.0.0.1:49259`。

- 指定端口：`$env:PORT=8080; npm start`
- 指定数据目录：`$env:KANON_DATA_DIR="$PWD\data"`（默认即项目内 `data/`）

## CLI

```powershell
node dist/cli/index.js demo
node dist/cli/index.js inspect demo/sample.json
node dist/cli/index.js save demo/sample.json "首次导入"
node dist/cli/index.js search <versionId>
node dist/cli/index.js verify <versionId> 0,1     # 外部方案：重新分组并列出小于 k 的实际小组
node dist/cli/index.js groups <versionId> 1,0
node dist/cli/index.js compare <versionId> '{"age":0}'
node dist/cli/index.js publish <versionId> 1,0    # 可行才发布，导出 CSV 并落库
node dist/cli/index.js pub <publicationId>        # 复查已保存的发布表与核验报告
node dist/cli/index.js versions <datasetId>
```

CLI 会打印层级向量、损失、k、组数、最小/最大组大小、组大小总和及每组行编号，
对小于 k 的组标注 `<-- 小于 k`。发布 CSV 写入 `data/exports/`，仅含泛化后的准标识列。

## HTTP API

所有错误返回固定 `code` 与中文 `message`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET  | `/health` | 健康检查 |
| POST | `/api/inspect` | 仅校验输入，不落库 |
| POST | `/api/datasets/versions` | 新建数据集并保存首个版本（body 可含 `input`、`note`） |
| POST | `/api/datasets/{id}/versions` | 为既有数据集追加新版本（修订输入） |
| GET  | `/api/datasets/{id}/versions` | 列出数据集的版本 |
| GET  | `/api/versions/{id}` | 版本元信息 |
| POST | `/api/versions/{id}/search` | 搜索最优层级向量并保存摘要 |
| POST | `/api/versions/{id}/verify` | 核验 `{vector}`，重新分组并列出失败小组 |
| POST | `/api/versions/{id}/groups` | 查询指定向量的等价组 |
| POST | `/api/versions/{id}/compare` | 比较多组 `{restrictions:[{field:maxLevel}]}` |
| POST | `/api/versions/{id}/publish` | 可行才事务化发布并导出 |
| GET  | `/api/versions/{id}/solution` | 读取已保存的最优方案摘要 |
| GET  | `/api/publications/{id}` | 重启后复查发布表与本地核验报告 |

```powershell
# 示例（端口以控制台输出为准）
$b = "http://127.0.0.1:<port>"
Invoke-RestMethod "$b/api/inspect" -Method Post -ContentType 'application/json; charset=utf-8' -InFile demo/sample.json
```

### 错误码

| code | 含义 | HTTP |
| --- | --- | --- |
| `VALIDATION_ERROR` | 通用参数非法（含层级/字段数量超限、maxLevel 越界） | 400 |
| `UNKNOWN_LEAF` | 数据出现层级未定义的叶子值 | 400 |
| `CHAIN_LENGTH_MISMATCH` | 祖先链为空、长度不齐或链首不等于叶子 | 400 |
| `CONFLICT_PARENT` | 同层同节点存在多个父节点 | 400 |
| `ILLEGAL_FIELD` | 字段名非法、重复、缺失或缺少层级定义 | 400 |
| `DUPLICATE_ROW_ID` | 内部行编号重复 | 400 |
| `EMPTY_RECORDS` | 记录为空 | 400 |
| `INVALID_K` | k 非正整数 | 400 |
| `INVALID_VECTOR` | 待核验向量长度或层级越界 | 400 |
| `K_TOO_LARGE` | k 大于记录总数，任何方案都不可行 | 422 |
| `NO_SOLUTION` | 允许层级范围内无解，或试图发布不可行向量（附实际小组） | 422 |
| `NOT_FOUND` | 数据集/版本/发布记录不存在 | 404 |

## 数据模型与事务

SQLite 文件位于 `data/kanon.sqlite`（启用 WAL）。表：

- `datasets` / `versions`：原数据、层级、`maxLevels`、k、字段顺序按版本不可变保存。
- `solutions`：最优向量、损失、是否可行、可行向量数与分组摘要。
- `publications`：发布表 + 完整核验报告（含 `rowToGroup` 源行映射）。

修订输入会创建**新版本号**，旧版本与其发布/报告继续引用旧层级，不被覆盖。
发布表与报告在**单个事务**内同时提交；任何一步失败即回滚，不会留下被标为可发布的半表。

## 内置示例（手工可核对）

年龄 `20,21,30,31`，城市 `甲,甲,乙,乙`，`k=2`：

- 年龄层级 1：`20,21 -> 20段`，`30,31 -> 30段`；层级 2：全部 `ALL_AGE`。
- 城市层级 0 原值，层级 1：`ALL_CITY`。
- `[age=1, city=0]` 得到 `(20段,甲)` 与 `(30段,乙)` 两组各 2 人，**可行，损失 1**。
- `[age=0, city=1]` 只合并城市，年龄仍精确，得到 4 个单人组，**不可行**。
- 将 `age` 最高层级限制为 `0`，即使城市全部合并也**无解**（`NO_SOLUTION`）。

## 测试覆盖

`npm test` 覆盖：`k=1`、全部记录相同、多同损失方案的字典序、未知叶子、链长不齐、
冲突父节点、重复内部编号、允许层级边界、超过字段/层级上限、空记录、k 非正整数、
k 大于人数；并手工核对示例分组、逐行沿祖先链检查发布值、每行恰好进入一组且组大小总和等于行数；
另含事务回滚与**重启后报告复查**的 SQLite 集成测试。
