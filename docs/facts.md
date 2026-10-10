# 判据台账（唯一权威）

一件事的判据只能在**一处**。下表左边是那件事，中间是它的真值源（文件 · 文件里那段唯一的字符串），
右边是读它的人。

`tests/consistency.test.js` 的「判据台账与代码对得上」按这张表机械核对：**那段字符串在 `lib/` 与
`ui/src/` 下只准出现在这一处**（用例是夹具，不算）—— 少一处（真值源里没有）或多一处（别处又写了一遍）
都当场失败。所以「同一件事有几处」不用靠人肉 grep。

新增一条判据 = 在这里加一行；判据换住处 = 改「真值源」这一格。

| 这件事 | 真值源（文件 · 那段唯一的字符串） | 谁在读它 |
| --- | --- | --- |
| 插件契约里「哪一步吃哪个输入文件」 | `lib/plugin.js` · `const INPUT_FILES = {` | `lib/board.js`（标人/AI 输入、给界面 `layoutStep`）、`lib/confirm.js`（写回之后的续跑锚点） |
| 任务与运行状态的中文名 | `lib/board.js` · `function stateLabelOf(` | 看板任务行（`publicTask`）、动作失败原话、`lib/pending-queue.js`（随条目给出 `stateLabel`） |
| 停点 / 失败那一行的措辞 | `ui/src/app/failure-note.tsx` · `export function failureTitle(` | 说明卡（同文件的 `FailureNote`）、看板任务行 |
| 「运行中不给续跑」的判据与说法 | `ui/src/lib/task-state.ts` · `export function isInFlight(`、`export function inFlightNote(` | 布局确认面板、待确认面板 |
| 收图的四条判据（空 / 读不出 / 太大 / 不是 PNG·JPEG） | `lib/design-image.js` · `function requireBitmap(` | 暂存（`stage`）与存图（`save`） |
| 先选的位图落地结果 | `lib/design-image.js` · `function installStaged(` | `lib/board.js`（写到任务行的 `designImage`） |
| 待确认清单的取数 | `ui/src/app/pending-panel.tsx` · `api.pending(` | 面板自己（唯一的取数处） |
| 面板动作的骨架（置忙 → 清旧错 → 跑 → 收尾） | `ui/src/app/use-action-runner.ts` · `export function useValueRunner(` | `useActionRunner`（同文件）、`use-task-actions.ts`、`use-layout-groups.ts`、`use-plugin-sources.ts`、`use-plugin-update.ts`、设置页四张卡（`update-card` / `codex-card` / `runtime-panel` / `source-dialog`） |
| 界面唯一的网络出口 | `ui/src/lib/api.ts` · `fetch(` | 所有界面件（别的文件不直接发请求） |

