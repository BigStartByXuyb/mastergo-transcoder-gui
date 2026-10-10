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

const { pluginSources, activePluginSource, PLUGIN_ENV_NAME, PLUGIN_MARKER } = require("../lib/plugin-root.js");
const { DEFAULT_PORT, API_TARGET_ENV } = require("../lib/config.js");
const { TOKEN_ENV_KEY } = require("../lib/mcp-token.js");
const { TOOLS, PWSH_ENV } = require("../lib/runtime.js");
const { SUPERVISED_ENV, HOME_ENV } = require("../lib/launch.js");
const { KEY_ENV, PINNED_VERSION } = require("../lib/codex.js");

const ROOT = path.join(__dirname, "..");
const README = "README.md";
const DOCS = "docs";
/* 验收记录记的是当次口径，不参与「当前口径」的比对；按月份拆在 docs/records/ 下。 */
function isRecord(rel) {
  return rel.startsWith(DOCS + "/records/");
}
const INDEX = DOCS + "/README.md";
const TIERS_DOC = DOCS + "/plugin-sources.md";
const RELEASE_DOC = DOCS + "/release-and-update.md";
const STRUCTURE_DOC = DOCS + "/structure.md";
const GATES_DOC = DOCS + "/gates.md";
const FACTS_DOC = DOCS + "/facts.md";
const LEDGER_DOC = DOCS + "/audit-ledger.md";
const RECORD_INDEX = DOCS + "/records.md";

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
      if (isRecord(rel) || SKIP_FILES.includes(path.basename(rel))) continue;
      found.push(rel);
    }
  };
  walk(ROOT);
  return found;
}

/* 说明文件：仓库里的 Markdown（验收记录除外）。 */
function proseFiles() {
  return scannedFiles().filter(function (rel) {
    return rel.endsWith(".md") && !isRecord(rel);
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

/*
 * 判据台账（docs/facts.md）：一件事的判据只能登记在一处。
 * 表里每行的「真值源」列写成 `文件` · `那段唯一的字符串`（可写几段），门禁照它核对：
 *   1. 那个文件真的在；2. 那段字符串真的在它里面；3. 那段字符串在 lib/ 与 ui/src/ 下**只出现在这一个文件**。
 * 用例是夹具（会造同样的字符串），不算；所以「同一件事有几处」不用靠人肉 grep。
 * 加一条判据 = 在表里加一行，不改这里。
 */
function caseFactsLedger() {
  const files = scannedFiles().filter(function (rel) {
    return (rel.startsWith("lib/") || rel.startsWith("ui/src/")) && !rel.includes(".test.");
  });
  const text = new Map(files.map(function (rel) { return [rel, read(rel)]; }));
  let checked = 0;
  for (const line of read(FACTS_DOC).split(/\r?\n/)) {
    if (!/^\|\s*\S/.test(line)) continue;
    const cells = line.split("|").map(function (cell) { return cell.trim(); });
    // 表格行：| 这件事 | 真值源 | 谁在读它 | → split 后首尾是空串，中间三格。
    if (cells.length < 5) continue;
    const what = cells[1];
    if (what === "这件事" || /^-+$/.test(what)) continue;
    const quoted = [...cells[2].matchAll(/`([^`]+)`/g)].map(function (match) { return match[1]; });
    assert.ok(quoted.length >= 2, FACTS_DOC + " 的「" + what + "」那行要写「`文件` · `那段字符串`」");
    const home = quoted[0];
    assert.ok(text.has(home), FACTS_DOC + " 的「" + what + "」写的真值源不是本仓的源码文件：" + home);
    for (const marker of quoted.slice(1)) {
      assert.ok(
        text.get(home).includes(marker),
        FACTS_DOC + " 的「" + what + "」在 " + home + " 里找不到那段字符串：" + marker
      );
      const others = files.filter(function (rel) { return rel !== home && text.get(rel).includes(marker); });
      assert.deepStrictEqual(
        others,
        [],
        "「" + what + "」的判据（" + marker + "）只住在 " + home + "；别处又写了一遍：" + others.join("、")
      );
    }
    checked += 1;
  }
  assert.ok(checked >= 5, FACTS_DOC + " 至少要登记几条判据（现在只核对到 " + checked + " 条）");
}

/*
 * 复核台账（docs/audit-ledger.md）：审计给的每条意见都要有处置，且只有三种 —— 已收 / 不修 / 独立一轮。
 * 只核这一条格式（内容是人写的）：留着「待看」或写个别的说法，这里当场失败。
 */
const LEDGER_DISPOSITIONS = ["已收", "不修", "独立一轮"];

function caseAuditLedger() {
  let checked = 0;
  for (const line of read(LEDGER_DOC).split(/\r?\n/)) {
    if (!/^\|\s*\S/.test(line)) continue;
    const cells = line.split("|").map(function (cell) { return cell.trim(); });
    // 表格行：| 轮次 | id | 说什么 | 处置 | 落在哪 | → split 后首尾是空串，中间五格。
    if (cells.length < 6) continue;
    if (cells[1] === "轮次" || /^-+$/.test(cells[1])) continue;
    assert.ok(cells[2], LEDGER_DOC + " 的每行都要写 id（第 " + cells[1] + " 轮那条）");
    assert.ok(
      LEDGER_DISPOSITIONS.includes(cells[4]),
      LEDGER_DOC + " 的「" + cells[2] + "」处置只能是 " + LEDGER_DISPOSITIONS.join(" / ") + "，现在是：" + cells[4]
    );
    assert.ok(cells[5], LEDGER_DOC + " 的「" + cells[2] + "」要写清落在哪 / 为什么不修");
    checked += 1;
  }
  assert.ok(checked >= 5, LEDGER_DOC + " 至少要登记几条复核（现在只核对到 " + checked + " 条）");
}

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
    // 任何文件里写「docs/<路径>.md」都算引用（含子目录）。
    for (const match of text.matchAll(/(?<![\w./:])docs\/([\w./-]+\.md)/g)) names.add(DOCS + "/" + match[1]);
    // Markdown 链接：按它所在文件那一层解析（docs 下的文档最常见，代码注释里也这样算）。
    const baseDir = path.posix.dirname(rel);
    for (const match of text.matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(match[1])) continue;
      names.add(path.posix.normalize(path.posix.join(baseDir, match[1])));
    }
    for (const name of names) {
      assert.ok(
        fs.existsSync(path.join(ROOT, name)),
        rel + " 引用的 " + name + " 不存在（文档改名或删掉之后要全仓一次改齐）"
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
  // 记录按月份拆在 docs/records/ 下，那份索引（docs/records.md）要把每个月份文件都列出来。
  const recordIndex = read(RECORD_INDEX);
  const months = fs.readdirSync(path.join(ROOT, DOCS, "records"))
    .filter(function (name) { return /^\d{4}-\d{2}\.md$/.test(name); });
  for (const name of months) {
    assert.ok(recordIndex.includes(name), RECORD_INDEX + " 里少了 " + name + " 这一行");
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
  // 文档里用 `*-credentials` 这种通配表示一族名字：含 * 的登记名按通配匹配。
  const globs = [...tokens].filter(function (name) { return name.includes("*"); })
    .map(function (name) { return new RegExp("^" + name.split("*").map(function (part) { return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join(".*") + "$"); });
  const missing = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter(function (entry) { return !entry.name.startsWith(".") && !entry.name.endsWith(".log"); })
    .filter(function (entry) { return !entry.isDirectory() || hasAnyFile(path.join(ROOT, entry.name)); })
    .map(function (entry) { return entry.name; })
    .filter(function (name) {
      if (tokens.has(name)) return false;
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
const MODULE_DIRS = ["lib", "shared", "scripts", path.join("scripts", "lib"), path.join("ui", "src", "app"), path.join("ui", "src", "lib")];

function caseModulesHaveHeaderComment() {
  const missing = [];
  for (const rel of MODULE_DIRS) {
    for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(js|mjs|cjs|cts|ts|tsx)$/.test(entry.name) || entry.name.includes(".test.")) continue;
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

// 只该有一处实现的 helper / 判据：定义它的那一处是真值源，别处只准 require/import。
// 加一条 = 加一行；这个 helper 换住处 = 改这一行的 home。
const SINGLE_IMPL = [
  { name: "readJsonIfExists", home: "lib/workdir.js", what: "容错读 JSON" },
  { name: "requirePageTarget", home: "lib/name-safety.js", what: "页面 Target 校验" },
  { name: "requireProjectRoot", home: "lib/name-safety.js", what: "工程目录校验" },
  { name: "uniqueMembers", home: "lib/layout-groups.js", what: "分组跨组唯一化" }
];

function caseSingleImpl() {
  const files = scannedFiles().filter(function (rel) { return /\.(js|cjs|mjs)$/.test(rel); });
  for (const fact of SINGLE_IMPL) {
    // 定义（不是 require/import 的转发）：function X( 或 const X = function / const X = (
    const defined = new RegExp("(?:^|\\n)\\s*(?:function\\s+" + fact.name + "\\s*\\(|const\\s+" + fact.name + "\\s*=\\s*(?:async\\s*)?(?:function|\\())");
    const homes = files.filter(function (rel) { return defined.test(read(rel)); });
    assert.deepStrictEqual(
      homes,
      [fact.home],
      "「" + fact.what + "」(" + fact.name + ") 只该在 " + fact.home + " 定义；别处又写了一份：" + homes.join("、")
    );
  }
}

/*
 * 插件来源的手动切换：挡的是「切不动」与「切了不生效」这两件事，所以判行为 ——
 * 哪几档可切、切了之后定位到哪一份、清掉之后回不回到自动查找顺序。
 * 文档侧要同一次写清（优先级与取消方式），旧散文不能留着。真值源见 docs/plugin-sources.md。
 */
function casePluginSwitchProse() {
  const prose = read(TIERS_DOC);
  assert.ok(!prose.includes("只读与查看"), TIERS_DOC + " 不能再写「只读与查看」：来源表现在支持手动切换");
  assert.ok(prose.includes("pluginOverride"), TIERS_DOC + " 要写清手动选择（pluginOverride）的优先级与取消方式");

  const home = fs.mkdtempSync(path.join(os.tmpdir(), "consistency-switch-"));
  const writePlugin = function (dir) {
    fs.mkdirSync(path.dirname(path.join(dir, PLUGIN_MARKER)), { recursive: true });
    fs.writeFileSync(path.join(dir, PLUGIN_MARKER), "# 夹具\n", "utf8");
    return dir;
  };
  try {
    // 两个 agent 地盘各放一份能认出来的插件：一个排在查找顺序前面，一个排在最后（客户端自带）。
    const codexRoot = writePlugin(path.join(home, "codex", "plugins", "cache", "bigstart", "mastergo-wpf-transcoder", "1.0.0"));
    const installRoot = writePlugin(path.join(home, "install", "plugins", "mastergo-wpf-transcoder", "2.0.0"));
    const options = { env: {}, home: home, codexHome: path.join(home, "codex"), installRoot: path.join(home, "install") };

    const button = new Map(pluginSources(options).map(function (item) { return [item.id, item.canOverride]; }));
    assert.strictEqual(button.get("arg"), false, "启动参数那一档不可手动切换（由启动时那个参数说了算）");
    assert.strictEqual(button.get("env"), false, "环境变量那一档不可手动切换（由系统那边设）");
    for (const id of ["codex-cache", "codex-market", "claude-cache", "claude-market", "install"]) {
      assert.strictEqual(button.get(id), true, "「" + id + "」这一档要能手动切换");
    }

    assert.strictEqual(activePluginSource(options).active.id, "codex-cache", "没手动选时按查找顺序取");
    assert.strictEqual(
      activePluginSource(Object.assign({}, options, { override: "install" })).active.pluginRoot,
      installRoot,
      "手动选了自带那一份就用它（压过查找顺序里排在它前面的档）"
    );
    assert.strictEqual(
      activePluginSource(Object.assign({}, options, { override: "" })).active.id,
      "codex-cache",
      "清掉手动选择就回到自动查找顺序"
    );
  }
  finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/*
 * 界面只认一个档位 id（「客户端自带」那一档：它的管理入口与更新徽章都挂在这一行上）。
 * 前端只能各写一份，那就用这条门禁锁住：它必须真是后端列出来的那一档。
 */
function caseInstallSlotIdMatchesTiers() {
  const source = read("ui/src/lib/plugin-sources.ts");
  const match = source.match(/INSTALL_SLOT_ID\s*=\s*"([^"]+)"/);
  assert.ok(match, "ui/src/lib/plugin-sources.ts 要定义 INSTALL_SLOT_ID");
  const ids = truth().map(function (item) { return item.id; });
  assert.ok(
    ids.includes(match[1]),
    "界面认的自带档 id（" + match[1] + "）必须是 pluginPlaces() 真列出来的那一档：后端现在是 " + ids.join("、")
  );
}

/*
 * 功能结构表要把模块登记齐：服务端（`lib/*.js`）与界面件（`ui/src/app/*`）各一格。
 * 漏一个就失败 —— 结构表是「有哪些模块、各归哪个子系统」的唯一一处清单。用例不进表。
 */
function caseModulesInStructureTable() {
  const text = read(STRUCTURE_DOC);
  const at = function (marker) {
    const index = text.indexOf(marker);
    assert.ok(index >= 0, STRUCTURE_DOC + " 里找不到「" + marker + "」");
    return index;
  };
  const table = text.slice(at("## 功能结构"), at("## 约束与门禁"));
  const missing = [];
  for (const dir of ["lib", "ui/src/app"]) {
    for (const entry of fs.readdirSync(path.join(ROOT, ...dir.split("/")), { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(js|cjs|mjs|ts|tsx)$/.test(entry.name) || entry.name.includes(".test.")) continue;
      if (!table.includes(entry.name)) missing.push(dir + "/" + entry.name);
    }
  }
  assert.deepStrictEqual(missing, [], STRUCTURE_DOC + " 的功能结构表没登记这些模块：" + missing.join("、"));
}

// 门禁定义也只有一处：docs/gates.md 的表与这里注册的用例一一对应。
const CASES = [
  ["档位表与代码一一对应", caseTierTableMatchesCode],
  ["字面量只在真值源", caseSingleSource],
  ["判据台账与代码对得上", caseFactsLedger],
  ["复核台账每行都有处置", caseAuditLedger],
  ["引用的文档都存在", caseDocRefsResolve],
  ["一句话只有一处说", caseFactsHaveOneHome],
  ["逐档清单不在别处复述", caseNoTierListCopy],
  ["每份文档都进索引", caseDocsIndexed],
  ["顶层条目都在结构表里", caseRootEntriesRegistered],
  ["每个模块都有职责头", caseModulesHaveHeaderComment],
  ["helper 只一处定义", caseSingleImpl],
  ["插件切换散文与实现一致", casePluginSwitchProse],
  ["界面认的自带档在后端清单里", caseInstallSlotIdMatchesTiers],
  ["功能结构表登记模块", caseModulesInStructureTable],
  ["门禁定义与实际用例一致", caseGateListMatches],
  ["共享模块类型与导出一致", caseSharedTypesMatchExports]
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

/* shared/versions.cjs 的运行时导出，与它那份类型声明 shared/versions.d.cts 的导出名要一一对应。 */
function caseSharedTypesMatchExports() {
  const runtime = Object.keys(require("../shared/versions.cjs")).sort();
  const declared = [...read("shared/versions.d.cts").matchAll(/^export function (\w+)/gm)]
    .map(function (match) { return match[1]; })
    .sort();
  assert.deepStrictEqual(declared, runtime, "shared/versions.d.cts 的导出要与 shared/versions.cjs 一致");
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
