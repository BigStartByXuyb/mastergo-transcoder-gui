"use strict";

/*
 * 版本号比大小：只按数字段比（1.10.0 > 1.9.0），段数不齐时短的补 0，非数字段按字符串比兜底。
 *
 * 谁在用：程序更新（lib/update.js，四态与「可切哪一版」）、Codex 那条线（lib/codex.js）、
 * 插件那一半（lib/plugin-update.js），以及插件定位的版本目录排序（lib/plugin-root.js）。
 * 后端只有这一处比法；前端那份（ui/src/lib/update-state.ts）口径与它一致 —— 前后端不能互相引代码。
 * isVersionName 是相邻的那条判据（这个目录名 / 这个版本号是不是纯版本号），也在这里：
 * 内容库列版本（lib/bundle-store.js）、插件定位取最高版（lib/plugin-root.js）、打包校验 tag（scripts/pack-plugin.js）都读它。
 * 边界：只认版本号字符串，不认识来源、也不认识清单位置。
 */

// 纯版本号：数字段用点连起来（1.0.301）。放宽或收紧口径只改这一处，三处判据跟着一起变。
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
