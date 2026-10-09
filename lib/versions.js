"use strict";

/*
 * 版本号比大小：真值源在 shared/versions.cjs（前后端共用的公共库），这里只转发。
 * 谁在用：程序更新、Codex 那条线、插件那一半，以及插件定位的版本目录排序。
 */
module.exports = require("../shared/versions.cjs");
