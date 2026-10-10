# 门禁定义（唯一权威）

一条门禁一行：**守什么规矩**、**读哪处真值源**、**失败说明什么**。
`tests/consistency.test.js` 里注册的用例名与下表一一对应（多了或少了都是测试失败）。
新增门禁要同一次写进这张表、并在 `tests/consistency.test.js` 注册同名用例，否则一致性用例直接失败。

| 用例 | 守什么 | 真值源 |
| --- | --- | --- |
| 档位表与代码一一对应 | 插件七档查找顺序的说明与实现一致 | `lib/plugin-root.js` 的 `pluginPlaces()` ↔ [`plugin-sources.md`](plugin-sources.md) 的表格 |
| 字面量只在真值源 | 端口、钉死版本、环境变量名这类值只在一处定义 | `tests/consistency.test.js` 的单源清单（值从真值源读出来） |
| 判据台账与代码对得上 | 一件事的判据只在一处：台账登的那段字符串在 `lib/`、`ui/src/` 下只出现在登记的那个文件里 | [`facts.md`](facts.md) 的判据表 ↔ 本仓源码（用例是夹具，不算） |
| 复核台账每行都有处置 | 审计给的每条意见都要有结论，不留「待看」 | [`audit-ledger.md`](audit-ledger.md) 的处置列（已收 / 不修 / 独立一轮） |
| 引用的文档都存在 | 文档改名/删掉之后别处的引用不许留死链 | `docs/` 下真实存在的文件 |
| 一句话只有一处说 | 复查节拍、装插件门禁这类事实只在一份文档里说 | `tests/consistency.test.js` 的事实表 |
| 逐档清单不在别处复述 | 插件七档清单只在它那份权威文档里列 | `lib/plugin-root.js` 的档位名 ↔ 全仓说明与注释 |
| 每份文档都进索引 | 新增说明文档必须进索引，不然没人找得到 | [`README.md`](README.md) 的索引表 ↔ `docs/*.md`；[`records.md`](records.md) ↔ `docs/records/*.md` |
| 顶层条目都在结构表里 | 仓库根新增/改名要同一次写进结构表 | [`structure.md`](structure.md) 里用反引号标出的名字（目录表 + 根条目清单）↔ 仓库根实际条目 |
| 每个模块都有职责头 | 一个模块的职责写在它自己文件头，只有一处 | `lib/`、`shared/`、`scripts/`、`scripts/lib/`、`ui/src/app`、`ui/src/lib` 每个文件：头 30 行里第一段注释（块注释或连续 `//`）去掉空白后 ≥ 30 字 |
| helper 只一处定义 | 容错读 JSON、Target/工程目录校验这类 helper 只在一处实现，别处只准引用 | `tests/consistency.test.js` 的单实现清单 ↔ `lib/workdir.js`、`lib/name-safety.js`、`lib/layout-groups.js` |
| 插件切换散文与实现一致 | 来源表能不能手动切换，代码与权威文档要同一次说清 | `lib/plugin-root.js` 的 `canOverride`、`lib/settings.js` 的 `pluginOverride` ↔ [`plugin-sources.md`](plugin-sources.md) |
| 界面认的自带档在后端清单里 | 界面只认「客户端自带」这一个档位 id，它必须是后端真列出来的那一档 | `lib/plugin-root.js` 的档位 id ↔ `ui/src/lib/plugin-sources.ts` 的 `INSTALL_SLOT_ID` |
| 功能结构表登记模块 | 新增 `lib/` 模块与 `ui/src/app/` 界面件要同一次写进结构表 | [`structure.md`](structure.md) 的「功能结构」表 ↔ 仓库里 `lib/*.js`、`ui/src/app/` 下的界面件（用例除外） |
| 说明里的前端路径都在 | 模块搬家 / 改名之后，说明里指路的那一句不许留在原地 | 索引、结构、判据、门禁、档位、发布、记录索引那几份说明里带反引号的 `ui/src/…`、`tests/…` 路径 ↔ 仓库里真实存在的文件（跨仓引用不在范围内） |
| 门禁定义与实际用例一致 | 门禁本身也只有一处说明 | 本文的表 ↔ `tests/consistency.test.js` 注册的用例名 |
| 共享模块类型与导出一致 | 共享库的类型声明不跟运行时导出走样 | `shared/versions.cjs` 的导出 ↔ `shared/versions.d.cts` 声明的导出名 |

## 别处已有的门禁

除上面这些，CI 还有两类不属于本表的检查（它们各自由 CI 的实现定义，这里只说明位置）：

- **确定性检查**（CI 的 `deterministic-validation`）：写死的机器路径、无人引用的导出、**前后端分层**、CI 版本钉死。
  分层允许的方向见 [`structure.md`](structure.md) 的「依赖方向」。
- **语义审计**（CI 的 `semantic-audit`）：按规则读改动并给复核意见；它给的是一致性意见，不是门禁本身。
