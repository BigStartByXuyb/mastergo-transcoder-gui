"use strict";

/*
 * 版本号比大小：真值源在 shared/versions.cjs（前后端共用的公共库），这里只转发。
 * 谁在用：程序更新、Codex 那条线、插件那一半，以及插件定位的版本目录排序。
 * isVersionName 只有后端用，所以留在这一份，不进共享库。
 */
const { compareVersions, isNewer } = require("../shared/versions.cjs");

// 纯版本号：数字段用点连起来（1.0.301）。放宽或收紧口径只改这一处。
function isVersionName(name) {
  return /^\d+(?:\.\d+)*$/.test(String(name));
}

module.exports = { isVersionName, compareVersions, isNewer };
