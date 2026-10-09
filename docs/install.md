# 安装与首次配置

面向拿到本客户端的人：解压、双击、把四样东西配好，之后就能自己更新。

## 一、包是什么

Release 上有两种东西：

| 资产 | 给谁用 |
| --- | --- |
| `mastergo-transcoder-gui-<版本>.zip` | 给人下载的「解压即用」包：解压出来就是一个能跑的客户端 |
| `manifest.json` + 一串 sha256 文件 | 给客户端做差分更新用的，不用手动下 |

解压出来的目录里应该有：`start.cmd`、`launch.js`、`server.js`、`lib\`、`public\`、`vendor\`、`package.json`、`changelog.json`。**不要**把包解到需要管理员权限的位置，也**不要**解到 OneDrive 这类会同步的目录里（跑流水线时文件会被反复改写）。

包里还有两个东西，是给「这台机器上没有 Node」的情况用的：

| 文件 | 干什么的 |
| --- | --- |
| `mastergo-transcoder.exe` | **启动器（推荐双击它）**：不依赖 Node，能自己把缺的运行组件补齐（见下一节） |
| `runtime-assets.json` | 启动器用的钉死表（要补哪一版、什么文件名、sha256、官方地址）；由发版脚本从 `lib/runtime.js` 导出 |

## 二、双击之前先看这几条（缺一样就用不了对应能力）

| 缺什么 | 会怎样 | 怎么补 |
| --- | --- | --- |
| **Codex（AI Agent）** | 「自动 / 对话」模式整条不可用：对话页发不出消息，待确认里的「AI 出候选」也不行；只剩纯脚本跑流水线 | 设置 → AI Agent → 下载；或本机已装 Codex 客户端也能被检测到 |
| **插件 `mastergo-wpf-transcoder`** | 转码整条流水线不可用：看板/流水线点「启动」会报找不到引擎与 `run-all.ps1` | 两条路任选：设置 → 更新 → 插件（流水线）里点「下载并安装」（客户端给自己装一份，不需要 agent）；或在你用的 agent（Codex / Claude）里装 —— 客户端按固定的查找顺序取用，见 [`plugin-sources.md`](plugin-sources.md) |
| **Node 运行时（客户端自带那份）** | 起不来 | 首次启动后 设置 → 运行环境 → 下载（钉死 24.21.0） |
| **PowerShell 7 运行时（客户端自带那份）** | 流水线跑不动（插件脚本是 PowerShell） | 同上，设置 → 运行环境 → 下载（钉死 7.6.6） |
| **MasterGo token** | 取不到设计稿：查询、跑任务都在第一步停下 | 设置 → MasterGo token，填一次即存在本机 |
| **模型 key** | 辅助 / 自动 / 对话都用不了 | 设置 → AI token，填厂商、地址、模型与 key |
| **模型依赖（`openai`）** | 只有「让它出候选 / 翻译」这条路会报缺少依赖；脚本流水线不受影响 | 包里的 `vendor\openai.tgz` 首次用到时自己解开，不用管；解不开（系统没有 `tar`）就重新下一份包 |

另外两条硬前提：

- **只支持 Windows x64**（运行时与打包都按这个来）。
- **默认钉死的运行时与 Codex 版本不要换**：它们在关键路径上，换坏了整个客户端起不来。能切的只有「程序本身」和「Codex 版本」。

## 二之一、插件：找哪一份、怎么装

客户端按一份**固定的查找顺序**（七档，先命中先用）找 `mastergo-wpf-transcoder`；哪几档、每一档归谁管、
界面上怎么显示 —— 只在 [`plugin-sources.md`](plugin-sources.md) 一处说。

这里只说两条要点：**没装插件时客户端就停下并列出它查过的位置**（客户端不随包分发插件）；
**装它不用先装 Codex / Claude** —— 设置 → 更新 → 插件（流水线）里点「下载并安装」即可
（发布件协议见 [`release-and-update.md`](release-and-update.md)）。

## 三、第一次跑

1. 双击 **`mastergo-transcoder.exe`**（推荐）：它会先看运行时齐不齐 ——
   我们自己的那份在就直接起；没有就看这台机器 PATH 上的 `node`（版本够新就用它，并在界面里写明「这次用的是系统上的 node」）；
   两个都没有才去下载（约 40 MB），下完校验 sha256、解压到 `runtime\node\<版本>\` 再起。
   包里的 `start.cmd` 仍然能用，但它自己需要 Node —— 机器上没装 Node 时请用上面那个 exe。
   两种入口都是：起本地服务并打开浏览器；关掉那个窗口就是退出。
  更新分两层：应用内更新换的是 `versions\<版本>\` 里那一份（设置、凭据、指针都不动），
  安装根的启动壳（`launch.js` + `lib/launch.js` 这两份，壳自己拥有，不含服务的模块）由新版在启动时
  对齐一次 —— 所以**第一次**装带这个能力的版本要用整包装（winget / 解压即用 zip / `install-client.ps1`），
  之后壳的改动也能靠应用内更新到达。
2. 按上一节的表把四样配好（插件、运行时、token、key）。
3. 顶部若显示「引擎缺失 / 插件缺失」，先解决它再往下走：插件可以在设置 → 更新 → 插件（流水线）里
   「下载并安装」，不用装 Codex / Claude 也能转码。缺运行时（Node / PowerShell 7）时，
   在「设置 → 运行环境」那一张表里点对应行的「下载」；内网机器在那一行的「来源」里把安装包地址改成内网镜像。
4. 看板 → 创建任务 → 填工程目录 + 链接 → 加入看板 → 启动全部。
5. 跑到等语义输入的地方（图标定名、文案译文）会停在「待确认」：在那里点「AI 出候选」或手填，填完自动接着跑。

## 三之一、用 winget 装（推荐给批量发放）

> **先看这一条**：winget 只从它配置的源里找包，所以两个标识要分开看 ——
> 公网的 `BigStart.MasterGoTranscoder` **还装不上**（清单在等 `winget-pkgs` 的人工复核）；
> 内网的 `BigStart.MasterGoTranscoder.Internal` **已经能装**（内网源已建好并实测过，
> 管理员配置一次源，见 `docs/winget-internal-source.md`）。
> **今天就要装、又不想动 winget** 请用下面「一条命令装」那一节（不需要管理员、不需要源）。

winget 装的是 portable 包：**下载 zip → 解压到它自己的包目录 → 把 `mastergo-transcoder.exe` 链进 PATH**，
不跑任何安装程序 —— 保密环境里也一样。装完在任意目录敲 `mastergo-transcoder` 就能起。

```powershell
winget install BigStart.MasterGoTranscoder
```

**两条命令对应两个不同的包标识**（同一台机器上两个同名包会打架，内网那份也不该出现在公网 winget-pkgs 里）：

- 公网 / GitHub（现在默认）：`winget install BigStart.MasterGoTranscoder`
- 内网（自建源）：`winget install BigStart.MasterGoTranscoder.Internal`

包地址与清单怎么落地：公网那条（提 PR、谁提交、要谁配合）在 `docs/winget-publish.md`，
内网那条（服务怎么起、怎么发版、客户机怎么配）在 `docs/winget-internal-source.md`，这里都不重复。

## 三之二、一条命令装（不需要管理员、不需要 winget 源）

客户机上一个文件都没有也能装。**一行**，粘进 Windows PowerShell 5.1 回车即可
（先把安装脚本取到本地，再运行它；给客户就直接发这一行）：

```powershell
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $f="$env:TEMP\install-client.ps1"; Invoke-WebRequest -UseBasicParsing "https://github.com/BigStartByXuyb/mastergo-transcoder-gui/releases/latest/download/install-client.ps1" -OutFile $f; powershell -ExecutionPolicy Bypass -File $f
```

脚本已经在本机时，直接 `powershell -ExecutionPolicy Bypass -File install-client.ps1` 即可；
`-File` 后面要的是**真实存在的路径**，在别的目录里跑会报「-File 的实际参数不存在」。

它做的三步与 winget portable 内部完全一样，只是我们自己走一遍：
**下载这一版的 zip → 按发布时那份 `checksums.json` 里的 sha256 校验 → 解压到 `%LOCALAPPDATA%\MasterGoTranscoder` → 建桌面快捷方式**。
不需要管理员（全在用户目录里），不跑任何安装程序；装完双击里面的 `mastergo-transcoder.exe` 即可（缺运行组件它自己补）。

**连不上 github.com 的机器**（内网 / 公司 GitLab / 任意镜像）：先把**安装脚本本身**也从那边取
（把 Release 上的 `install-client.ps1` 拷进内网目录即可），再给出 zip 直链与它的 sha256 —— 地址长什么样由那边决定，这里不猜：

```powershell
powershell -ExecutionPolicy Bypass -File install-client.ps1 -ZipUrl <zip 的完整地址> -Sha256 <64 位哈希>
```

`-Base` 只用于 GitHub 形状（`<基址>/releases/…`）；本节前面那段取脚本的命令里的基址，就是 `lib/source.js` 的 `DEFAULT_BASE` ——
默认源只在那一处定义，文档与脚本都被用例盯着不许漂。
其余参数：`-Version`（默认 latest）、`-Target`（默认 `%LOCALAPPDATA%\MasterGoTranscoder`）、`-NoShortcut`。

## 四、更新与回退

**更新来源**（程序更新那条与插件那条各自怎么设、可选哪三种源、私有源 token）与**复查节拍**只在
[`release-and-update.md`](release-and-update.md) 一处说。这里只说用起来是什么样：

- 客户端**自己发现新版**：有新版本就在右上角挂一个红点「有新版 vX」。
- 点红点：没下载就先下载，下载好了再点一下切过去（界面自己回来，不用手动重启）。
- 设置 → 更新里有整张版本表，每行按状态给动作：**正在用**（没有按钮）、**可切换**（切换）、**历史版本**（下载；只要那一版打过 tag 就能下回来）。
- **换版本会先弹窗确认**：回退会写明「之后发布的功能在这一版里没有」；如果那一版要求新开一次运行，也会写在这里；有任务在跑时确认按钮会挡住，跑完再切。
- 回退之后要**新开一次运行**再跑任务：跨版本的续跑不认（清单里的 `freshRunRequired`）。

## 五、出问题先看这三处

| 现象 | 先看 |
| --- | --- |
| 顶部「服务未就绪」 | 客户端那个窗口（`start.cmd` 或 `mastergo-transcoder.exe`）还在不在；关了窗口服务就没了 |
| 「引擎缺失」 | 插件装了没、装在哪（设置 → 更新 → 插件（流水线）列出各档位置与正在用的那一份；口径见 [`plugin-sources.md`](plugin-sources.md)） |
| 更新相关 | 设置 → 更新：状态、上次检查时间、失败原因都在这；离线时断网只影响更新与下载 |
