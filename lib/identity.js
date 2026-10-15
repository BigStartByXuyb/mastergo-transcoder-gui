"use strict";

/*
 * 页面身份（Target + 区域前缀）的候选推导与登记表写入。
 *
 * 为什么需要：run-all 的取值链要求「Target 带区域前缀」或「登记表里登记过」，缺一个就停在入口。
 * 插件跑法里这一步由 agent 读规则 + 问人补上；这里把它拆成可执行的两步：
 *   ① candidatesFor()：按插件口径列候选（区域取项目既有约定，语义名来自设计页名的机械转换），
 *      并判定能不能自动采用 —— 只有这一页登记过、页名没变才自动；判不了就给整句原因
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
  const layerId = String(input.layerId || "").trim();
  /*
   * 人已经给了区域（例如这一页属于 F1）就以他给的为准：区域是团队对项目的约定，设计稿里没有。
   * 这时「候选」只剩一件要定的事 —— 语义名，不该再拿项目里别的区域来混淆。
   */
  const explicitUi = String(input.explicitUi || "").trim();
  const uiList = explicitUi
    ? [{ ui: explicitUi, count: 0, sameFileCount: 0, basis: "你指定的区域" }]
    : uiCandidates(registry, fileId);
  const semanticName = pascalFromPageName(input.pageName);
  const candidates = [];
  /*
   * 这一页（同一个设计页帧）在登记表里登记过没有 —— 只有登记过才自动沿用。
   * 页帧（layerId）是唯一可靠的键：一个设计文件里可以有好几页、分属不同区域，
   * 拿同一文件里别的页的区域当这一页的先例，会把区域悄悄写错。
   */
  const hit = layerId ? registry.pages.find((page) => page.layerId === layerId) : null;
  const registered = hit && hit.target && hit.ui ? hit : null;
  // 设计稿当前页名与登记表里这一页记的名字不一致 → 说明改名了，必须显式确认，不能静默沿用。
  const renamed = Boolean(
    registered && input.pageName && registered.designPageName && registered.designPageName !== input.pageName
  );
  const naming = renamed && !explicitUi
    ? [{
      target: registered.target,
      ui: registered.ui,
      semanticName: "",
      basis: "登记表里这一页叫「" + registered.designPageName + "」（Target " + registered.target + "），设计稿现在叫「"
        + input.pageName + "」：确认要改名就先填 Ui 区域再点「自动补」覆盖这一条",
      needsSemanticName: true,
      rename: true
    }]
    : [];
  if (registered) {
    candidates.push({
      target: registered.target,
      ui: registered.ui,
      semanticName: "",
      basis: "登记表里这一页已经登记过（layerId " + layerId + "）：区域 " + registered.ui + "，Target " + registered.target,
      needsSemanticName: false,
      registered: true,
      // 沿用这条时要把登记里的设计页名一起带回去：写回是整条替换，漏了它下次改名就没人提示了。
      designPageName: registered.designPageName || ""
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
   * 能不能自动采用第一条：只有「这一页登记过、且页名没变」。其余一律停下要人点一次，
   * 并把「人要做什么」整句给出去（界面直接显示这句，不在前端重写一份）。
   * 区域是团队对项目的约定，设计稿里没有；同一个设计文件里也可能有好几页分属不同区域，
   * 所以这一页没有先例时不替人猜 —— 猜测的结果会被写进登记表，后面每一步都跟着错。
   */
  let blocked = "";
  if (renamed) {
    // 改名是另一回事，不跟「区域待定」混在一句里：这一页换过身份，必须显式确认一次。
    blocked = "登记表里这一页叫「" + registered.designPageName + "」，设计稿现在叫「" + input.pageName
      + "」（登记的是 Target " + registered.target + "）：改了名就不能静默沿用旧 Target。"
      + "确认要改名，就点下面的候选覆盖这一条"
      + (explicitUi ? "。" : "，或填上 Ui 区域再点「自动补 Target / 区域」。");
  }
  else if (explicitUi) {
    blocked = "";
  }
  else if (!registered && uiList.length > 0) {
    blocked = "这一页（layerId " + (layerId || "没给") + "）还没登记过区域：区域是团队对项目的约定，设计稿里没有，"
      + "同一个设计文件里也可能有好几页分属不同区域，替不了你猜。从下面候选里点一个（或直接填 Ui 区域再点"
      + "「自动补 Target / 区域」）就会写进该工程的 docs/page-registry.json，这一页以后自动沿用。";
  }
  else if (!registered) {
    blocked = "这个工程还没有任何区域约定（登记表里没有页面，也没有带前缀的 Target）：工程里第一页要人给一次区域，"
      + "在「UI 区域」里填一个区域前缀（例如 F1）再点「自动补 Target / 区域」；给过就写进该工程的 "
      + "docs/page-registry.json，这一页以后自动沿用。";
  }
  return {
    registry,
    uiCandidates: uiList,
    candidates: naming.concat(candidates).filter((item) => !explicitUi || item.ui === explicitUi),
    blocked: blocked
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
