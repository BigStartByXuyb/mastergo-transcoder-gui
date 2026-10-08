# 发布与更新：两条版本线

客户端（`mastergo-transcoder-gui`）与插件（`mastergo-wpf-transcoder`）各有一条版本线，各在自己的仓库发布。
两条线是同一套协议：**一份清单 + 按文件哈希取差异**（只改动的那些文件会被传输，回退就是把旧版本目录切回来），
所以「检查更新 / 下载 / 校验 / 落盘」只有一份实现。

本文是**两条版本线的更新来源与复查节拍**、**插件发布件的形状与怎么发一版**的唯一权威。

## 更新来源

两项设置各管一条线，改一条不会动另一条；没配或配坏了，各自回自己的默认：

| 版本线 | 设置 | 默认从哪取 | 改成别的源之后 |
| --- | --- | --- | --- |
| 程序更新 | `local.json` 的 `source` | 客户端仓库的 Release | 从你填的基址取 `manifest.json` |
| 插件 | `local.json` 的 `pluginSource` | **插件仓库的 Release**（`releases/latest/download/plugin-manifest.json`） | 从你填的基址取 `plugin-manifest.json` |

改的地方：程序更新那条在 设置 → 更新 → 「程序更新」卡片里的「更新来源」；插件那条在 设置 → 更新 →
插件（流水线）里点「客户端自带」那一行的「管理…」。两边都是那个弹窗（标题写明改的是哪一条），点「修改发布源」。
三种源可选：公网 GitHub、公司 GitLab（填项目地址，走通用包）、内网静态目录。私有源另填一个只读 token，
DPAPI 加密存在本机。

内网想一个地址取两条线：把两份清单（`manifest.json` 与 `plugin-manifest.json`）与它们的文件放进同一个
静态目录（文件按内容哈希命名，两条线不会撞），两项设置都填那个目录。

两条线各自的默认仓库由 `lib/source.js` 一处给：程序更新＝客户端仓库，插件＝**插件仓库**（`PLUGIN_DEFAULT_BASE`）。
公司内网用 GitLab 时基址填那个**项目**的地址，通用包的包名就取基址最后一段
（项目名，`lib/source.js` 的 `gitlabPackageOf` 一处）——客户端那份是客户端项目，插件那份是插件项目。
**发布侧上传必须用这个名字**：客户端只按这条约定拼地址，包名对不上不会在配置或打包阶段失败，要等真去取
文件才 404。GitLab 这条发布路径（通用包上传）还没实现，随后续内网那条线一起做，做之前第一次真机发布
要按这一节实测一遍（`lib/source.js` 顶部也标了这条边界）。

## 复查节拍

节拍由 `lib/recheck.js` 的 `createRecheck` 一处给，两条线共用：启动时静默查一次，之后每 10 分钟复查一次。
查到新版：程序更新那条在右上角挂红点「有新版 vX」，插件那条在插件页「客户端自带」那一行亮「有新版」。

## 装插件与生效

客户端自带那一份装在 `<安装根>\plugins\mastergo-wpf-transcoder\<插件版本>\`，装完立刻重新定位插件。
**有任务在跑时不给装**（装完可能改变生效的那一份）：等流水线跑完再点。
装完不一定马上生效 —— 它在查找顺序的最后一档，前面几档有插件时用的还是它们那份（口径见
[`plugin-sources.md`](plugin-sources.md)）。

## 插件发布件长什么样

```
plugin-manifest.json          {name, version, tag, releasedAt, files:{相对路径: sha256}}
<sha256>                      每个文件按内容哈希命名（同内容只存一份）：Release 的资产就挂在这一版下面
```

内网静态目录那一套（发布件用 `--out` 铺到目录里）多两层目录：

```
files/<sha256>                文件集中在 files/ 下，各版本共用一份（同内容不重复占地方）
v<版本>/plugin-manifest.json  某一版的清单（静态源没有「某一版的 release」这种概念，按版本目录取）
```

名字由 `lib/source.js` 的 `PLUGIN_MANIFEST_NAME` 一处给：打包写什么名，客户端就找什么名。

## 怎么发一版插件

1. 在插件仓库把 `plugins/mastergo-wpf-transcoder/.claude-plugin/plugin.json` 的 `version` 加一，
   连同这一版的改动合并到 `main`。
2. 打 tag（就是那个版本号）：`git tag v1.0.378 && git push origin v1.0.378`。
3. 插件仓库的 `.github/workflows/plugin-release.yml` 接到 tag 后跑一次打包与上传：
   - 检出**插件仓库**（tag）与**客户端仓库**（钉一个 commit —— 打包实现只有客户端那一份，见下）；
   - `node <客户端>/scripts/pack-plugin.js --repo-dir <插件仓库> --tag "$TAG" --dir plugins/mastergo-wpf-transcoder --out dist/plugin --upload "$TAG" --notes "插件发布件 $TAG"`（建 Release 要给 `--notes`，没有会直接失败）；
   - 资产传到**插件仓库自己的 Release**：先传文件，清单最后传（清单先到而文件没到，客户端会下到 404）。

打包脚本会拦两种「发出去也是废的」情况：tag 与 `plugin.json` 里声明的版本对不上、
那棵树里没有客户端借以认出插件根的标记文件（`skills/mastergo-to-wpf/SKILL.md`）。

> 为什么打包脚本在客户端仓库：清单形状与「什么算插件根」的判据属于客户端的消费协议，
> 实现只有一份（`lib/plugin-root.js`、`lib/app-manifest.js`、`scripts/lib/release-assets.js`），
> 插件仓库的发布作业按 commit 钉住它来调，不另抄一套。

## 客户端这一侧

- 插件的发布件只发在插件仓库的 Release 上：客户端仓库的 Release 里没有 `plugin-manifest.json`，也没有插件的那批文件。
- 插件版本与客户端版本互不钉：插件自己说自己的版本，升插件不必升客户端。

## 契约边界

- 客户端对插件有契约假设：步骤契约字段（`scripts/lib/pipeline-steps.js` 那七个）、
  控件查询引擎那几个文件（`lib/node-controls.js` 的 `missingPluginFiles`）。
  插件改了这些就要**同时看客户端**：客户端在用到时会按同一批判据如实报缺什么，不会悄悄用半份插件。
