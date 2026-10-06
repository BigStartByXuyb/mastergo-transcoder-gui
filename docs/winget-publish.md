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

1. 先本机生成这一版的清单（发布流程已经做了这一步，Release 上就有那三个 YAML）：

   ```powershell
   node scripts/pack-bundle.js --version 0.6.47
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

## 路二：内网源（保密机唯一可用的那条）

winget 认两种内网源：**REST 源**（一个实现 winget REST 接口的服务）与「预索引源」（要打成源包）。
可落地的是 REST 源 —— 微软有官方样例仓库 `microsoft/winget-cli-restsource`，可以自托管到内网。

1. 由 IT 在内网起这个 REST 源（容器或函数都行），放进我们的清单与 zip：
   - 清单：`scripts/winget-manifest.js --base <内网 zip 地址基址> --kind gitlab --id BigStart.MasterGoTranscoder.Internal` 生成；
   - 包：把 `mastergo-transcoder-gui-<版本>.zip` 放到内网（GitLab 通用包 / nginx 目录都行）。
   ```powershell
   winget source add -n 公司 -a https://winget.内网/api -t Microsoft.Rest
   winget install BigStart.MasterGoTranscoder.Internal
   ```

2. 若 IT 不愿建源，还有一条「不开源、只开策略」的替代：
   管理员在客户机上启用本地清单安装（一次即可）：

   ```powershell
   winget settings --enable LocalManifestFiles     # 需要管理员
   ```

   之后客户机把三个 YAML 放到任一目录，`winget install --manifest <目录>` 就能装。
   （这正是本机最初报"需要管理员启用"的那一步；本机当前用户不是管理员，所以走不通。）

## 这两条都到位之前，客户机怎么装

用 Release 上的 `install-client.ps1`（一条命令，不需要管理员、不需要源）：

```powershell
powershell -ExecutionPolicy Bypass -File install-client.ps1
# 内网：powershell -ExecutionPolicy Bypass -File install-client.ps1 -ZipUrl <zip 直链> -Sha256 <哈希>
```

它做的与 winget portable 内部一样：下载 → 按 `checksums.json` 校验 → 解压到用户目录 → 建快捷方式。
等内网源建好之后，再让客户机改用 winget 装（两者用的都是同一份 zip）。
