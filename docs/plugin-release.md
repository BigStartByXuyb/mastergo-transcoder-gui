# 插件发布：它有自己的版本线

插件（`mastergo-wpf-transcoder`）的版本线在**它自己的仓库**（marketplace，`BigStartByXuyb/test`）里，
不在客户端这边。客户端只是消费者 —— 发布件是同一套协议（一份清单 + 按 sha256 取文件），
所以「检查更新 / 下载 / 校验 / 落盘」两条版本线共用同一份实现。

## 一条发布件的形状

```
plugin-manifest.json          {name, version, tag, releasedAt, files:{相对路径: sha256}}
<sha256>                      每个文件按内容哈希命名（同内容只存一份）
v<版本>/plugin-manifest.json  历史版本的清单（静态源没有「某一版的 release」这种概念）
```

名字由 `lib/source.js` 的 `PLUGIN_MANIFEST_NAME` 一处给：打包写什么名，客户端就找什么名。

## 怎么发一版插件

1. 在插件仓库把 `plugins/mastergo-wpf-transcoder/.claude-plugin/plugin.json` 的 `version` 加一，
   连同这一版的改动合并到 `main`。
2. 打 tag（就是那个版本号）：`git tag v1.0.378 && git push origin v1.0.378`。
3. 插件仓库的 `.github/workflows/plugin-release.yml` 接到 tag 后跑一次打包与上传：
   - 检出**插件仓库**（tag）与**客户端仓库**（钉一个 commit —— 打包实现只有客户端那一份，见下）；
   - `node <客户端>/scripts/pack-plugin.js --repo-dir <插件仓库> --tag "$TAG" --dir plugins/mastergo-wpf-transcoder --out dist/plugin --upload "$TAG"`；
   - 资产传到**插件仓库自己的 Release**：先传文件，清单最后传（清单先到而文件没到，客户端会下到 404）。

打包脚本会拦两种「发出去也是废的」情况：tag 与 `plugin.json` 里声明的版本对不上、
那棵树里没有客户端借以认出插件根的标记文件（`skills/mastergo-to-wpf/SKILL.md`）。

> 为什么打包脚本在客户端仓库：清单形状与「什么算插件根」的判据属于客户端的消费协议，
> 实现只有一份（`lib/plugin-root.js`、`lib/app-manifest.js`、`scripts/lib/release-assets.js`），
> 插件仓库的发布作业按 commit 钉住它来调，不另抄一套。

## 客户端从哪儿取

只有一条规矩（`lib/source.js` 的 `pluginSourceOf`）：

| 设置里的发布源 | 程序更新从哪取 | 插件从哪取 |
| --- | --- | --- |
| 留空 | 客户端仓库的 Release | **插件仓库的 Release**（`releases/latest/download/plugin-manifest.json`） |
| 填了（公司 GitLab / 内网静态目录） | 那个基址的 `manifest.json` | 同一个基址的 `plugin-manifest.json` |

所以内网部署只需要一个地址：把两份清单与它们的文件放进同一个静态目录
（文件按内容哈希命名，两条线不会撞），客户端两条线都从那里取。

节拍（`lib/manifest-fetch.js` 的 `RECHECK_MS`，两条线共用）：启动时静默查一次，之后每 10 分钟复查一次；
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
