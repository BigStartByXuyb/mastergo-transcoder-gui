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
// 区域候选：优先同一设计文件里已登记页面的区域（同文件通常同区域），其次全项目频次。
function uiCandidates(registry, fileId) {
  const project = new Map();
  const sameFile = new Map();
  for (const page of registry.pages) {
    const prefix = uiPrefixOf(page.target);
    const ui = page.ui || prefix;
    if (!ui) continue;
    project.set(ui, (project.get(ui) || 0) + 1);
    if (fileId && page.fileId === fileId) sameFile.set(ui, (sameFile.get(ui) || 0) + 1);
  }
  return [...project.keys()]
    .map((ui) => ({
      ui,
      count: project.get(ui),
      sameFileCount: sameFile.get(ui) || 0,
      basis: sameFile.get(ui)
        ? "同一设计文件里已有 " + sameFile.get(ui) + " 个页面用这个区域"
        : "项目里已有 " + project.get(ui) + " 个页面用这个区域"
    }))
    .sort((left, right) =>
      right.sameFileCount - left.sameFileCount
      || right.count - left.count
      || left.ui.localeCompare(right.ui)
    );
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
  const fileId = String(input.fileId || "").trim();
  const uiList = uiCandidates(registry, fileId);
  const semanticName = pascalFromPageName(input.pageName);
  const candidates = [];
  // 设计稿当前页名与登记表里这一页记的名字不一致 → 说明改名了，必须显式确认，不能静默沿用。
  const naming = [];
  const registered = registry.pages.find((page) => input.layerId && page.layerId === input.layerId);
  if (registered && input.pageName && registered.designPageName && registered.designPageName !== input.pageName) {
    naming.push({
      target: registered.target,
      ui: registered.ui,
      semanticName: "",
      basis: "登记表里这一页叫「" + registered.designPageName + "」（Target " + registered.target + "），设计稿现在叫「"
        + input.pageName + "」：确认要改名就先填 Ui 区域再点「自动补」覆盖这一条",
      needsSemanticName: true,
      rename: true
    });
  }

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
  /*
   * 只有「恰好一个已知区域」才叫明确，可以自动采用；其余一律要人点一次：
   *   · 有 fileId → 看同一设计文件里登记过几个区域（0 个＝没有先例，≥2 个＝有分歧，都不明确）；
   *   · 没有 fileId → 退回全项目里登记过的区域。
   * 之前写成「>1 才算不明确」，会把「这个文件一次都没登记过」误判成明确。
   */
  const scoped = fileId ? uiList.filter((item) => item.sameFileCount > 0) : uiList;
  const ambiguous = scoped.length !== 1;
  return {
    registry,
    uiCandidates: uiList,
    candidates: naming.concat(candidates),
    ambiguous: ambiguous
  };
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
