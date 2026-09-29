"use strict";

/*
 * 页面身份（Target + 区域前缀）的候选推导与登记表写入。
 *
 * 为什么需要：run-all 的取值链要求「Target 带区域前缀」或「登记表里登记过」，缺一个就停在入口。
 * 插件跑法里这一步由 agent 读规则 + 问人补上；这里把它拆成可执行的两步：
 *   ① candidatesFor()：按插件口径列候选（区域取项目既有约定，语义名来自设计页名的机械转换）
 *   ② writeRegistryEntry()：把确认后的那条写进 docs/page-registry.json —— 登记表是项目事实
 *
 * 与插件同口径：写回前必须满足「从 Target 前缀推出来的区域 == 要写的区域」，否则拒绝（不许写出自相矛盾的登记）。
 */

const fs = require("fs");
const path = require("path");

const { readPageRegistry, readRegistryDocument } = require("./project-pages.js");

function uiPrefixOf(target) {
  const text = String(target || "").trim();
  if (!text) return "";
  const numbered = /^([A-Za-z]+\d+)/.exec(text);
  if (numbered) return numbered[1];
  const word = /^([A-Z]+(?![a-z])|[A-Z][a-z0-9]*)/.exec(text);
  return word ? word[1] : "";
}

// 区域候选：先看项目里的既有约定（登记表 ui / 已有 Target 的前缀），推不出来就留空让人填。
function uiCandidates(registry) {
  const seen = new Map();
  for (const page of registry.pages) {
    if (page.ui) seen.set(page.ui, (seen.get(page.ui) || 0) + 1);
    const prefix = uiPrefixOf(page.target);
    if (prefix) seen.set(prefix, (seen.get(prefix) || 0) + 1);
  }
  return [...seen.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([ui, count]) => ({ ui, count, basis: "项目里已有 " + count + " 个页面用这个区域" }));
}

// 语义名的机械部分：去掉设计页名里的编号，转 PascalCase（与插件文档同口径）。
function pascalFromPageName(pageName) {
  const cleaned = String(pageName || "")
    .replace(/[（(][^)）]*[)）]/g, " ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned.split(/\s+/).filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

function candidatesFor(input) {
  const registry = readPageRegistry(input.projectRoot);
  const uiList = uiCandidates(registry);
  const semanticName = pascalFromPageName(input.pageName);
  const candidates = [];

  // ① 设计页名能机械转成 PascalCase：给出「区域 + 语义名」的整条候选
  if (semanticName) {
    for (const item of uiList) {
      candidates.push({
        target: item.ui + semanticName,
        ui: item.ui,
        semanticName: semanticName,
        basis: "设计页名「" + String(input.pageName || "").trim() + "」→ " + semanticName + "；" + item.basis,
        needsSemanticName: false
      });
    }
  }

  // ② 只有区域、语义名待给：形状是「区域 + 语义名」，语义名由模型或人来定
  for (const item of uiList) {
    candidates.push({
      target: item.ui,
      ui: item.ui,
      semanticName: "",
      basis: item.basis + "（语义名待给）",
      needsSemanticName: true
    });
  }
  return { registry, uiCandidates: uiList, candidates };
}

function writeRegistryEntry(input) {
  const projectRoot = String(input.projectRoot || "").trim();
  const target = String(input.target || "").trim();
  const ui = String(input.ui || "").trim();
  if (!projectRoot) throw new Error("缺少工程目录");
  if (!target) throw new Error("缺少 Target");
  if (!ui) throw new Error("缺少区域前缀");
  const derived = uiPrefixOf(target);
  if (derived !== ui) {
    throw new Error(
      "Target 与区域不匹配：插件从 Target 前缀推出来的是「" + (derived || "推不出来") + "」，不是「" + ui
      + "」。请把 Target 写成 " + ui + "xxx 的形式。"
    );
  }

  const raw = readRegistryDocument(projectRoot);
  const registryPath = raw.registryPath;
  let document = raw.document;
  if (!document || typeof document !== "object" || !Array.isArray(document.pages)) document = { pages: [] };

  const designSource = { fileId: String(input.fileId || ""), layerId: String(input.layerId || "") };
  const designPageName = String(input.designPageName || "").trim();
  if (designPageName) designSource.designPageName = designPageName;

  const entry = { target, ui, derivation: "界面上按设计页名与既有区域约定推导", designSource };
  const index = document.pages.findIndex(function (page) {
    if (!page) return false;
    if (page.target === target) return true;
    const source = page.designSource || {};
    return Boolean(designSource.layerId) && String(source.layerId || "") === designSource.layerId;
  });
  if (index >= 0) document.pages[index] = entry;
  else document.pages.push(entry);

  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(document, null, 2) + "\n", "utf8");
  return { registryPath, entry, replaced: index >= 0 };
}

module.exports = { candidatesFor, writeRegistryEntry, uiPrefixOf, pascalFromPageName };
