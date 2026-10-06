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
| **插件 `mastergo-wpf-transcoder`** | 转码整条流水线不可用：看板/流水线点「启动」会报找不到引擎与 `run-all.ps1` | 在你用的 agent（Codex / Claude）里装这个插件；客户端只定位、不代装。装在哪儿、用哪一份见「插件」那一节 |
| **Node 运行时（客户端自带那份）** | 起不来 | 首次启动后 设置 → 运行环境 → 下载（钉死 Node 24.21.0） |
| **PowerShell 7 运行时（客户端自带那份）** | 流水线跑不动（插件脚本是 PowerShell） | 同上，设置 → 运行环境 → 下载（钉死 7.6.6） |
| **MasterGo token** | 取不到设计稿：查询、跑任务都在第一步停下 | 设置 → MasterGo token，填一次即存在本机 |
| **模型 key** | 辅助 / 自动 / 对话都用不了 | 设置 → AI token，填厂商、地址、模型与 key |
| **模型依赖（`openai`）** | 只有「让它出候选 / 翻译」这条路会报缺少依赖；脚本流水线不受影响 | 包里的 `vendor\openai.tgz` 首次用到时自己解开，不用管；解不开（系统没有 `tar`）就重新下一份包 |

另外两条硬前提：

- **只支持 Windows x64**（运行时与打包都按这个来）。
- **默认钉死的运行时与 Codex 版本不要换**：它们在关键路径上，换坏了整个客户端起不来。能切的只有「程序本身」和「Codex 版本」。

## 二之一、插件装在哪儿（可以自己选）

客户端按这个顺序找 `mastergo-wpf-transcoder`，先命中先用：

1. 启动参数 `--plugin <插件目录>`
2. 设置里选的那一份
3. 环境变量 `MASTERGO_PLUGIN_ROOT`
4. `<CODEX_HOME>\plugins\cache` 与 `\marketplaces`（有多个版本时取最高版本）
5. `%USERPROFILE%\.claude\plugins\cache` 与 `\marketplaces`（同上）
6. 客户端自带的 `plugins\`（随包分发时才有）

设置 → **插件**把上面六处分两组列成两张表（位置 / 版本 / 状态 / 路径 / 切换）：

- **本机指定的位置**：启动参数、设置里选的、环境变量 —— 显式指定优先
- **自动查找的位置**：Codex 缓存与市场、Claude 缓存与市场、客户端自带 —— 客户端按顺序找

表里「正在用」的那一行就是此刻生效的那一份，点它的「用这份」立刻生效（不必重启）。
表格上面是两个分开的动作：**按顺序自动**（清掉「设置的」那一份，回到内置顺序）与
**指定一个目录**（插件装在别处时直接指过去，指到插件根或装着它的目录都认）。
同一台机器上同时装着 Codex 与 Claude 时，两边各有一份缓存，这两张表就是拿来分辨用的是哪一份的。
一处都没有时客户端照常打开，并把全部路径列出来 —— 照着它去装插件即可。

页脚那一段是**环境变量 `MASTERGO_PLUGIN_ROOT`**：填一个绝对路径点「保存」，就写进 Windows 的
**用户级**环境变量（不需要管理员；别的工具与命令行也认它），点「清除」删掉它。这里显示三个值，
分别是你需要分清的三件事：

| 显示 | 含义 |
| --- | --- |
| 这次运行读到 | 当前这个客户端进程启动时读到的值 —— 改它只有重启才变 |
| 系统里存的（用户级） | 刚才保存进去、以后新起的进程会读到的值 |
| 机器级 | 全机器的那一份，只读（改它要管理员） |

环境变量天生是「启动前定的」：保存/清除之后要关掉窗口、重新双击 `start.cmd` 才读到新值。
想让**这一次**就换插件，用同一页上面的「用这份」（它比环境变量更优先，只有启动参数压过它）。

## 三、第一次跑

1. 双击 **`mastergo-transcoder.exe`**（推荐）：它会先看运行时齐不齐 ——
   我们自己的那份在就直接起；没有就看这台机器 PATH 上的 `node`（版本够新就用它，并在界面里写明「这次用的是系统上的 node」）；
   两个都没有才去下载（约 40 MB），下完校验 sha256、解压到 `runtime\node\<版本>\` 再起。
   包里的 `start.cmd` 仍然能用，但它自己需要 Node —— 机器上没装 Node 时请用上面那个 exe。
   两种入口都是：起本地服务并打开浏览器；关掉那个窗口就是退出。
2. 按上一节的表把四样配好（插件、运行时、token、key）。
3. 顶部若显示「引擎缺失 / 插件缺失」，先解决它再往下走。缺运行时（Node / PowerShell 7）时，
   在「设置 → 运行环境」那一张表里点对应行的「下载」；内网机器在那一行的「来源」里把安装包地址改成内网镜像。
4. 看板 → 创建任务 → 填工程目录 + 链接 → 加入看板 → 启动全部。
5. 跑到等语义输入的地方（图标定名、文案译文）会停在「待确认」：在那里点「AI 出候选」或手填，填完自动接着跑。

## 三之一、用 winget 装（推荐给批量发放）

> **先看这一条**：`winget install BigStart.MasterGoTranscoder` 现在**还装不上** ——
> winget 只从它配置的源里找包，而我们的清单目前只是 Release 上的附件，没进任何源。
> 想让它一条命令就用，要么把清单提交到公网 `winget-pkgs`（要过审核），要么由 IT 在内网建一个 winget 源。
> **今天就要装**请用下面「一条命令装」那一节（不需要管理员、不需要 winget 源）。
> 两条路各自怎么落地（谁做什么、用什么命令）见 `docs/winget-publish.md`。

winget 装的是 portable 包：**下载 zip → 解压到它自己的包目录 → 把 `mastergo-transcoder.exe` 链进 PATH**，
不跑任何安装程序 —— 保密环境里也一样。装完在任意目录敲 `mastergo-transcoder` 就能起。

```powershell
winget install BigStart.MasterGoTranscoder
```

**两条命令对应两个不同的包标识**（同一台机器上两个同名包会打架，内网那份也不该出现在公网 winget-pkgs 里）：

- 公网 / GitHub（现在默认）：`winget install BigStart.MasterGoTranscoder`
- 内网 / 公司 GitLab：`winget install BigStart.MasterGoTranscoder.Internal`

包地址与清单怎么落地（公网提 PR / 内网建源，谁做什么、用什么命令）**全在 `docs/winget-publish.md`**，
这里不重复；生成内网那份清单的那条命令也在那篇里。

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


**更新从哪儿来**：设置 → 更新 → 「程序更新」卡片里那一行 **更新来源** → **修改发布源**。默认是内置的 GitHub 仓库（发布侧在打 tag 时把清单与文件传上去）；
客户环境可以改成自己的 GitLab（填项目地址，走通用包）或内网静态目录（把发布产物铺到那个目录即可）。
私有源另填一个只读 token（DPAPI 加密存本机）。三种源共用同一套协议：**一份清单 + 按文件哈希取差异**，
所以只改动的那些文件会被传输，回退就是把旧版本目录切回来。

- 客户端**自己发现新版**：启动查一次，之后每 10 分钟再查一次；有新版本就在右上角挂一个红点「有新版 vX」。
- 点红点：没下载就先下载，下载好了再点一下切过去（界面自己回来，不用手动重启）。
- 设置 → 更新里有整张版本表，每行按状态给动作：**正在用**（没有按钮）、**可切换**（切换）、**历史版本**（下载；只要那一版打过 tag 就能下回来）。
- **换版本会先弹窗确认**：回退会写明「之后发布的功能在这一版里没有」；如果那一版要求新开一次运行，也会写在这里；有任务在跑时确认按钮会挡住，跑完再切。
- 回退之后要**新开一次运行**再跑任务：跨版本的续跑不认（清单里的 `freshRunRequired`）。

## 五、出问题先看这三处

| 现象 | 先看 |
| --- | --- |
| 顶部「服务未就绪」 | `start.cmd` 那个窗口还在不在；关了窗口服务就没了 |
| 「引擎缺失」 | 插件装了没、装在哪（设置 → 插件列出全部位置与实际在用的那一份） |
| 更新相关 | 设置 → 更新：状态、上次检查时间、失败原因都在这；离线时断网只影响更新与下载 |
