#!/usr/bin/env node
"use strict";

// 映射表接口的形状回归。
//
// 背景：映射表的 controlTypeRequiredAttrs 里除了 15 个 ControlType，还有一条 _note（字符串）。
// 界面按「值一定是数组」渲染（attrs.join），运行时抛错、整棵 React 树崩掉 —— 页面白屏。
// 接口形状一变就要当场失败，而不是等用户点开页面才暴露。
// 跑法：node tests/mapping.test.js

const assert = require("assert");

const { createMapping } = require("../lib/mapping.js");
const { resolvePluginRoot } = require("../lib/plugin-root.js");
const { readPluginInfo } = require("../lib/plugin.js");
const { installRoot } = require("../lib/runtime.js");

// 插件只有一处来源：客户端自带那一份（安装根 plugins/ 下）。CI 会把插件铺到那儿再跑这一条。
const root = resolvePluginRoot({ installRoot: installRoot() });
const mapping = createMapping({ plugin: readPluginInfo(root) }).read();
console.log("插件：" + root.replace(/\\/g, "/") + "（v" + mapping.pluginVersion + "）");

assert.ok(mapping.families.length > 0, "映射表必须有模板族");
for (const family of mapping.families) {
  assert.ok(Array.isArray(family.variants), family.key + " 的 variants 必须是数组");
  for (const variant of family.variants) {
    assert.strictEqual(typeof variant.name, "string", family.key + " 的变体名必须是字符串");
  }
}

assert.ok(mapping.requiredAttrs && Object.keys(mapping.requiredAttrs).length > 0, "必须有 ControlType 必写字段表");
for (const [type, attrs] of Object.entries(mapping.requiredAttrs)) {
  assert.ok(Array.isArray(attrs), "必写字段表的 " + type + " 必须是数组（界面按数组渲染）");
}

assert.deepStrictEqual(mapping.warnings, [], "映射表里不应有条目形状不合预期：" + mapping.warnings.join("；"));
assert.ok(mapping.layoutRules && mapping.layoutRules.bottomBar, "必须登记底部栏规则");
assert.ok(
  mapping.layoutRules.bottomBar.variants && Object.keys(mapping.layoutRules.bottomBar.variants).length > 0,
  "底部栏必须登记变体"
);

console.log(
  "  模板族 " +
    mapping.families.length +
    " / 底部栏变体 " +
    Object.keys(mapping.layoutRules.bottomBar.variants).length +
    " / 必写字段表 " +
    Object.keys(mapping.requiredAttrs).length
);
console.log("mapping.test.js 全部通过");
