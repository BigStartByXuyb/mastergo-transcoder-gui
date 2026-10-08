# 插件发布：它有自己的版本线

插件（`mastergo-wpf-transcoder`）的版本线在**它自己的仓库**（marketplace，`BigStartByXuyb/test`）里，
不在客户端这边。客户端只是消费者 —— 发布件是同一套协议（一份清单 + 按 sha256 取文件），
所以「检查更新 / 下载 / 校验 / 落盘」两条版本线共用同一份实现。

## 一条发布件的形状

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

## 客户端从哪儿取

插件有自己的**发布源设置**（`local.json` 的 `pluginSource`，在插件页「客户端自带」那一行的管理面板里
点「修改发布源」改）：

| | 默认从哪取 | 改了之后 |
| --- | --- | --- |
| 程序更新（`source`） | 客户端仓库的 Release | 从你填的基址取 `manifest.json` |
| 插件（`pluginSource`） | **插件仓库的 Release**（`releases/latest/download/plugin-manifest.json`） | 从你填的基址取 `plugin-manifest.json` |

两项互不影响（改插件那条不会动程序更新那条，反之亦然）；没配／配坏了都各自的默认
（两条线的默认与归一都从 `lib/source.js` 的按线表取：`lineOf(field)` 给的那一条）。内网想一个地址取两边：
把两份清单与它们的文件放进同一个静态目录（文件按内容哈希命名，两条线不会撞），两项都填那个目录。

两条线各自的默认仓库由 `lib/source.js` 一处给：程序更新＝客户端仓库，插件＝**插件仓库**
（`PLUGIN_DEFAULT_BASE`）。公司内网用 GitLab 时基址填那个**项目**的地址，通用包的包名就取基址最后一段
（项目名，`lib/source.js` 的 `gitlabPackageOf` 一处）——客户端那份是客户端项目，插件那份是插件项目。
**发布侧上传必须用这个名字**：客户端只按这条约定拼地址，包名对不上不会在配置或打包阶段失败，要等真去取
文件才 404。GitLab 这条发布路径（通用包上传）还没实现，随后续内网那条线一起做，做之前第一次真机发布
要按这一节实测一遍（`lib/source.js` 顶部也标了这条边界）。

节拍（`lib/recheck.js` 的 `createRecheck`，两条线共用）：启动时静默查一次，之后每 10 分钟复查一次；
查到新版，插件页「客户端自带」那一行自己会亮「有新版」。装完立刻重新定位插件（有任务在跑时先拒绝装）。

## 客户端这边不再有什么

- **不再随客户端发布插件**：客户端发布流程里原来那一步「Pack the plugin release」已删；
  Release 上不再有 `plugin-manifest.json` 与插件的那批文件。
- **不再有 `plugin-pin.json`**：原来用它钉「这一版客户端配哪一版插件」，现在插件自己说自己的版本。

## 边界与兼容

- 客户端对插件有契约假设：步骤契约字段（`scripts/lib/pipeline-steps.js` 那七个）、
  控件查询引擎那几个文件（`lib/node-controls.js` 的 `missingPluginFiles`）。
  插件改了这些就要**同时看客户端**：客户端在用到时会按同一批判据如实报缺什么，不会悄悄用半份插件。
- 插件版本与客户端版本不再互相钉：升插件不必升客户端，反之亦然。
  但插件若依赖新的客户端能力，要写在插件的更新说明里（客户端这一侧没有「最低插件版本」的硬门禁）。
