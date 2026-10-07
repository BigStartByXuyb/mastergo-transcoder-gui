"use strict";

/*
 * 这一版 winget 包的事实：版本号取 package.json、包内目录按版本拼、zip 在不在、哈希现算。
 *
 * 谁在用：scripts/winget-manifest.js（三个 YAML）与 scripts/winget-source.js（内网源数据）。
 * 两个入口的事实只有这一处 —— 版本或目录命名一改，两个产物不会各说一套。
 *
 * urlOf 由调用方给：公网那份按 release 地址拼，内网那份指向源服务自己的静态资产目录。
 * 边界：只在构建机上跑（要读仓库、要算文件哈希）；服务机上跑的是 scripts/lib/winget-manifest.js，那份不做 IO。
 */

const fs = require("fs");
const path = require("path");

const { sha256File } = require("../../lib/app-manifest.js");
const { folderOf } = require("./bundle-name.js");

const ROOT = path.join(__dirname, "..", "..");

function versionFacts(options) {
  const o = options || {};
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  // 包内目录名与打包脚本同一个来源（scripts/lib/bundle-name.js）。
  const folder = folderOf(version);
  const zip = path.resolve(ROOT, o.zip || path.join("dist", folder + ".zip"));
  if (!fs.existsSync(zip)) {
    throw new Error("找不到这一版的 zip：" + zip + "（先跑 node scripts/pack-bundle.js）");
  }
  return {
    id: o.id,
    version: version,
    url: o.urlOf({ version: version, folder: folder, zipPath: zip }),
    sha256: sha256File(zip).toUpperCase(),
    folder: folder,
    // 内网源那边要把这个文件拷进要发的目录，所以路径也交出来。
    zipPath: zip
  };
}

module.exports = { versionFacts: versionFacts };
