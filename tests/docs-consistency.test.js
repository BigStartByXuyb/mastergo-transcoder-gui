#!/usr/bin/env node
"use strict";

// 文档与实现的一致性：某一件事的说明只在它那一份权威文档里写，且必须与真值源一一对应。
// 跑法：node tests/docs-consistency.test.js
//
// 这一条是「同一件事只有一处」的机械门禁：说明漂移（文档没跟着实现改、或别处又抄了一份）
// 在这里当场失败，不用等人逐轮审。

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { pluginSources, PLUGIN_ENV_NAME } = require("../lib/plugin-root.js");

const ROOT = path.join(__dirname, "..");
const README = "README.md";
const DOCS = path.join("docs");
/* 验收记录记的是当次口径，不参与「当前口径」的比对。 */
const RECORD = path.join(DOCS, "ui-verification.md");
const INDEX = path.join(DOCS, "README.md");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/* 说明书：README 与 docs 下的文档（验收记录除外）。 */
function proseFiles() {
  return [README].concat(
    fs.readdirSync(path.join(ROOT, DOCS))
      .filter(function (name) { return name.endsWith(".md"); })
      .map(function (name) { return path.join(DOCS, name); })
      .filter(function (rel) { return rel !== RECORD; })
  );
}

/* 真值源：七档的 id 与名字（顺序就是查找顺序）。 */
function truth() {
  return pluginSources({
    installRoot: path.join(os.tmpdir(), "docs-consistency-install"),
    env: {},
    home: path.join(os.tmpdir(), "docs-consistency-home")
  });
}

// docs/plugin-sources.md 的表格：每一行是「| 第几档 | 来源 | 这一档归谁管 |」。
function documentedTable() {
  const rows = [];
  read(path.join(DOCS, "plugin-sources.md")).split(/\r?\n/).forEach(function (line) {
    const cells = line.split("|").map(function (cell) { return cell.trim(); });
    // 表格行：| 序号 | 来源 | 说明 | → split 后首尾是空串，中间三格（+ 末位空串）。
    if (cells.length < 5) return;
    if (!/^\d+$/.test(cells[1])) return;
    rows.push({ order: Number(cells[1]), label: cells[2], note: cells[3] });
  });
  return rows;
}

function caseTierTableMatchesCode() {
  const code = truth();
  const doc = documentedTable();
  assert.strictEqual(doc.length, code.length, "docs/plugin-sources.md 的档位数要与 pluginSources() 一致");
  code.forEach(function (source, index) {
    assert.strictEqual(doc[index].order, index + 1, "第 " + (index + 1) + " 档的序号要对得上");
    // 两列都逐字比对（只有反引号是文档的排版，比较时去掉）。
    const plain = function (value) { return String(value).replace(/`/g, ""); };
    assert.strictEqual(plain(doc[index].label), plain(source.label), "第 " + (index + 1) + " 档的来源名要与真值源逐字一致");
    assert.strictEqual(plain(doc[index].note), plain(source.note), "第 " + (index + 1) + " 档的说明要与真值源逐字一致");
  });
}

// 环境变量名只在真值源与它的权威文档里出现；别处写它必须走常量或链接到那一份文档。
function caseEnvNameNotScattered() {
  const allowed = new Set([
    path.join("lib", "plugin-root.js"),
    path.join(DOCS, "plugin-sources.md")
  ]);
  const hits = [];
  const walk = function (dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // 只扫仓库自己的源码与文档：装好的版本、构建产物、运行目录不是「说明」的一部分。
      if (["node_modules", ".git", "public", "dist", "versions", "output", ".playwright-cli", "work", "runtime", "update-cache"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(js|mjs|ts|tsx|md|json)$/.test(entry.name)) continue;
      const rel = path.relative(ROOT, full);
      if (allowed.has(rel) || rel === RECORD || entry.name === "changelog.json") continue;
      if (read(rel).includes(PLUGIN_ENV_NAME)) hits.push(rel);
    }
  };
  walk(ROOT);
  assert.deepStrictEqual(hits, [], "环境变量名只能在真值源与 docs/plugin-sources.md 里出现（别处请走常量或指向那份文档）");
}

/*
 * 一句话只有一处说：每一条「只有一处说」的事实，给它一个标志性字串与唯一该出现的那一份文档。
 * 说明文件（README 与 docs 下的文档）里在本处之外出现这个字串 = 又抄了一份，当场失败。
 * 加一条事实 = 加一行；事实换了住处 = 改这一行的 home。
 */
const ONE_HOME_FACTS = [
  { phrase: "每 10 分钟", home: path.join(DOCS, "release-and-update.md"), what: "两条版本线的复查节拍" },
  { phrase: "有任务在跑时不给装", home: path.join(DOCS, "release-and-update.md"), what: "装插件的门禁" },
  { phrase: "同时来自", home: path.join(DOCS, "plugin-sources.md"), what: "同一份插件只列一行" }
];

function caseFactsHaveOneHome() {
  const files = proseFiles();
  for (const fact of ONE_HOME_FACTS) {
    assert.ok(read(fact.home).includes(fact.phrase), fact.home + " 里少了「" + fact.what + "」（" + fact.phrase + "）");
    const others = files.filter(function (rel) {
      return rel !== fact.home && read(rel).includes(fact.phrase);
    });
    assert.deepStrictEqual(others, [], "「" + fact.what + "」只在 " + fact.home + " 里说；别处又抄了一份：" + others.join("、"));
  }
}

// README 与安装文档不复述逐档清单：它们只留一句 + 指向权威文档。
// 「逐档复述」的签名是**编号列表**（`1. 启动参数 …` 这种），不是提到某个档位的名字 ——
// 「客户端自带那份运行环境」这类正常说法不该被这条挡住。
function caseNoTierListCopy() {
  for (const rel of [README, path.join(DOCS, "install.md")]) {
    const text = read(rel);
    assert.ok(text.includes("plugin-sources.md"), rel + " 要指向 docs/plugin-sources.md");
    const labels = truth().map(function (source) { return source.label.replace(/`/g, ""); });
    const numbered = text.split(/\r?\n/).filter(function (line) {
      const trimmed = line.trim();
      if (!/^\d+\.\s/.test(trimmed)) return false;
      return labels.some(function (label) { return trimmed.includes(label); });
    });
    assert.deepStrictEqual(numbered, [], rel + " 里不要再逐档列清单（那一份清单只在 docs/plugin-sources.md 里）");
  }
}

// 文档索引里的每一份文档都要在，且每一份 docs/*.md 都要进索引。
function caseDocsIndexed() {
  const index = read(INDEX);
  const files = fs.readdirSync(path.join(ROOT, DOCS))
    .filter(function (name) { return name.endsWith(".md") && name !== "README.md"; });
  for (const name of files) {
    assert.ok(index.includes("(" + name + ")"), INDEX + " 里少了 " + name + " 这一行");
  }
}

try {
  const cases = [
    ["档位表与代码一一对应", caseTierTableMatchesCode],
    ["环境变量名不散落", caseEnvNameNotScattered],
    ["一句话只有一处说", caseFactsHaveOneHome],
    ["README / 安装文档不复述逐档清单", caseNoTierListCopy],
    ["每份文档都进索引", caseDocsIndexed]
  ];
  for (const [name, run] of cases) {
    run();
    console.log("  ok  " + name);
  }
  console.log("docs-consistency.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
