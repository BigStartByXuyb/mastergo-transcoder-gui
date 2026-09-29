#!/usr/bin/env node
"use strict";

// 图标资源名唯一化：第 7 步的台账要求同一页里 name 互不重复。跑法：node tests/icon-names.test.js

const assert = require("assert");
const { test } = require("node:test");

const { uniqueIconName, duplicatedNames, uniqueRowNames } = require("../lib/icon-names.js");

test("重名时把数字插在 Geometry 后缀之前", () => {
  const taken = new Set();
  assert.strictEqual(uniqueIconName("LineFocusAdjustGeometry", taken), "LineFocusAdjustGeometry");
  assert.strictEqual(uniqueIconName("LineFocusAdjustGeometry", taken), "LineFocusAdjust2Geometry");
  assert.strictEqual(uniqueIconName("LineFocusAdjustGeometry", taken), "LineFocusAdjust3Geometry");
});

test("没有 Geometry 后缀的名字直接补数字", () => {
  const taken = new Set();
  assert.strictEqual(uniqueIconName("Set", taken), "Set");
  assert.strictEqual(uniqueIconName("Set", taken), "Set2");
});

test("只差大小写也算撞名", () => {
  const taken = new Set();
  assert.strictEqual(uniqueIconName("SetGeometry", taken), "SetGeometry");
  assert.strictEqual(uniqueIconName("setgeometry", taken), "setgeometry2");
});

test("首尾空白按同名处理", () => {
  const taken = new Set();
  assert.strictEqual(uniqueIconName("  SetGeometry  ", taken), "SetGeometry");
  assert.strictEqual(uniqueIconName("SetGeometry", taken), "Set2Geometry");
});

test("重名分组只报出现两次以上的名字，按首次下标排序", () => {
  const groups = duplicatedNames([
    { index: 10, name: "LineFocusAdjustGeometry" },
    { index: 11, name: "CurrentPositionGeometry" },
    { index: 14, name: "LineFocusAdjustGeometry" },
    { index: 20, name: "linefocusadjustgeometry" },
    { index: 21, name: "" }
  ]);
  assert.deepStrictEqual(groups, [
    { name: "LineFocusAdjustGeometry", indexes: [10, 14, 20] }
  ]);
});

test("行序唯一化保留第一行，按行序补数字", () => {
  const rows = uniqueRowNames([
    { index: 10, name: "LineFocusAdjustGeometry", comment: "a" },
    { index: 11, name: "CurrentPositionGeometry" },
    { index: 14, name: "LineFocusAdjustGeometry", comment: "b" },
    { index: 15, name: "" }
  ]);
  assert.strictEqual(rows[0].name, "LineFocusAdjustGeometry");
  assert.strictEqual(rows[2].name, "LineFocusAdjust2Geometry");
  assert.strictEqual(rows[2].comment, "b");
  assert.strictEqual(rows[3].name, "");
});

test("唯一化后不再有重名分组", () => {
  const unique = uniqueRowNames([
    { index: 10, name: "SetGeometry" },
    { index: 11, name: "setgeometry" },
    { index: 12, name: "SetGeometry" }
  ]);
  assert.deepStrictEqual(duplicatedNames(unique), []);
});
