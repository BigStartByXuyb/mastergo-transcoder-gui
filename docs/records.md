# 界面验收记录（索引）

每完成一个任务，除单元测试外，还要在真实界面上把这次涉及的功能点一遍，结论按月份记在 [`records/`](records/2026-10.md) 下这些文件里。按时间倒序。
**每一条记的是当次的口径**；当前口径以代码与 [`docs/README.md`](README.md) 索引指向的那份权威文档为准
（记录里的档位数、路径、变量名都可能是当时的实况）。

| 文件 | 覆盖 |
| --- | --- |
| [`records/2026-10.md`](records/2026-10.md) | 2026 年 10 月 |
| [`records/2026-09.md`](records/2026-09.md) | 2026 年 9 月 |

新增记录：往对应月份文件里**从文件头往下加**（每条一个 `## 2026-MM-DD 标题`）；跨月就新建 `records/YYYY-MM.md`，
并在这里加一行。

## 怎么点

用根 [`README.md`](README.md)「开发」一节的命令起后端与前端，再用 `playwright-cli` 的
`open / snapshot / click / screenshot` 点这次涉及的功能点。两条纪律：

1. ref 只在当次 snapshot 内有效。点按钮后列表会重渲染，旧 ref 会指到别的元素 —— 改状态的操作一次 snapshot 配一次 click。
2. `goto "#另一页"` 只是 hash 变化，浏览器不会重新拉 index.html。前端重新构建后必须 `reload`，否则点到的是上一份构建。
