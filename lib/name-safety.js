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

// 页面 Target 会变成文件名：归一 + 文件名安全判据，只有一个实现。空/非法抛 UserError。
function requirePageTarget(target) {
  const value = String(target || "").trim();
  if (!value) throw new UserError("NEED_TARGET", "缺少页面 Target", "先在看板上选中这一页。");
  if (isPathLike(value) || hasIllegalNameChars(value)) {
    throw new UserError("BAD_TARGET", "页面 Target 不能当文件名用：" + value, "它不能含路径分隔符、.. 或 Windows 文件名里的非法字符。");
  }
  return value;
}

// 工程目录非空 + 归一为绝对路径，只有一个实现。
function requireProjectRoot(projectRoot) {
  const value = String(projectRoot || "").trim();
  if (!value) throw new UserError("NEED_PROJECT", "缺少工程目录", "先在看板上选中这一页。");
  return path.resolve(value);
}

// 任务 id 会变成暂存件的文件名：同一套文件名安全判据，只有一个实现。
function requireTaskId(taskId) {
  const value = String(taskId || "").trim();
  if (!value) throw new UserError("NEED_TASK", "缺少任务 id", "等这一条任务加进看板之后再传图。");
  if (isPathLike(value) || hasIllegalNameChars(value)) {
    throw new UserError("BAD_TASK", "任务 id 不能当文件名用：" + value, "它不能含路径分隔符、.. 或 Windows 文件名里的非法字符。");
  }
  return value;
}

module.exports = { hasIllegalNameChars, isPathLike, safeSegment, requirePageTarget, requireProjectRoot, requireTaskId };
