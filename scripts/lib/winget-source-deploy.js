"use strict";

/*
 * 内网源服务机上要拷哪几个文件（数据不在内：那是生成器的产物）。
 *
 * 清单只有这一处：docs/winget-internal-source.md 的部署清单按它写，用例照它把文件摆进一个空目录、
 * 真起一次服务 —— 给服务加了一个 require 却忘了写这里，用例会当场报「Cannot find module」。
 */

// 相对仓库根；顺序就是照着拷的顺序。
const FILES = [
  "scripts/winget-source-server.js",
  "scripts/lib/args.js",
  "scripts/lib/winget-manifest.js",
  "lib/versions.js"
];

module.exports = { FILES: FILES };
