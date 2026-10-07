# 用 winget 装：两条路怎么落地

`winget install <包>` 只会去**它配置的源**里搜包。清单文件光放在 Release 上是搜不到的 ——
必须提交到「公网源」或建一个「内网源」。这篇写给两件事：**怎么提交、谁来提交、要谁配合**。

## 先明确：谁去哪条路

| 客户机 | 走哪条 | 为什么 |
| --- | --- | --- |
| 能上外网、随便装软件 | **公网源（winget-pkgs）** | 提交一次，之后所有人一条命令装；Microsoft 会做校验与审核 |
| 保密内网、上不了外网 | **内网源** | 公网源都连不上，谈提交没意义；由 IT 在内网起一个 winget 源 |

两条都需要**客户机能访问到源**，这与"我们的包放在哪"是两件事：包地址在清单里（`InstallerUrl`），源地址在客户机的 winget 配置里。

## 路一：公网源（winget-pkgs）

前提：GitHub 账号（用你的账号提交，我用不了你的账号）+ 能访问 github.com。

1. 先本机生成这一版的清单（发布流程已经做了这一步，Release 上就有那三个 YAML）。
   下面 `<版本>` 一律换成要发布的那一版（与 package.json 一致）：

   ```powershell
   node scripts/pack-bundle.js --version <版本>
   node scripts/winget-manifest.js            # 默认基址＝GitHub 仓库，产物在 dist/winget
   winget validate dist/winget                # 本地先过一遍模式校验
   ```

2. 用官方工具自动分叉并提 PR（最省事）：

   ```powershell
   winget install Microsoft.WingetCreate
   wingetcreate submit --token <你的 GitHub PAT> dist/winget
   ```

   它会 fork `microsoft/winget-pkgs`、把清单放到
   `manifests/b/BigStart/MasterGoTranscoder/<版本>/`，并开好 PR。

   手工也行：把三个 YAML 放到上面那个目录，照着仓库里 `CONTRIBUTING.md` 开 PR。

3. 等合并（自动校验 + 人工复核，通常几小时到一两天）。合并之后**任何机器**：

   ```powershell
   winget install BigStart.MasterGoTranscoder
   ```

   后续每发一版，用 `wingetcreate update BigStart.MasterGoTranscoder --version <新版本> -u <zip 地址> -s <sha256>`
   提一个新 PR 即可（我们的 `scripts/winget-manifest.js` 生成的三个文件就是同样内容）。

## 路二：内网源（保密机用的那条 —— 已经建好）

这条路已经落地并实测过：内网一台机器上跑 `scripts/winget-source-server.js`（照 winget 的 REST 源协议
回答服务信息 / 搜索 / 取清单，同时发 zip 与证书），客户机管理员配一次源就能
`winget install BigStart.MasterGoTranscoder.Internal`。
地址、服务端从零起一份、发一版新的、客户机命令、实测记录**全在 `docs/winget-internal-source.md`**，
这里不重复。

（winget 认两种内网源：**REST 源**与「预索引源」（要打成源包）。我们用 REST 源 ——
微软的官方样例仓库 `microsoft/winget-cli-restsource` 是同一套协议。）

若 IT 不愿动源，还有一条「不开源、只开策略」的替代：管理员在客户机上启用本地清单安装（一次即可）：

```powershell
winget settings --enable LocalManifestFiles     # 需要管理员
```

之后客户机把三个 YAML 放到任一目录，`winget install --manifest <目录>` 就能装。
（这正是本机最初报“需要管理员启用”的那一步；本机当前用户不是管理员，所以走不通。）

## 不想动 winget 的机器怎么装

不需要源、不需要管理员的那条路（取脚本 → 下载 zip → 按 `checksums.json` 校验 → 解压到用户目录 → 建快捷方式）
写在 `docs/install.md` 的「一条命令装」，包含连不上 github.com 时的内网变体，这里不重复。
这条路与 winget 那两条用的是同一份 zip，装出来的东西一样，只是分发方式不同。
