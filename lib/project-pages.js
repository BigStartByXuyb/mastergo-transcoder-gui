"use strict";

/*
 * 读项目登记表 docs/page-registry.json：给界面列出「这一页属于哪个区域」的权威来源。
 *
 * 只读、fail-soft：没有登记表不是错误（命令行给 Target 一样能跑），坏 JSON 也只是如实报出来，
 * 不让界面白屏。区域前缀的取值链真值源仍在插件 run-all.ps1，这里只是把登记表里的字段照实拿给界面。
 */

const fs = require("fs");
const path = require("path");

const REGISTRY_REL = path.join("docs", "page-registry.json");

function readPageRegistry(projectRoot) {
  const root = String(projectRoot || "").trim();
  if (!root) return { exists: false, registryPath: "", pages: [], problem: "还没有填工程目录" };
  const registryPath = path.join(root, REGISTRY_REL);
  if (!fs.existsSync(registryPath)) {
    return {
      exists: false,
      registryPath: registryPath,
      pages: [],
      problem: "这个工程没有 docs/page-registry.json：Target 与区域前缀只能由命令行给出"
    };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  }
  catch (error) {
    return { exists: true, registryPath: registryPath, pages: [], problem: "登记表不是合法 JSON：" + error.message };
  }
  const pages = Array.isArray(parsed && parsed.pages) ? parsed.pages : [];
  return {
    exists: true,
    registryPath: registryPath,
    problem: "",
    pages: pages.map(function (page) {
      const source = page && page.designSource ? page.designSource : {};
      const derivation = page && page.derivation ? String(page.derivation) : "";
      const found = /F\d+/.exec(derivation);
      return {
        target: String((page && page.target) || ""),
        ui: String((page && page.ui) || "") || (found ? found[0] : ""),
        derivation: derivation,
        fileId: String(source.fileId || ""),
        layerId: String(source.layerId || ""),
        designPageName: String(source.designPageName || "")
      };
    }).filter(function (page) { return page.target || page.layerId; })
  };
}

module.exports = { readPageRegistry, REGISTRY_REL };
