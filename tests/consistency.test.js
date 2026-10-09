#!/usr/bin/env node
"use strict";

// 一致性门禁：说明只有一处、字面量只有一处，且说明与实现必须对得上。
// 跑法：node tests/consistency.test.js
//
// 两半：
//   一、说明一致性 —— 一件事的完整说明只在它那一份权威文档里（索引 docs/README.md），
//       别处只留一句 + 指向；文档引用的文件要真的在。
//   二、字面量单源 —— 值只在真值源定义一次（端口、钉死版本、环境变量名），别处走常量。
// 漂移在这里当场失败，不用等人逐轮审。

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { pluginSources, PLUGIN_ENV_NAME } = require("../lib/plugin-root.js");
const { DEFAULT_PORT, API_TARGET_ENV } = require("../lib/config.js");
const { TOKEN_ENV_KEY } = require("../lib/mcp-token.js");
const { TOOLS, PWSH_ENV } = require("../lib/runtime.js");
const { SUPERVISED_ENV, HOME_ENV } = require("../lib/launch.js");
const { KEY_ENV, PINNED_VERSION } = require("../lib/codex.js");

const ROOT = path.join(__dirname, "..");
const README = "README.md";
const DOCS = "docs";
/* 验收记录记的是当次口径，不参与「当前口径」的比对。 */
const RECORD = DOCS + "/ui-verification.md";
const INDEX = DOCS + "/README.md";
const TIERS_DOC = DOCS + "/plugin-sources.md";
const RELEASE_DOC = DOCS + "/release-and-update.md";
const STRUCTURE_DOC = DOCS + "/structure.md";
const GATES_DOC = DOCS + "/gates.md";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/*
 * 扫描范围：仓库自己的源码与说明。跳过的是「不是说明」的东西 —— 用户状态与运行目录
 * （agents、plugins、runtime、work、logs… 这些），入库的构建产物 public/（说明在 ui/src，
 * 产物由它构建出来），第三方解压件 vendor/，以及由源码生成的 runtime-assets.json。
 */
const SCANNED_EXT = /\.(js|mjs|cjs|ts|tsx|md|json|ps1|cmd|yml|yaml|toml|go)$/;
const SKIP_DIRS = [
  ".git", "node_modules", "coverage", "public",
  "agents", "blobs", "chats", "logs", "plugins", "runtime", "update-cache", "vendor", "versions", "work",
  "dist", "output", ".playwright-cli"
];
const SKIP_FILES = [
  "changelog.json", "runtime-assets.json", "package-lock.json",
  // 安装根下的用户状态（.gitignore 里那些）：本机跑的时候会在仓库根出现。
  "local.json", "board.json", "chats.json", "current.json"
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
      if (rel === RECORD || SKIP_FILES.includes(path.basename(rel))) continue;
      found.push(rel);
    }
  };
  walk(ROOT);
  return found;
}

/* 说明文件：仓库里的 Markdown（验收记录除外）。 */
function proseFiles() {
  return scannedFiles().filter(function (rel) {
    return rel.endsWith(".md") && rel !== RECORD;
  });
}

/* 真值源：七档的 id 与名字（顺序就是查找顺序）。 */
function truth() {
  return pluginSources({
    installRoot: path.join(os.tmpdir(), "consistency-install"),
    env: {},
    home: path.join(os.tmpdir(), "consistency-home")
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

/*
 * 字面量只有一个住处：值只在真值源定义一次，说明里写它的只有那一份权威文档，别处走常量。
 * 值本身从真值源读出来，不在这里另抄一遍；加一条 = 加一行；换了真值源 = 改 home。
 *
 * 只登记「整仓只有一处说」的值。通用字面量不进来 —— 例如 127.0.0.1：代理的免代理清单、
 * URL 兜底、用例夹具各自说的是不同的事，不是同一件事实的多个化身，登记进来只会拦正常的写法。
 *
 * kind 决定「算不算同一处」：name 认独立的一段（X 与 X_ENV 是两回事）；version / number
 * 只忌前后再跟数字与点 —— 于是带 v 前缀、或嵌在文件名里（形如 node-v<版本>-win-x64.zip）的那一份也算命中。
 * 「同一事实的第二遍」只准出现在真值源与它的权威文档里；用例夹具照规矩用假值，不抄生产值，
 * 于是夹具不会因为版本/端口一变就跟着红。
 */
const SINGLE_SOURCE = [
  { value: PLUGIN_ENV_NAME, kind: "name", home: ["lib/plugin-root.js", TIERS_DOC], what: "插件根环境变量名" },
  { value: TOKEN_ENV_KEY, kind: "name", home: ["lib/mcp-token.js", README], what: "MasterGo token 环境变量名" },
  // 开发代理的地址变量名是两端的契约：真值源定义它，起前端那一侧与 Vite 配置各写一次，说明写一次；
  // 别处再出现就是又抄了一份。
  {
    value: API_TARGET_ENV,
    kind: "name",
    home: ["lib/config.js", "ui/vite.config.ts", README],
    what: "开发代理的地址变量名"
  },
  { value: String(DEFAULT_PORT), kind: "number", home: ["lib/config.js", README], what: "服务默认端口" },
  { value: TOOLS.node.version, kind: "version", home: ["lib/runtime.js", DOCS + "/install.md"], what: "钉死的 Node 版本" },
  { value: TOOLS.pwsh.version, kind: "version", home: ["lib/runtime.js", DOCS + "/install.md"], what: "钉死的 PowerShell 7 版本" },
  // 壳那一侧（launch.js 与 Go 启动器）不 require 服务模块，安装根这个名字只能各写一次。
  { value: HOME_ENV, kind: "name", home: ["lib/launch.js", "tools/launcher/main.go"], what: "安装根环境变量名" },
  { value: PWSH_ENV, kind: "name", home: ["lib/runtime.js"], what: "「用哪一份 pwsh」的环境变量名" },
  { value: SUPERVISED_ENV, kind: "name", home: ["lib/launch.js", README], what: "「被监督进程拉起」的环境变量名" },
  { value: KEY_ENV, kind: "name", home: ["lib/codex.js"], what: "Codex 子进程的 key 环境变量名" },
  { value: PINNED_VERSION, kind: "version", home: ["lib/codex.js", DOCS + "/install.md"], what: "钉死的 Codex 版本" }
];

function caseSingleSource() {
  const files = scannedFiles();
  const text = new Map(files.map(function (rel) { return [rel, read(rel)]; }));
  const boundary = {
    name: ["(?<![A-Za-z0-9_])", "(?![A-Za-z0-9_])"],
    version: ["(?<![\\d.])", "(?![\\d.])"],
    number: ["(?<![\\d.])", "(?![\\d.])"]
  };
  const mentions = function (body, fact) {
    const escaped = String(fact.value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const edges = boundary[fact.kind];
    return new RegExp(edges[0] + escaped + edges[1]).test(body);
  };
  for (const fact of SINGLE_SOURCE) {
    assert.ok(
      fact.home.some(function (rel) { return text.has(rel) && mentions(text.get(rel), fact); }),
      fact.what + "（" + fact.value + "）在它该在的地方没有出现：" + fact.home.join("、")
    );
    const others = files.filter(function (rel) {
      return !fact.home.includes(rel) && mentions(text.get(rel), fact);
    });
    assert.deepStrictEqual(
      others,
      [],
      "「" + fact.what + "」（" + fact.value + "）只住在 " + fact.home.join("、") + "；别处又写了一遍：" + others.join("、")
    );
  }
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
    if (rel === TIERS_DOC) continue;
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

/*
 * 仓库根的条目（目录与文件）都要登记在 docs/structure.md 的目录表里；空目录与本机运行留下的 *.log 不算结构。
 */
function caseRootEntriesRegistered() {
  // 真值源就是文档里这两处：目录表的第一列 + 根条目清单那一段。别的章节里出现的反引号名不算。
  const text = read(STRUCTURE_DOC);
  const at = function (marker) {
    const index = text.indexOf(marker);
    assert.ok(index >= 0, STRUCTURE_DOC + " 里找不到「" + marker + "」—— 结构变了要同步改这条门禁");
    return index;
  };
  const catalog = text.slice(at("## 目录"), at("## 依赖方向"));
  const rootList = text.slice(at("根条目清单"), at("## 依赖方向"));
  const tokens = new Set();
  for (const line of catalog.split(/\r?\n/)) {
    if (!/^\|/.test(line.trim())) continue;
    // 只取这一行的第一列（「位置」那格），里面可能用顿号列了好几个名字。
    const firstCell = line.split("|")[1] || "";
    for (const match of firstCell.matchAll(/`([^`]+)`/g)) tokens.add(match[1].replace(/\/$/, ""));
  }
  for (const match of rootList.matchAll(/`([^`]+)`/g)) tokens.add(match[1].replace(/\/$/, ""));
  const prefixes = [...tokens].filter(function (name) { return name.endsWith("*"); })
    .map(function (name) { return name.slice(0, -1); });
  // 文档里用 `*-credentials` 这种通配表示一族名字：含 * 的登记名按通配匹配。
  const globs = [...tokens].filter(function (name) { return name.includes("*"); })
    .map(function (name) { return new RegExp("^" + name.split("*").map(function (part) { return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join(".*") + "$"); });
  const missing = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter(function (entry) { return !entry.name.startsWith(".") && !entry.name.endsWith(".log"); })
    .filter(function (entry) { return !entry.isDirectory() || hasAnyFile(path.join(ROOT, entry.name)); })
    .map(function (entry) { return entry.name; })
    .filter(function (name) {
      if (tokens.has(name)) return false;
      if (prefixes.some(function (prefix) { return name.startsWith(prefix); })) return false;
      if (globs.some(function (pattern) { return pattern.test(name); })) return false;
      // 表里写成子路径（如 `tools/launcher/`）也算登记了顶层那一层。
      return ![...tokens].some(function (token) { return token.startsWith(name + "/"); });
    });
  assert.deepStrictEqual(missing, [], "仓库根这些条目没写进 " + STRUCTURE_DOC + "：「" + missing.join("、") + "」");
}

function hasAnyFile(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) return true;
    if (entry.isDirectory() && hasAnyFile(path.join(dir, entry.name))) return true;
  }
  return false;
}

/* 每个模块的文件头都要有一句职责注释：一个模块的职责写在它自己那一处，别处不再复述。 */
const MODULE_DIRS = ["lib", "scripts", path.join("scripts", "lib"), path.join("ui", "src", "app"), path.join("ui", "src", "lib")];

function caseModulesHaveHeaderComment() {
  const missing = [];
  for (const rel of MODULE_DIRS) {
    for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(js|mjs|cjs|ts|tsx)$/.test(entry.name) || entry.name.includes(".test.")) continue;
      const head = fs.readFileSync(path.join(ROOT, rel, entry.name), "utf8").split(/\r?\n/).slice(0, 30).join("\n");
      if (!hasHeaderComment(head)) {
        missing.push(path.join(rel, entry.name).split(path.sep).join("/"));
      }
    }
  }
  assert.deepStrictEqual(missing, [], "这些模块缺少文件头职责注释：" + missing.join("、"));
}

/*
 * 文件头那句职责：头 30 行里**第一段注释**就是它，整段要有实质内容（去掉空白 ≥ 30 字）。
 * 一段可以是 `/* … *\/`，也可以是连续的若干 `//` 行；随便一句短注释蒙不过去。
 */
function hasHeaderComment(head) {
  const lines = head.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("/*")) {
      const rest = lines.slice(i).join("\n");
      const end = rest.indexOf("*/");
      const block = end < 0 ? rest : rest.slice(0, end + 2);
      return block.replace(/\s/g, "").length >= 30;
    }
    if (trimmed.startsWith("//")) {
      let block = "";
      for (let j = i; j < lines.length && lines[j].trim().startsWith("//"); j++) block += lines[j];
      return block.replace(/\s/g, "").length >= 30;
    }
  }
  return false;
}

// 门禁定义也只有一处：docs/gates.md 的表与这里注册的用例一一对应。
const CASES = [
  ["档位表与代码一一对应", caseTierTableMatchesCode],
  ["字面量只在真值源", caseSingleSource],
  ["引用的文档都存在", caseDocRefsResolve],
  ["一句话只有一处说", caseFactsHaveOneHome],
  ["逐档清单不在别处复述", caseNoTierListCopy],
  ["每份文档都进索引", caseDocsIndexed],
  ["顶层条目都在结构表里", caseRootEntriesRegistered],
  ["每个模块都有职责头", caseModulesHaveHeaderComment],
  ["门禁定义与实际用例一致", caseGateListMatches]
];

function caseGateListMatches() {
  const rows = read(GATES_DOC).split(/\r?\n/)
    .filter(function (line) { return /^\|\s*\S/.test(line); })
    .map(function (line) { return line.split("|")[1].trim(); })
    .filter(function (name) { return name && name !== "用例" && !/^-+$/.test(name); });
  assert.deepStrictEqual(
    rows.slice().sort(),
    CASES.map(function (item) { return item[0]; }).sort(),
    GATES_DOC + " 的表要与这里注册的用例一一对应"
  );
}

try {
  for (const [name, run] of CASES) {
    run();
    console.log("  ok  " + name);
  }
  console.log("consistency.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
