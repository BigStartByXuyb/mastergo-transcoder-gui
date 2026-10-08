"use strict";

/*
 * 「要变成文件名的东西」的两条通用判据，只在这里一处：
 *   hasIllegalNameChars  Windows 文件名里不能出现的字符
 *   isPathLike           带路径分隔符或 .. 的值不能当单个名字用（调用方一律拒）
 *   safeSegment          按 Windows 规则把一段名字收敛成一个能落盘的名字（调用方替换用）
 *
 * 谁在用：对话附件的路径归一（lib/uploads.js）与作业A 的页面 Target（lib/design-image.js）。
 */

const ILLEGAL_NAME_CHARS = /[<>:"|?*\u0000-\u001f]/;

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

module.exports = { hasIllegalNameChars, isPathLike, safeSegment };
