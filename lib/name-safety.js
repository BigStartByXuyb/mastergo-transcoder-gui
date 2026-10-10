"use strict";

const path = require("path");

/*
 * 「要变成文件名的东西」的通用判据与收敛函数，只在这里一处：
 *   hasIllegalNameChars  Windows 文件名里不能出现的字符
 *   isPathLike           带路径分隔符或 .. 的值不能当单个名字用（调用方一律拒）
 *   safeSegment          按 Windows 规则把一段名字收敛成一个能落盘的名字（调用方替换用）
 *
 * 谁在用：对话附件的路径归一（lib/uploads.js）、作业A 的页面 Target 与暂存件的任务 id
 * （lib/design-image.js）与布局确认的工程目录 / 页面 Target（lib/layout-groups.js）。
 */

const ILLEGAL_NAME_CHARS = /[<>:"|?*\u0000-\u001f]/;
const { UserError } = require("./errors.js");

function hasIllegalNameChars(value) {
  return ILLEGAL_NAME_CHARS.test(String(value || ""));
}

function isPathLike(value) {
  return /[\\/]|\.\./.test(String(value || ""));
}

function safeSegment(segment) {
  const cleaned = String(segment).replace(new RegExp(ILLEGAL_NAME_CHARS.source, "g"), "_");
  return cleaned.replace(/[. ]+$/, "").slice(0, 80) || "_";
}

/* 一段名字能不能当文件名用（非空 + 不含路径分隔符 / .. / 非法字符）：判据只有这一份。 */
function isSafeName(value) {
  const name = String(value || "").trim();
  return name !== "" && !isPathLike(name) && !hasIllegalNameChars(name);
}

/*
 * 「会变成文件名的一段名字」的收口：空与不安全要分开说（两句修法不同），所以这里不共用 isSafeName 的空判。
 * 各调用方只给各自的错误码、中文名与两句修法（页面 Target 与任务 id 各说各的话）。
 */
function requireSafeName(value, said) {
  const name = String(value || "").trim();
  if (!name) throw new UserError(said.emptyCode, "缺少" + said.label, said.emptyHint);
  if (!isSafeName(name)) {
    throw new UserError(said.badCode, said.label + "不能当文件名用：" + name, said.badHint);
  }
  return name;
}

// 页面 Target：归一 + 上面那条判据。空/非法抛 UserError。
function requirePageTarget(target) {
  return requireSafeName(target, {
    label: "页面 Target",
    emptyCode: "NEED_TARGET",
    emptyHint: "先在看板上选中这一页。",
    badCode: "BAD_TARGET",
    badHint: "它不能含路径分隔符、.. 或 Windows 文件名里的非法字符。"
  });
}

// 工程目录非空 + 归一为绝对路径，只有一个实现。
function requireProjectRoot(projectRoot) {
  const value = String(projectRoot || "").trim();
  if (!value) throw new UserError("NEED_PROJECT", "缺少工程目录", "先在看板上选中这一页。");
  return path.resolve(value);
}

// 任务 id 会变成暂存件的文件名：同上那条判据。
function requireTaskId(taskId) {
  return requireSafeName(taskId, {
    label: "任务 id",
    emptyCode: "NEED_TASK",
    emptyHint: "等这一条任务加进看板之后再传图。",
    badCode: "BAD_TASK",
    badHint: "它不能含路径分隔符、.. 或 Windows 文件名里的非法字符。"
  });
}

module.exports = {
  hasIllegalNameChars,
  isPathLike,
  isSafeName,
  safeSegment,
  requirePageTarget,
  requireProjectRoot,
  requireTaskId
};
