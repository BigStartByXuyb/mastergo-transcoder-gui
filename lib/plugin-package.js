"use strict";

/*
 * 插件发布件：一个插件版本 = 「清单 + zip」两样，名字与来源只在这一处定义。
 *
 * 打包在客户端的发布流程里做（scripts/pack-plugin.js）：插件自己的仓库只出源码，
 * 发布件与客户端的发布件放在同一个 Release —— 客户机因此只需要配一个发布源，
 * 换公司 GitLab 时也是一起换。地址拼法复用 lib/source.js 的 assetUrl，不另写一套。
 *
 * 边界：这里只有名字与钉住的版本，不做网络请求，也不认识包里的内容。
 */

const PLUGIN_NAME = "mastergo-wpf-transcoder";
// 插件源码仓库（marketplace 那个）与要打进发布件的版本；插件发新版时只改这两行。
const PLUGIN_REPO = "https://github.com/BigStartByXuyb/test";
const PLUGIN_TAG = "v1.0.371";
// 客户端读它决定「最新是哪一版、zip 的 sha256 是多少」。
const MANIFEST_FILE = "plugin-manifest.json";

function zipName(version) {
  return PLUGIN_NAME + "-" + String(version || "").trim() + ".zip";
}

module.exports = { PLUGIN_NAME, PLUGIN_REPO, PLUGIN_TAG, MANIFEST_FILE, zipName };
