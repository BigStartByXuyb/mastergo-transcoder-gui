# 内网 winget 源

`winget install <包>` 只去它配置的源里搜包：清单光挂在 Release 上是搜不到的。
公网那一条要走微软的提交与人工复核（`docs/winget-publish.md` 路一）；保密机连不上公网，也等不起。
这一条是在自己内网起一个源：客户机配置一次，之后每发一版都从它装。

两件事要分清：**包地址**写在清单里（这里就是源服务自己发的 zip），**源地址**写在客户机的 winget 配置里。

## 服务端跑的是什么

`scripts/winget-source-server.js` 按 winget 的 REST 源协议回答三件事，并把 zip 与证书当静态资产发：

| 地址 | 干什么 |
| --- | --- |
| `GET /api/information` | 报源名与支持的 REST 版本（winget 先问这一嘴，从中挑一个双方都认的） |
| `POST /api/manifestSearch` | 搜索：`(Query \|\| Inclusions...) && Filters...` |
| `GET /api/packageManifests/<标识>` | 取某个包的清单（`?Version=` 指定某一版） |
| `GET /files/<名字>` | 静态资产：这一版的 zip、客户机要装的证书 |

数据只有一份文件（`winget-source.json`）加一个静态资产目录；每次请求现读那份文件，
所以**发一版＝换掉数据文件，不用重启**。服务是只读的，没有鉴权，放在内网。

## 本次部署

| 项 | 值 |
| --- | --- |
| 服务地址 | `https://10.101.0.62:18443` |
| 客户机 `source add` 填的地址 | `https://10.101.0.62:18443/api` |
| 服务器上的目录 | `/home/ctyun/mastergo-winget` |
| 起服务 | `/home/ctyun/mastergo-winget/start.sh`（已加进 `crontab @reboot`，重启机器也会起来） |
| 证书 | `certs/mastergo-winget.crt`，自签，SAN＝`IP:10.101.0.62` |
| 源名 | `BigStart`（`winget source list` 里显示这个名字） |
| 包标识 | `BigStart.MasterGoTranscoder.Internal` |

## 服务端：从零起一份

服务机上要这些东西（其余都不用装：这些脚本只用 Node 自带的东西）。
清单只此一份，就是这个标了记的块：用例照它把文件摆进空目录、真起一次服务，漏一行就红。

<!-- winget-source-deploy:start -->
```
mastergo-winget/
  scripts/winget-source-server.js     ← 仓库 scripts/winget-source-server.js
  scripts/lib/args.js                 ← 仓库 scripts/lib/args.js
  scripts/lib/winget-manifest.js      ← 仓库 scripts/lib/winget-manifest.js
  scripts/lib/winget-source-api.js    ← 仓库 scripts/lib/winget-source-api.js
  lib/versions.js                     ← 仓库 lib/versions.js
  data/winget-source.json             ← scripts/winget-source.js 生成
  data/files/<这一版的 zip>            ← 同一个生成器一起放进去的
```
<!-- winget-source-deploy:end -->

拷上去用 `scp`。**那台机器没开 sftp，必须带 `-O`**（不带会报 `subsystem request failed on channel 0`）：

```powershell
scp -O scripts/winget-source-server.js ctyun@10.101.0.62:/home/ctyun/mastergo-winget/scripts/
scp -O scripts/lib/args.js scripts/lib/winget-manifest.js scripts/lib/winget-source-api.js ctyun@10.101.0.62:/home/ctyun/mastergo-winget/scripts/lib/
scp -O lib/versions.js ctyun@10.101.0.62:/home/ctyun/mastergo-winget/lib/
```

证书（一次性）：自签一张带 SAN 的，私钥留在 `certs/`（**不进 `data/files/`**，那里是要对外发的）：

```bash
cd /home/ctyun/mastergo-winget
mkdir -p certs data/files
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout certs/mastergo-winget.key -out certs/mastergo-winget.crt \
  -subj "/CN=mastergo-winget" -addext "subjectAltName=IP:10.101.0.62,IP:127.0.0.1,DNS:localhost"
cp certs/mastergo-winget.crt data/files/mastergo-winget.crt   # 客户机下载的就是这一张
```

起服务（`start.sh` 里写全参数，`@reboot` 也调它，命令只留一处；不停留任何状态文件，
停就用进程名停 —— 一次性写的 pid 文件在启动失败时会留下一个死 pid，反倒容易误伤别的进程）：

```bash
#!/bin/bash
cd "$(dirname "$0")"
exec node scripts/winget-source-server.js --root data --port 18443 \
  --cert certs/mastergo-winget.crt --key certs/mastergo-winget.key --identifier BigStart
```

```bash
chmod +x start.sh
nohup ./start.sh > server.log 2>&1 &
( crontab -l 2>/dev/null | grep -v mastergo-winget ; echo "@reboot /home/ctyun/mastergo-winget/start.sh >> /home/ctyun/mastergo-winget/server.log 2>&1" ) | crontab -
```

看一眼起来没有：

```bash
cat server.log                          # 端口：18443（HTTPS）
curl -sk https://127.0.0.1:18443/       # {"Ok":true,"Packages":1}
pkill -f winget-source-server.js        # 停；换数据文件不用停，重起才用得上
```

## 发一版新的

在本机（有这一版 zip 的那台）生成数据，再把两个文件送到服务器上对应的位置。
zip 可以是刚打的，也可以直接从 Release 下这一版的那一个（同名）：

```powershell
node scripts/pack-bundle.js --version <版本>                        # 产出 dist\mastergo-transcoder-gui-<版本>.zip
gh release download v<版本> -p "mastergo-transcoder-gui-<版本>.zip"  # 或者从 Release 拿同名的那个
node scripts/winget-source.js --base https://10.101.0.62:18443       # 产出 dist\winget-source\
scp -O dist\winget-source\winget-source.json ctyun@10.101.0.62:/home/ctyun/mastergo-winget/data/
scp -O dist\winget-source\files\mastergo-transcoder-gui-<版本>.zip ctyun@10.101.0.62:/home/ctyun/mastergo-winget/data/files/
```

不用重启：数据文件换掉，下一次询问就是新的。换完自己验一遍：

```powershell
curl.exe -sk https://10.101.0.62:18443/api/packageManifests/BigStart.MasterGoTranscoder.Internal
```

## 客户机：怎么装

管理员窗口（`winget source add` 这一步必须管理员；装包本身不用）：

```powershell
$crt = "$env:TEMP\mastergo-winget.crt"
curl.exe -k -o $crt "https://10.101.0.62:18443/files/mastergo-winget.crt"
Import-Certificate -FilePath $crt -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
winget source add -n BigStart -a "https://10.101.0.62:18443/api" -t Microsoft.Rest --accept-source-agreements
winget install BigStart.MasterGoTranscoder.Internal --accept-source-agreements --accept-package-agreements
```

装完 `mastergo-transcoder` 就在 PATH 里（portable 包，落在用户目录，不写系统目录）。
之后同一台机器上 `winget upgrade` 会跟着这个源走；卸载是 `winget uninstall BigStart.MasterGoTranscoder.Internal`。
`winget source remove -n BigStart` 可以把源去掉（证书留着也不影响别的）。

## 边界

- **必须 https**：winget 只收 https 源。实测 `source add -a http://…` 会被拒（`0x8a150045`），
  服务因此按 https 起，证书这一步省不掉。
- **自签证书**：客户机要把那张 `.crt` 装进「受信任的根」（管理员，一次）。不装的话 winget 连不上，报的是证书错。
- **`source add` 要管理员**：这是 winget 自己的规矩（源写在机器范围），与我们的包无关。
- **源里只放当前这一版**：`scripts/winget-source.js` 每次重写整个输出目录；winget 按最新版装与升级，
  不需要留历史版本（历史版本由程序自己的更新机制管，见 `docs/install.md`）。
- **数据文件不要手写**：包地址、哈希、清单字段都由 `scripts/lib/winget-manifest.js` 一处给（与三个 YAML 同一份事实），
  换包就重跑生成器。
- **源服务里没有秘密**：只有公开的包与证书（私钥在 `certs/`，不在对外发的目录里）。

## 实测记录（2026-10-07）

| 项 | 结果 |
| --- | --- |
| 服务机 | Ubuntu 24.04.4，Node v22.23.2；18443 起 HTTPS，`/api/information`、`/api/manifestSearch`、`/api/packageManifests`、`/files/*`（GET 与 HEAD）四个都通 |
| 客户机（Windows，winget v1.29.380） | 证书导入成功；`source add` 成功；`winget search --source BigStart mastergo` 列出「MasterGo 转码客户端 0.6.50」 |
| 安装 | `winget install BigStart.MasterGoTranscoder.Internal` → 下载 5,020,839 字节 → 校验哈希通过 → 解压 → 加上命令别名 → 成功；`winget list` 里源显示 `BigStart`，包在 `%LOCALAPPDATA%\Microsoft\WinGet\Packages\BigStart.MasterGoTranscoder.Internal_BigStart` |
| 卸载 | `winget uninstall BigStart.MasterGoTranscoder.Internal` 成功，命令别名与包目录都没有残留 |
| 信息接口声明不认的字段之后 | 又装了一遍（`/api/information` 现在会照实说我们不认哪几个匹配字段），搜索与安装都照旧成功 —— 客户端因此能在发请求前就避开这些字段 |
| 复核收口之后 | 共享的渲染模块挪到 `scripts/lib/`（不再随客户端更新包发出去）、事实装配与命令行取值各收一处、包内目录名与打包脚本同源；服务器按新目录重起，`winget install` 再装一遍、再卸载，都成功 |
| 复核收口（第二轮）之后 | 源服务的问答语义从清单渲染里拆出去（`scripts/lib/winget-source-api.js`）、故障按「谁的错」分成 400 与 500、启动时数据文件不可用会直接报出是哪个文件；服务器按新目录重起，安装与卸载又各验一遍 |
| 途中修掉的 | 第一次装到一半报「一个或多个源不支持搜索请求」（`0x8a150043`）：winget 装包前会把同一个关键词同时放进好几个字段的 `Inclusions`，那是**或**（`(Query \|\| Inclusions...) && Filters...`），我按「且」算导致一条都没命中。按 winget 自己的定义改掉，那条真请求原文留在 `tests/winget-source.test.js` 里 |
