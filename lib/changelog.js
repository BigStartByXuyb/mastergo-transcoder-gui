"use strict";

/*
 * 版本更新内容：changelog.json 一份，三处共用 —— 客户端显示、发布清单里的 notes、GitHub Release 说明。
 * 谁在用：lib/update.js（状态里带 notes）、scripts/publish.js（写进清单与 release 说明）。
 * 边界：只读这一份文件，不联网、不猜；没有这一版就返回空数组。
 */

const fs = require("fs");
const path = require("path");
const { compareVersions } = require("./versions.js");

const FILE = "changelog.json";

function readChangelog(root) {
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(root, FILE), "utf8"));
  }
  catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(function (entry) {
    return entry && typeof entry.version === "string";
  }).map(function (entry) {
    return {
      version: entry.version,
      date: String(entry.date || ""),
      notes: Array.isArray(entry.notes) ? entry.notes.map(String) : [],
      // 从这一版起「具备」的关键能力（结构化，回退前要拿它比对缺了什么）。
      // 之后哪一版去掉了某个能力，就写在 drops 里（能力 id）。
      features: Array.isArray(entry.features)
        ? entry.features
            .filter(function (item) { return item && typeof item.id === "string" && typeof item.label === "string"; })
            .map(function (item) { return { id: item.id, label: item.label }; })
        : [],
      drops: Array.isArray(entry.drops) ? entry.drops.map(String) : []
    };
  });
}

// 已经解析好的那份里，按版本号取 notes；取不到给空数组。这是「按版本取 notes」的唯一入口。
function notesOfEntries(entries, version) {
  const want = String(version || "");
  const hit = (entries || []).find(function (entry) { return entry.version === want; });
  return hit ? hit.notes : [];
}

// Release 说明：标题 + 每条一行；这一版没有条目就留空，不编。
function notesText(root, version) {
  const notes = notesOfEntries(readChangelog(root), version);
  if (notes.length === 0) return "";
  return "MasterGo 转码客户端 v" + version + "\n\n" + notes.map(function (line) { return "- " + line; }).join("\n");
}

// 按版本号升序排好：回放、label 取最近一版都先经过这一处，排序口径只有一份。
function ascendingByVersion(entries) {
  return (entries || []).slice().sort(function (left, right) { return compareVersions(left.version, right.version); });
}

// 到某一版为止具备的能力 id：只应用不晚于 upTo 的条目，先加 features、再按 drops 删。
function replayUpTo(entries, upTo) {
  const known = new Set();
  ascendingByVersion(entries).forEach(function (entry) {
    if (compareVersions(entry.version, upTo) > 0) return;
    applyEntry(known, entry);
  });
  return known;
}

/* 一版的能力怎么作用到「至今具备」这个集合：先加 features、再按 drops 删，两处回放共用这一步。 */
function applyEntry(known, entry) {
  (entry.features || []).forEach(function (item) { known.add(item.id); });
  (entry.drops || []).forEach(function (id) { known.delete(id); });
}

/*
 * 从 current 回退到「历史里每一版」分别缺哪些能力：升序走一遍，一趟算完，不每条各重放一次。
 * 返回 Map<版本, 缺的能力 label[]>；只包含历史里真实存在的版本。
 */
function missingForEveryVersion(entries, current) {
  const ascending = ascendingByVersion(entries);
  // label 只取不晚于 current 的条目（升序里后写覆盖先写，以更近的那一版为准）。
  const labels = new Map();
  ascending.forEach(function (entry) {
    if (compareVersions(entry.version, current) > 0) return;
    (entry.features || []).forEach(function (item) { labels.set(item.id, item.label); });
  });
  const currentIds = replayUpTo(entries, current);
  const known = new Set();
  const byVersion = new Map();
  ascending.forEach(function (entry) {
    applyEntry(known, entry);
    const absent = [];
    for (const id of currentIds) {
      if (!known.has(id)) absent.push(labels.get(id));
    }
    byVersion.set(entry.version, absent);
  });
  return byVersion;
}

module.exports = { readChangelog, notesOfEntries, notesText, missingForEveryVersion };
