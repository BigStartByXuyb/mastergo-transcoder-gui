"use strict";

/*
 * 布局确认（作业A）：读控件清单 + 分组表，写回分组表。
 *
 * 这是「语义输入」之一（与图标命名表、译文清单同类）：分组表 layout-groups.json 由人 / AI 看图后写，
 * 流水线在「布局推导」前消费它。本模块只做读与写，不推导分组，也不判定谁该跟谁一组。
 *
 * 数据源：
 *   - 控件清单：Generated/<Target>.component-types.json（nodes[]：ref / controlType / absX / absY / w / h）
 *   - 控件文本：Generated/runs/<Target>/dsl.snapshot.json（节点 text）
 *   - 分组表：Generated/_inputs/<Target>.layout-groups.json
 *
 * 口径来自插件（mw-wpf-mode.md 第 2 节）：分组表 shape 是
 *   { schemaVersion:"mw-wpf-layout-groups/1", pageTarget:"<Target>",
 *     groups:[{ id:"<组名>", kind:"column"|"row", members:["<ref>", ...] }] }
 * 校验与插件布局推导入口同一套判据：id 非空、kind 只取 column/row、members 至少 2 个非空 ref、
 * pageTarget 写了就必须等于本次页面。
 */

const fs = require("fs");
const path = require("path");

const { UserError } = require("./errors.js");
const workdir = require("./workdir.js");
const atomicWrite = require("./atomic-write.js");
const designImage = require("./design-image.js");
const { hasIllegalNameChars, isPathLike } = require("./name-safety.js");

const GROUPS_SCHEMA = "mw-wpf-layout-groups/1";

function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function requireTarget(target) {
  const value = String(target || "").trim();
  if (!value) throw new UserError("NEED_TARGET", "缺少页面 Target", "先在看板上选中这一页。");
  if (isPathLike(value) || hasIllegalNameChars(value)) {
    throw new UserError("BAD_TARGET", "页面 Target 不能当文件名用：" + value, "它不能含路径分隔符、.. 或 Windows 文件名里的非法字符。");
  }
  return value;
}

function requireProject(projectRoot) {
  const value = String(projectRoot || "").trim();
  if (!value) throw new UserError("NEED_PROJECT", "缺少工程目录", "先在看板上选中这一页。");
  return path.resolve(value);
}

// DSL 快照里 ref → 文本：只做「补一个展示用文本」，分组判据不落在这里。
function collectTexts(snapshot) {
  const texts = new Map();
  const walk = function (node) {
    if (!node) return;
    const text = Array.isArray(node.text)
      ? node.text.map(function (part) { return part && typeof part.text === "string" ? part.text : ""; }).join("")
      : "";
    texts.set(String(node.id || ""), text);
    (node.children || []).forEach(walk);
  };
  (snapshot && snapshot.dsl && Array.isArray(snapshot.dsl.nodes) ? snapshot.dsl.nodes : []).forEach(walk);
  return texts;
}

// 控件清单：类型判定产物的 nodes，补上 DSL 里的文本。字段与插件 layout 推导入口读的同一份（ref/controlType/absX/absY/w/h）。
function readControls(projectRoot, target) {
  const types = readJsonIfExists(workdir.componentTypesPath(projectRoot, target));
  if (!types || !Array.isArray(types.nodes)) {
    return { available: false, reason: "还没有类型判定产物（流水线尚未跑到映射草稿那一步）", controls: [] };
  }
  const texts = collectTexts(readJsonIfExists(workdir.snapshotPath(projectRoot, target)));
  const controls = types.nodes
    .filter(function (node) { return node && node.controlType && node.ref; })
    .map(function (node) {
      const ref = String(node.ref);
      return {
        ref: ref,
        controlType: String(node.controlType),
        text: texts.get(ref) || String(node.sourceText || node.name || ""),
        absX: Number(node.absX || 0),
        absY: Number(node.absY || 0),
        w: Number(node.w || 0),
        h: Number(node.h || 0)
      };
    });
  return { available: true, reason: "", controls: controls };
}

// 分组表校验：与插件布局推导入口同一套判据。校验通过返回归一后的 groups，不通过抛 UserError。
function validateGroups(raw) {
  const list = Array.isArray(raw) ? raw : [];
  list.forEach(function (group, index) {
    const label = "分组表第 " + (index + 1) + " 项";
    if (!group || typeof group !== "object") throw new UserError("BAD_GROUP", label + "不是对象", "");
    if (!group.id) throw new UserError("BAD_GROUP", label + "缺 id", "");
    if (group.kind !== "column" && group.kind !== "row") {
      throw new UserError("BAD_GROUP", label + "（" + group.id + "）的 kind 必须是 column 或 row", "");
    }
    if (!Array.isArray(group.members) || group.members.length < 2) {
      throw new UserError("BAD_GROUP", label + "（" + group.id + "）的 members 至少 2 个 ref", "");
    }
    group.members.forEach(function (ref) {
      if (typeof ref !== "string" || !ref) {
        throw new UserError("BAD_GROUP", label + "（" + group.id + "）的 members 只能是非空字符串 ref", "");
      }
    });
  });
  // 跨组唯一性：同一个 ref 不能出现在两个组（与插件布局推导入口同一套判据）。
  const seen = new Set();
  list.forEach(function (group) {
    group.members.forEach(function (ref) {
      if (seen.has(ref)) throw new UserError("BAD_GROUP", "ref 出现在多个分组里: " + ref, "");
      seen.add(ref);
    });
  });
  return list.map(function (group) {
    return { id: String(group.id), kind: group.kind, members: group.members.map(String) };
  });
}

function createLayoutGroups() {
  function inspect(query) {
    const projectRoot = requireProject(query && query.projectRoot);
    const target = requireTarget(query && query.target);
    const controls = readControls(projectRoot, target);
    const groupsDoc = readJsonIfExists(workdir.layoutGroupsPath(projectRoot, target));
    const image = designImage.read({ projectRoot: projectRoot, target: target });
    return {
      available: controls.available,
      reason: controls.reason,
      controls: controls.controls,
      groups: groupsDoc && Array.isArray(groupsDoc.groups) ? groupsDoc.groups : [],
      image: image.image,
      canvas: image.canvas,
      blocked: image.blocked
    };
  }

  function save(body) {
    const projectRoot = requireProject(body && body.projectRoot);
    const target = requireTarget(body && body.target);
    const groups = validateGroups(body && body.groups);
    const doc = { schemaVersion: GROUPS_SCHEMA, pageTarget: target, groups: groups };
    const file = workdir.layoutGroupsPath(projectRoot, target);
    atomicWrite.writeAtomic(file, JSON.stringify(doc, null, 2) + "\n");
    return { path: file, count: groups.length };
  }

  return { inspect: inspect, save: save };
}

module.exports = { createLayoutGroups };
