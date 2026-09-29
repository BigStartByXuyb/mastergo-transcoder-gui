"use strict";

/*
 * 启动选版：安装根上的 current.json 指向 versions/<版本>/ 就用那一份，否则用安装根自己这一份。
 *
 * 谁在用：launch.js（start.cmd 调的入口）、lib/update.js 的切换都是写这个指针。
 * 边界：只读指针并判断那一份能不能跑（server.js 在不在）；找不到就退回安装根，绝不因为指针写坏而打不开。
 */

const fs = require("fs");
const path = require("path");

function resolveLaunch(home) {
  const root = path.resolve(home);
  let pointer = null;
  try {
    pointer = JSON.parse(fs.readFileSync(path.join(root, "current.json"), "utf8"));
  }
  catch {
    pointer = null;
  }
  const version = String((pointer && pointer.version) || "");
  if (version) {
    const dir = path.join(root, "versions", version);
    if (fs.existsSync(path.join(dir, "server.js"))) return { dir: dir, version: version, fromPointer: true };
  }
  return { dir: root, version: "", fromPointer: false };
}

module.exports = { resolveLaunch };
