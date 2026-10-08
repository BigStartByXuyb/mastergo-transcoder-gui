#!/usr/bin/env node
"use strict";

// 文档与实现的一致性：某一件事的说明只在它那一份权威文档里写，且必须与真值源一一对应。
// 跑法：node tests/docs-consistency.test.js
//
// 这一条是「同一件事只有一处」的机械门禁：说明漂移（文档没跟着实现改、别处又抄了一份、
// 改名之后引用没跟上）在这里当场失败，不用等人逐轮审。

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { pluginSources, PLUGIN_ENV_NAME } = require("../lib/plugin-root.js");

const ROOT = path.join(__dirname, "..");
const README = "README.md";
const DOCS = "docs";
/* 验收记录记的是当次口径，不参与「当前口径」的比对。 */
const RECORD = DOCS + "/ui-verification.md";
const INDEX = DOCS + "/README.md";
const TIERS_DOC = DOCS + "/plugin-sources.md";
const RELEASE_DOC = DOCS + "/release-and-update.md";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/*
 * 扫描范围：仓库自己的源码与说明。跳过的是「不是说明」的东西 —— 用户状态与运行目录
 * （agents、plugins、runtime、work、logs… 这些），入库的构建产物 public/（说明在 ui/src，
 * 产物由它构建出来），以及第三方解压件 vendor/。
 */
const SCANNED_EXT = /\.(js|mjs|cjs|ts|tsx|md|json|ps1|cmd|yml|yaml|toml)$/;
const SKIP_DIRS = [
  ".git", "node_modules", "coverage", "public",
  "agents", "blobs", "chats", "logs", "plugins", "runtime", "update-cache", "vendor", "versions", "work",
  "dist", "output", ".playwright-cli"
];

function scannedFiles() {
  const found = [];
  const walk = function (dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!SCANNED_EXT.test(entry.name)) continue;
      const rel = path.relative(ROOT, full).split(path.sep).join("/");
      // 发布说明与验收记录记的是当次实况，不参与「当前口径」的比对。
      if (rel === RECORD || path.basename(rel) === "changelog.json") continue;
      found.push(rel);
    }
  };
  walk(ROOT);
  return found;
}

/* 说明书：仓库里的 Markdown（验收记录除外）。 */
function proseFiles() {
  return scannedFiles().filter(function (rel) {
    return rel.endsWith(".md") && rel !== RECORD;
  });
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
  read(TIERS_DOC).split(/\r?\n/).forEach(function (line) {
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
  assert.strictEqual(doc.length, code.length, TIERS_DOC + " 的档位数要与 pluginSources() 一致");
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
    "lib/plugin-root.js",
    TIERS_DOC
  ]);
  const hits = scannedFiles().filter(function (rel) {
    return !allowed.has(rel) && read(rel).includes(PLUGIN_ENV_NAME);
  });
  assert.deepStrictEqual(hits, [], "环境变量名只能在真值源与 " + TIERS_DOC + " 里出现（别处请走常量或指向那份文档）");
}

// 引用的文档要真的在：文档改名或删掉之后，别处那条引用就是失效的（代码注释与文档里都算引用）。
function caseDocRefsResolve() {
  for (const rel of scannedFiles()) {
    const text = read(rel);
    const names = new Set();
    // 任何文件里写「docs/<文档名>.md」都算引用。
    for (const match of text.matchAll(/docs\/([\w.-]+\.md)/g)) names.add(match[1]);
    // docs 下的文档里，同目录的 Markdown 链接也算。
    if (rel.startsWith(DOCS + "/")) {
      for (const match of text.matchAll(/\]\(([\w.-]+\.md)\)/g)) names.add(match[1]);
    }
    for (const name of names) {
      assert.ok(
        fs.existsSync(path.join(ROOT, DOCS, name)),
        rel + " 引用的 " + DOCS + "/" + name + " 不存在（文档改名或删掉之后要全仓一次改齐）"
      );
    }
  }
}

/*
 * 一句话只有一处说：每一条「只有一处说」的事实，给它一个标志性字串与唯一该出现的那一份文档。
 * 说明文件里在本处之外出现这个字串 = 又抄了一份，当场失败。
 * 加一条事实 = 加一行；事实换了住处 = 改这一行的 home。
 */
const ONE_HOME_FACTS = [
  { phrase: "每 10 分钟", home: RELEASE_DOC, what: "两条版本线的复查节拍" },
  { phrase: "有任务在跑时不给装", home: RELEASE_DOC, what: "装插件的门禁" },
  { phrase: "同时来自", home: TIERS_DOC, what: "同一份插件只列一行" },
  { phrase: "<安装根>\\plugins\\mastergo-wpf-transcoder", home: TIERS_DOC, what: "客户端自带那一份装在哪" },
  { phrase: "清单先到而文件没到", home: RELEASE_DOC, what: "发布件先传文件、清单最后传" }
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

// 逐档清单只在 docs/plugin-sources.md 里：别处的说明与注释只留一句 + 指向它。
// 「复述」的签名有三种 —— 一行里出现两个以上的档位名、一个档位的列表项（`1. 启动参数 …`）、
// 档位表的表头（`| 第几档 | 来源 |`）。单个档位名本身不算（「客户端自带那份运行环境」这类正常说法）。
function caseNoTierListCopy() {
  const labels = truth().map(function (source) { return source.label.replace(/`/g, ""); });
  for (const rel of scannedFiles()) {
    if (rel === TIERS_DOC || rel === "tests/docs-consistency.test.js") continue;
    const copied = read(rel).split(/\r?\n/).filter(function (line) {
      if (/^\|\s*第几档\s*\|/.test(line.trim())) return true;
      const hits = labels.filter(function (label) { return line.includes(label); }).length;
      return hits > 1 || (hits === 1 && /^\s*(?:\d+\.|-)\s/.test(line));
    });
    assert.deepStrictEqual(copied, [], rel + " 里不要再逐档列清单（那一份清单只在 " + TIERS_DOC + " 里）");
  }
  assert.ok(read(README).includes(path.basename(TIERS_DOC)), README + " 要指向 " + TIERS_DOC);
  assert.ok(read(DOCS + "/install.md").includes(path.basename(TIERS_DOC)), DOCS + "/install.md 要指向 " + TIERS_DOC);
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
    ["引用的文档都存在", caseDocRefsResolve],
    ["一句话只有一处说", caseFactsHaveOneHome],
    ["逐档清单不在别处复述", caseNoTierListCopy],
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
