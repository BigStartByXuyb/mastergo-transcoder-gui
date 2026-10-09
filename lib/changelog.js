"use strict";

/*
 * 版本更新内容：changelog.json 一份，三处共用 —— 客户端显示、发布清单里的 notes、GitHub Release 说明。
 * 谁在用：lib/update.js（状态里带 notes）、scripts/publish.js（写进清单与 release 说明）。
 * 边界：只读这一份文件，不联网、不猜；没有这一版就返回空数组。
 */

const fs = require("fs");
const path = require("path");

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

function notesOf(root, version) {
  const want = String(version || "");
  const hit = readChangelog(root).find(function (entry) { return entry.version === want; });
  return hit ? hit.notes : [];
}

// Release 说明：标题 + 每条一行；这一版没有条目就留空，不编。
function notesText(root, version) {
  const notes = notesOf(root, version);
  if (notes.length === 0) return "";
  return "MasterGo 转码客户端 v" + version + "\n\n" + notes.map(function (line) { return "- " + line; }).join("\n");
}

module.exports = { readChangelog, notesOf, notesText };
