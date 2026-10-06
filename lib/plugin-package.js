"use strict";

/*
 * 插件发布件：一个插件版本 = 「清单 + zip」两样，名字与来源只在这一处定义。
 *
 * 打包在客户端的发布流程里做（scripts/pack-plugin.js）：插件自己的仓库只出源码，
 * 发布件与客户端的发布件放在同一个 Release —— 客户机因此只需要配一个发布源，
 * 换公司 GitLab 时也是一起换。地址拼法复用 lib/source.js 的 assetUrl，不另写一套。
 *
 * 钉哪一版（哪个仓库、哪个 tag、插件在仓库里的哪个目录）是发布流程的事，写在 plugin-pin.json，
 * 由 scripts/pack-plugin.js 读 —— 这个模块随客户端发货，不依赖运行树里没有的文件。
 * 边界：这里只有名字与钉住的版本，不做网络请求，也不认识包里的内容。
 */

// 插件名与「读插件自己声明的版本」那条规则都只有 lib/plugin-root.js 一处定义：
// 定位、界面、打发布件读的是同一份，打包脚本从这里拿，不去碰 plugin-root 的内部实现。
const { PLUGIN_NAME, pluginVersionFrom } = require("./plugin-root.js");
// 客户端读它决定「最新是哪一版、zip 的 sha256 是多少」。
const MANIFEST_FILE = "plugin-manifest.json";

function zipName(version) {
  return PLUGIN_NAME + "-" + String(version || "").trim() + ".zip";
}

module.exports = { PLUGIN_NAME, pluginVersionFrom, MANIFEST_FILE, zipName };
