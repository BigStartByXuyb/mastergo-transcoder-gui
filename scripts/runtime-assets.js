#!/usr/bin/env node
"use strict";

/*
 * 生成 runtime-assets.json：给不依赖 Node 的启动器（tools/launcher）用的钉死表。
 *
 * 为什么要有这个文件：干净机器上第一次跑的是那个 exe，它那时还没有 Node，读不了 lib/runtime.js ——
 * 所以把「哪一版、哪个文件名、什么 sha256、官方地址」在发版时导出一份随包走。
 * 单一来源仍然是 lib/runtime.js 的 TOOLS，这里只导出，不另写一遍。
 *
 * 用法：node scripts/runtime-assets.js
 * 谁在用：CI 的 release job（发布前跑一次）、本机想手工打包时。
 */

const fs = require("fs");
const path = require("path");

const { TOOLS } = require("../lib/runtime.js");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "runtime-assets.json");

function main() {
  const tools = {};
  for (const id of Object.keys(TOOLS)) {
    const spec = TOOLS[id];
    tools[id] = {
      version: spec.version,
      fileName: spec.fileName,
      sha256: spec.sha256,
      officialUrl: spec.url,
      strip: spec.strip,
      exe: spec.exe
    };
  }
  fs.writeFileSync(OUT, JSON.stringify({ schema: 1, tools: tools }, null, 2) + "\n", "utf8");
  process.stdout.write("runtime-assets.json：" + Object.keys(tools).join(" / ") + "（→ " + path.basename(OUT) + "）\n");
}

main();
