"use strict";

/*
 * 发布产物的暂存与上传（发布流程专用，不随客户端发货）。
 *
 *   stageAssets  清单里每个文件按内容哈希落到 <outDir>/files/<sha256>（同内容只留一份），
 *                清单写两份：<outDir>/<清单名> 与 <outDir>/v<版本>/<清单名>；
 *   uploadRelease 先传全部文件、最后传清单 —— 清单先到而文件没到，客户端会下到 404。
 *
 * 客户端发布（scripts/publish.js）已经用它；插件发布（scripts/pack-plugin.js）下一步改成同一套协议时
 * 也用它 —— 两处的差别只有三样：从哪个目录扫文件、清单叫什么名字、发布到哪个 tag。
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function gh() {
  return spawnSync("gh", Array.prototype.slice.call(arguments), {
    encoding: "utf8",
    shell: process.platform === "win32"
  });
}

function defaultRun(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(command + " 退出码 " + result.status);
}

function stageAssets(options) {
  const root = path.resolve(options.root);
  const manifest = options.manifest;
  const manifestName = options.manifestName || "manifest.json";
  const outDir = path.resolve(options.outDir);
  fs.rmSync(outDir, { recursive: true, force: true });
  const filesDir = path.join(outDir, "files");
  fs.mkdirSync(filesDir, { recursive: true });

  const written = new Map();
  for (const rel of Object.keys(manifest.files)) {
    const hash = manifest.files[rel];
    if (written.has(hash)) continue;
    fs.copyFileSync(path.join(root, rel), path.join(filesDir, hash));
    written.set(hash, rel);
  }
  const text = JSON.stringify(manifest, null, 2) + "\n";
  const manifestPath = path.join(outDir, manifestName);
  fs.writeFileSync(manifestPath, text, "utf8");
  // 历史版本也要留一份自己的清单：静态源没有「某一版的 release」这种概念，只能按版本目录取。
  const versionDir = path.join(outDir, "v" + manifest.version);
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, manifestName), text, "utf8");

  return {
    manifestPath: manifestPath,
    blobPaths: Array.from(written.keys()).map(function (hash) { return path.join(filesDir, hash); }),
    fileCount: Object.keys(manifest.files).length,
    uniqueCount: written.size
  };
}

function uploadRelease(options) {
  const tag = options.tag;
  const run = options.run || defaultRun;
  const exists = options.releaseExists
    ? options.releaseExists(tag)
    : gh("release", "view", tag).status === 0;
  if (exists) {
    run("gh", ["release", "upload", tag].concat(options.blobPaths, ["--clobber"]));
  }
  else {
    // 说明由调用方给（客户端一份、插件一份），模块不自带缺省文案 —— 免得同一种措辞出现两处。
    if (!options.notes) throw new Error("创建 Release 要给 --notes（这一版改了什么）");
    run("gh", ["release", "create", tag, "--title", options.title || tag, "--notes", options.notes].concat(options.blobPaths));
  }
  run("gh", ["release", "upload", tag, options.manifestPath, "--clobber"]);
}

module.exports = { stageAssets: stageAssets, uploadRelease: uploadRelease };
