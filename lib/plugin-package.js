"use strict";

/*
 * 插件发布件：一个插件版本 = 「清单 + zip」两样，名字只在 lib/plugin-root.js（插件名）与这里（文件名）定义。
 *
 * 打包在客户端的发布流程里做（scripts/pack-plugin.js）：插件自己的仓库只出源码，发布件与客户端的发布件
 * 放在同一个 Release。客户端按名字取清单与 zip（地址用 lib/source.js 的 assetUrl 拼，不另写一套）——
 * 客户端那条下载路径还没接，这里先把名字与位置定死，两边不会各拼一份。
 *
 * 钉哪一版（哪个仓库、哪个 tag、插件在仓库里的哪个目录）是发布流程的事，写在 plugin-pin.json，
 * 由 scripts/pack-plugin.js 读 —— 这个模块随客户端发货，不依赖运行树里没有的文件。
 * 边界：这里只有名字与钉住的版本，不做网络请求，也不认识包里的内容。
 */

// 插件名与「读插件自己声明的版本」那条规则都只有 lib/plugin-root.js 一处定义：
// 定位、界面、打发布件读的是同一份，打包脚本从这里拿，不去碰 plugin-root 的内部实现。
// 打包侧要用到的插件元信息都从这里取：插件名、标记文件、读版本那条规则（插件定位那一份的实现）。
const { PLUGIN_NAME, PLUGIN_MARKER, pluginVersionFrom } = require("./plugin-root.js");
// 客户端读它决定「最新是哪一版、zip 的 sha256 是多少」。
const MANIFEST_FILE = "plugin-manifest.json";

function zipName(version) {
  return PLUGIN_NAME + "-" + String(version || "").trim() + ".zip";
}

// tag → 版本号：判据只有这一处（打包脚本用，单测也用它，不各写一份正则）。
function versionOfTag(tag) {
  return String(tag || "").trim().replace(/^v/, "");
}

module.exports = { PLUGIN_NAME, PLUGIN_MARKER, pluginVersionFrom, MANIFEST_FILE, zipName, versionOfTag };
