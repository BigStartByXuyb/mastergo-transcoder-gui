# 仓库流程

## 改动怎么进 main

main 受保护：只能通过 PR 合并，且必须通过下面这几关。直接 `git push origin main` 会被拒。

```bash
git switch -c <分支名>
# 改代码
git add -A && git commit -m "<一句话说明这版改了什么>"
git push -u origin <分支名>
gh pr create --fill        # 或者到仓库网页点「创建 PR」
gh pr merge --squash       # 检查全绿之后再合
```

必须通过：`launcher`、`ci / runtime-tests`、`ci / deterministic-validation`、`ci / semantic-audit`、`ci / final-report`。

PR 上的这几关读的是 **main 上那一份 `.github/workflows/ci.yml`**（触发方式是 `pull_request_target`），
所以分支里改 `ci_ref`（钉到 cicd 的那个 commit）当场不生效：它要随 PR 进 main 之后才对后续 PR 起作用。
想在合并前就用新 pin 验一次，在分支上手动跑 `gh workflow run ci.yml --ref <分支名>`（`workflow_dispatch` 读分支那一份）。

## 发版

合并进 main 只代表代码进了主干；**只有打 tag 才会产出 Release**，客户端的更新是从 Release 拉的。

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
```

tag 上会再跑一遍同一套检查，并额外产出发布件（zip、checksums.json、winget 清单、install-client.ps1）。
