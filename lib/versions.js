"use strict";

/*
 * 版本号比大小：只按数字段比（1.10.0 > 1.9.0），段数不齐时短的补 0，非数字段按字符串比兜底。
 *
 * 谁在用：程序更新（lib/update.js，四态与「可切哪一版」）、Codex 那条线（lib/codex.js）、
 * 插件那一半（lib/plugin-update.js）。比法只有这一处，三条线不会一处一个样。
 * 边界：只比版本号字符串，不认识来源、也不认识清单位置。
 */

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

module.exports = { compareVersions, isNewer };
