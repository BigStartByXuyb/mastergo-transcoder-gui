"use strict";

// 映射表只读视图。
//
// 复用插件自己的加载器 scripts/lib/load-template-map.js —— 界面看到的合并结果和流水线用的是
// 同一份（共享类型表 + 本路线写入规则，extends / familyOverlays 由加载器处理），GUI 不另写
// 一份解析或合并。哪份文件是映射表由插件目录决定，这里不抄内容。

const fs = require("fs");
const path = require("path");

const { UserError } = require("./errors.js");

const SKILL_REL = ["skills", "mastergo-to-wpf"];
const LOADER_REL = ["scripts", "lib", "load-template-map.js"];
const SHARED_REL = ["references", "component-types.json"];
const ROUTE_MAP_REL = ["references", "adapters", "mtslg-iocontrol", "mtslg-iocontrol-map.json"];

function under(root, parts) {
  return path.join(root, ...parts);
}

// 模板族 = 顶层那些带 variants / match 的键。layoutRules 下的族是布局规则，不算模板族
// （边界按位置区分，与插件自己的门禁一致）。
function isFamily(key, value) {
  if (key.startsWith("_") || key === "layoutRules") return false;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return value.variants !== undefined || value.match !== undefined;
}

function createMapping(deps) {
  const plugin = deps.plugin;

  /*
   * 必写字段表：只保留「ControlType → 字段数组」。
   * 映射表同一层里还放着 `_note` 这类说明键（值是字符串），直接透传会让界面拿到非数组值
   * —— 页面曾经因为它整棵树崩成白屏。非数组的条目一律不收，并记进 warnings 让人看得见，
   * 不静默吞掉。
   */
  function requiredAttrsOf(raw) {
    const attrs = {};
    const warnings = [];
    for (const [type, value] of Object.entries(raw ?? {})) {
      if (type.startsWith("_")) continue;
      if (!Array.isArray(value)) {
        warnings.push("controlTypeRequiredAttrs." + type + " 不是数组，已跳过（值类型：" + typeof value + "）");
        continue;
      }
      attrs[type] = value.map((item) => String(item));
    }
    return { attrs: attrs, warnings: warnings };
  }

  function read() {
    const loaderPath = under(plugin.root, [...SKILL_REL, ...LOADER_REL]);
    const routePath = under(plugin.root, [...SKILL_REL, ...ROUTE_MAP_REL]);
    const sharedPath = under(plugin.root, [...SKILL_REL, ...SHARED_REL]);
    if (!fs.existsSync(loaderPath)) {
      throw new UserError("NO_MAP_LOADER", "插件里找不到映射表加载器", "期望文件：" + loaderPath);
    }
    if (!fs.existsSync(routePath)) {
      throw new UserError("NO_MAP", "插件里找不到映射表", "期望文件：" + routePath);
    }

    const { loadTemplateMap } = require(loaderPath);
    const map = loadTemplateMap(routePath);

    const families = [];
    const ruleKeys = [];
    for (const [key, value] of Object.entries(map)) {
      if (isFamily(key, value)) {
        families.push({
          key: key,
          match: value.match ?? null,
          variants: Object.entries(value.variants ?? {}).map(([name, fields]) => ({
            name: name,
            fields: fields
          }))
        });
        continue;
      }
      // layoutRules 与必写字段表单独展示，不重复列进「其它规则」。
      if (key.startsWith("_") || key === "layoutRules" || key === "controlTypeRequiredAttrs") continue;
      ruleKeys.push({
        key: key,
        entries: value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).length : 0
      });
    }

    const required = requiredAttrsOf(map.controlTypeRequiredAttrs);
    return {
      pluginVersion: plugin.version,
      routePath: routePath,
      sharedPath: sharedPath,
      families: families,
      layoutRules: map.layoutRules ?? null,
      requiredAttrs: required.attrs,
      ruleKeys: ruleKeys,
      warnings: required.warnings
    };
  }

  return { read };
}

module.exports = { createMapping };
