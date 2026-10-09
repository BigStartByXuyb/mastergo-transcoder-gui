"use strict";

/*
 * 版本号比大小：前后端共用的公共库。只放「两端都要用的纯工具」，业务判据不放这里（那些归后端）。
 *
 * 谁在用：后端经 lib/versions.js 转发它；前端经 ui/src/lib/update-state.ts 转发它。
 * 比法只按数字段比（1.10.0 > 1.9.0），段数不齐时短的补 0，非数字段按字符串比兜底。
 */

// 纯版本号：数字段用点连起来（1.0.301）。放宽或收紧口径只改这一处。
function isVersionName(name) {
  return /^\d+(?:\.\d+)*$/.test(String(name));
}

function compareVersions(a, b) {
  const left = String(a || "").split(".");
  const right = String(b || "").split(".");
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const x = Number(left[index] || 0);
    const y = Number(right[index] || 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return String(a || "").localeCompare(String(b || ""));
    }
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function isNewer(candidate, current) {
  return compareVersions(candidate, current) > 0;
}

module.exports = { isVersionName, compareVersions, isNewer };
