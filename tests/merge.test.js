#!/usr/bin/env node
"use strict";

// 工作目录与合并的机械验证：造一棵假工程，走一遍「复制 → 改产物 → 合并」，
// 包括必须自动合上的情况、必须报冲突的情况、以及合并从不写半份的保证。
// 跑法：node tests/merge.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const workdir = require("../lib/workdir.js");
const { merge, threeWayMerge, classifyFile } = require("../lib/merge.js");
const { parallelism, logicalCores } = require("../lib/concurrency.js");
const { resolveManifest } = require("../lib/plugin-layout.js");

const LAYOUT_BASE = [
  "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
  "<Layout WindowHeight=\"1080\">",
  "  <Header Title=\"x\">",
  "  </Header>",
  "  <Body>",
  "    <Pages>",
  "    </Pages>",
  "    <LeftToolBox />",
  "    <ToolBox />",
  "  </Body>",
  "  <Footer />",
  "</Layout>",
  ""
].join("\n");

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function insertPage(text, target) {
  const page = "      <Page Target=\"" + target + "\" LangName=\"" + target + "PageTitle\" />";
  return text.replace(/(\s*)<\/Pages>/, "$1" + page + "\n$1</Pages>");
}

// 假的 Layout 注册入口：清单解析用真实现（这层契约必须被验到），落盘照插件
// gen-mtslg-layout.js 的 insertNewPage 走 —— 插在 </Pages> 前，并把闭合标签的缩进去掉。
// 菜单项的 LangName 只可能来自解析出来的清单，写空串就说明清单取错了来源。
function fakeLayout() {
  return {
    resolveManifest: resolveManifest,
    register: async function (options) {
      const manifest = options.manifest;
      const file = path.join(options.projectRoot, "Resources", "Layout", "Layout.xml");
      const existing = fs.readFileSync(file, "utf8");
      const items = manifest.menuItems.map(function (item) {
        return "      <MenuItem Name=\"" + item.name + "\" Index=\"" + item.index +
          "\" LangName=\"" + (item.langName || "") + "\" />";
      }).join("\n");
      const page = "  <Page Target=\"" + manifest.pageTarget + "\" LangName=\"" + manifest.pageLangName + "\">\n" +
        "    <Menu>\n" + items + "\n    </Menu>\n  </Page>";
      const close = existing.indexOf("</Pages>");
      const before = existing.slice(0, close).replace(/\s*$/, "");
      fs.writeFileSync(file, before + "\n" + page + "\n" + existing.slice(close), "utf8");
    }
  };
}

// 本页产出：Layout.xml 里已注册这一页（带 LangName），Bundle 审计里存着插件实际用的已解析清单。
function writeBundleAudit(dir, target, menuItems) {
  write(
    path.join(dir, "Generated", target + ".bundle.manifest.json"),
    JSON.stringify({
      inputs: {
        pageTarget: target,
        pageLangName: target + "PageTitle",
        layoutStatus: "complete",
        layoutEvidence: { matchedBottomBarItems: 1, unresolvedBottomBarItems: 0, residentGroupItems: 0 },
        menuItems: menuItems || [{ name: "按钮", index: 1, langName: target + "Button" }]
      }
    }, null, 2)
  );
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mtslg-merge-"));
  const project = path.join(root, "Project");
  write(path.join(project, "Resources", "Layout", "Layout.xml"), LAYOUT_BASE);
  write(path.join(project, "Resources", "Pages", "Home", "HomePage.xml"), "<Page />\n");
  write(path.join(project, "App.csproj"), "<Project>\n  <ItemGroup>\n  </ItemGroup>\n</Project>\n");
  write(path.join(project, "docs", "page-registry.json"), "{}\n");
  // 版本库元数据与编译产物必须被过滤掉；Generated 要原样复制 —— 里面的 _inputs 是本次运行的输入。
  write(path.join(project, ".svn", "entries"), "x\n");
  write(path.join(project, "bin", "old.dll"), "x\n");
  write(path.join(project, "Generated", "_inputs", "T1.icon-naming.json"), "[{\"index\":9,\"name\":\"UpArrowGeometry\"}]\n");
  write(path.join(project, "Generated", "_work", "steps", "01-fetch.log"), "旧日志\n");
  return { root: root, project: project, workRoot: path.join(root, "work") };
}

async function caseCopy(fx) {
  await workdir.create({ projectRoot: fx.project, taskId: "t1", workRoot: fx.workRoot });
  const dir = path.join(fx.workRoot, "t1");
  assert.ok(fs.existsSync(path.join(dir, "Resources", "Layout", "Layout.xml")), "工程文件要复制过来");
  assert.ok(!fs.existsSync(path.join(dir, ".svn")), ".svn 不复制");
  assert.ok(!fs.existsSync(path.join(dir, "bin")), "bin 不复制");
  assert.ok(
    fs.existsSync(path.join(dir, "Generated", "_inputs", "T1.icon-naming.json")),
    "命名表要复制过来：插件靠它跳过「待命名」，否则会重猜键名、覆盖已确认的产物"
  );
  const manifest = await workdir.readManifest("t1", fx.workRoot);
  assert.ok(manifest.files["Resources/Layout/Layout.xml"], "基线清单要有相对路径哈希");
  assert.ok(manifest.files["Generated/_inputs/T1.icon-naming.json"], "基线清单要含复制过来的输入");
  assert.ok(fs.existsSync(path.join(fx.workRoot, "t1.base", "Resources", "Layout", "Layout.xml")), "项目级文件要留基线内容");
}

async function caseMergeCopiesProductsAndMergesLayout(fx) {
  const dir = path.join(fx.workRoot, "t1");
  // 任务跑到一半：新页面产物 + Layout 增量注册 + 一条会被覆盖名字相同的工作日志。
  write(path.join(dir, "Resources", "Pages", "Detail", "DetailPage.xml"), "<Page Name=\"Detail\" />\n");
  write(path.join(dir, "Generated", "runs", "Detail", "run.json"), "{}\n");
  write(path.join(dir, "Generated", "_work", "steps", "01-fetch.log"), "本次日志\n");
  write(path.join(dir, "Resources", "Layout", "Layout.xml"), insertPage(read(path.join(dir, "Resources", "Layout", "Layout.xml")), "Detail"));
  writeBundleAudit(dir, "Detail");

  const manifest = await workdir.readManifest("t1", fx.workRoot);
  const report = await merge({
    projectRoot: fx.project,
    workDir: dir,
    baseDir: path.join(fx.workRoot, "t1.base"),
    manifest: manifest,
    target: "Detail",
    layout: fakeLayout()
  });

  assert.deepStrictEqual(report.conflicts, [], "没有冲突");
  assert.ok(report.applied.includes("Resources/Pages/Detail/DetailPage.xml"), "新页面要合并过去");
  assert.ok(report.applied.includes("Generated/runs/Detail/run.json"), "运行产物要合并过去");
  assert.ok(!report.applied.includes("Generated/_work/steps/01-fetch.log"), "工作日志不回写");
  const layout = read(path.join(fx.project, "Resources", "Layout", "Layout.xml"));
  assert.ok(layout.includes("Target=\"Detail\""), "Layout 增量注册要合进主工程");
  assert.ok(
    layout.includes("LangName=\"DetailButton\""),
    "MenuItem 的 LangName 要取自 Bundle 审计里那份已解析清单，不能写成空串"
  );
  assert.ok(!layout.includes("<Page Target=\"Home\""), "不该凭空多出别的页面");
  assert.strictEqual(
    read(path.join(fx.project, "Generated", "_work", "steps", "01-fetch.log")),
    "旧日志\n",
    "工作日志不回写，主工程那份原样不动"
  );
}

// 插件每次开跑都会把上一轮遗留的运行工作文件清掉（上一页的草稿、验证日志）。主工程里那几份也要跟着清，
// 否则每换一个页面跑，主工程 Generated/_work 里就多留一份别人的临时账。
async function caseScratchAppliesRemoval(fx) {
  const project = path.join(fx.root, "ScratchProject");
  write(path.join(project, "Resources", "Layout", "Layout.xml"), LAYOUT_BASE);
  write(path.join(project, "Generated", "_work", "F1.mapping.draft.json"), "{}\n");
  write(path.join(project, "Generated", "_work", "verification", "F1", "1-provenance.log"), "上一页的验证日志\n");

  await workdir.create({ projectRoot: project, taskId: "t9", workRoot: fx.workRoot });
  const dir = path.join(fx.workRoot, "t9");
  fs.rmSync(path.join(dir, "Generated", "_work", "F1.mapping.draft.json"));
  fs.rmSync(path.join(dir, "Generated", "_work", "verification", "F1", "1-provenance.log"));
  write(path.join(dir, "Resources", "Pages", "Detail", "DetailPage.xml"), "<Page Name=\"Detail\" />\n");
  writeBundleAudit(dir, "Detail");

  const manifest = await workdir.readManifest("t9", fx.workRoot);
  const report = await merge({
    projectRoot: project,
    workDir: dir,
    baseDir: path.join(fx.workRoot, "t9.base"),
    manifest: manifest,
    target: "Detail",
    layout: fakeLayout()
  });

  assert.deepStrictEqual(report.conflicts, [], "清临时账不该拦合并");
  assert.ok(report.applied.includes("Generated/_work/F1.mapping.draft.json"), "运行工作文件按本任务清掉");
  assert.ok(!fs.existsSync(path.join(project, "Generated", "_work", "F1.mapping.draft.json")), "主工程里那份草稿一起清掉");
  assert.ok(!fs.existsSync(path.join(project, "Generated", "_work", "verification", "F1")), "空掉的目录一并收掉");
  assert.ok(fs.existsSync(path.join(project, "Resources", "Pages", "Detail", "DetailPage.xml")), "同一次合并里的产物照样落盘");
}

// 主工程里那份临时账被人在任务跑完之后改过：不敢替人删，留着并说明。
async function caseScratchRemovalSkipsHumanEdited(fx) {
  const project = path.join(fx.root, "ScratchEditedProject");
  write(path.join(project, "Resources", "Layout", "Layout.xml"), LAYOUT_BASE);
  write(path.join(project, "Generated", "_work", "F1.mapping.draft.json"), "{}\n");

  await workdir.create({ projectRoot: project, taskId: "t10", workRoot: fx.workRoot });
  const dir = path.join(fx.workRoot, "t10");
  fs.rmSync(path.join(dir, "Generated", "_work", "F1.mapping.draft.json"));
  write(path.join(project, "Generated", "_work", "F1.mapping.draft.json"), "{\"人改过\":true}\n");

  const manifest = await workdir.readManifest("t10", fx.workRoot);
  const report = await merge({
    projectRoot: project,
    workDir: dir,
    baseDir: path.join(fx.workRoot, "t10.base"),
    manifest: manifest,
    target: "",
    layout: fakeLayout()
  });

  assert.deepStrictEqual(report.conflicts, [], "临时账不参与冲突");
  assert.strictEqual(read(path.join(project, "Generated", "_work", "F1.mapping.draft.json")), "{\"人改过\":true}\n");
  assert.ok(!report.applied.includes("Generated/_work/F1.mapping.draft.json"), "被人改过就不动它");
}

async function caseMergeTwoPagesKeepsBoth(fx) {
  // 第二个任务的工作目录是从「只注册了 Detail」的主工程复制出来的。
  await workdir.create({ projectRoot: fx.project, taskId: "t2", workRoot: fx.workRoot });
  const dir = path.join(fx.workRoot, "t2");
  write(path.join(dir, "Resources", "Pages", "Report", "ReportPage.xml"), "<Page Name=\"Report\" />\n");
  write(path.join(dir, "Resources", "Layout", "Layout.xml"), insertPage(read(path.join(dir, "Resources", "Layout", "Layout.xml")), "Report"));
  writeBundleAudit(dir, "Report");
  // 同时主工程在别处又被加了一页（模拟人工改动或另一次合并）。
  write(path.join(fx.project, "Resources", "Layout", "Layout.xml"), insertPage(read(path.join(fx.project, "Resources", "Layout", "Layout.xml")), "Manual"));

  const manifest = await workdir.readManifest("t2", fx.workRoot);
  const report = await merge({
    projectRoot: fx.project,
    workDir: dir,
    baseDir: path.join(fx.workRoot, "t2.base"),
    manifest: manifest,
    target: "Report",
    layout: fakeLayout()
  });

  assert.deepStrictEqual(report.conflicts, [], "Layout 由插件重新注册，不应报冲突");
  const layout = read(path.join(fx.project, "Resources", "Layout", "Layout.xml"));
  for (const target of ["Detail", "Manual", "Report"]) {
    assert.ok(layout.includes("Target=\"" + target + "\""), "Layout 里应当同时有 " + target);
  }
}

async function caseLayoutNeedsRegistrar(fx) {
  await workdir.create({ projectRoot: fx.project, taskId: "t4", workRoot: fx.workRoot });
  const dir = path.join(fx.workRoot, "t4");
  write(path.join(dir, "Resources", "Pages", "Solo", "SoloPage.xml"), "<Page Name=\"Solo\" />\n");
  write(path.join(dir, "Resources", "Layout", "Layout.xml"), insertPage(read(path.join(dir, "Resources", "Layout", "Layout.xml")), "Solo"));

  const manifest = await workdir.readManifest("t4", fx.workRoot);
  const report = await merge({
    projectRoot: fx.project,
    workDir: dir,
    baseDir: path.join(fx.workRoot, "t4.base"),
    manifest: manifest,
    target: "Solo"
  });

  assert.ok(report.conflicts.length > 0, "没有注册入口时必须报冲突，不能默默把整份 Layout 覆盖过去");
  assert.deepStrictEqual(report.applied, [], "冲突时一个字节都不写");
}

// 有注册入口、但本页没有 Bundle 审计：拿不到含语言绑定的清单，只能停下并说清原因。
// 悄悄退回第 8 步那份清单会把 MenuItem 的 LangName 写成空串 —— 产物与插件单独跑不一致。
async function caseLayoutRegistrationNeedsBundleAudit(fx) {
  const project = path.join(fx.root, "NoAuditProject");
  write(path.join(project, "Resources", "Layout", "Layout.xml"), LAYOUT_BASE);

  await workdir.create({ projectRoot: project, taskId: "t11", workRoot: fx.workRoot });
  const dir = path.join(fx.workRoot, "t11");
  write(path.join(dir, "Resources", "Layout", "Layout.xml"), insertPage(read(path.join(dir, "Resources", "Layout", "Layout.xml")), "Solo"));
  write(path.join(dir, "Generated", "_inputs", "Solo.layout-manifest.json"), "{}\n");

  const manifest = await workdir.readManifest("t11", fx.workRoot);
  const report = await merge({
    projectRoot: project,
    workDir: dir,
    baseDir: path.join(fx.workRoot, "t11.base"),
    manifest: manifest,
    target: "Solo",
    layout: fakeLayout()
  });

  assert.deepStrictEqual(report.applied, [], "拿不到清单就一个字节都不写");
  assert.strictEqual(report.conflicts.length, 1, "要停下并说明原因");
  assert.match(report.conflicts[0].reason, /Bundle 审计/, "理由要指向缺失的 Bundle 审计");
  assert.ok(!read(path.join(project, "Resources", "Layout", "Layout.xml")).includes("Solo"), "主工程那份不动");
}

async function caseConflictWritesNothing(fx) {
  await workdir.create({ projectRoot: fx.project, taskId: "t3", workRoot: fx.workRoot });
  const dir = path.join(fx.workRoot, "t3");
  write(path.join(dir, "Resources", "Pages", "New", "NewPage.xml"), "<Page Name=\"New\" />\n");
  // 同一条已有行被两边改成不同内容：自动合并必须拒绝，交给人。
  const csproj = read(path.join(dir, "App.csproj"));
  write(path.join(dir, "App.csproj"), csproj.replace("<ItemGroup>", "<ItemGroup Label=\"task\" />"));
  write(path.join(fx.project, "App.csproj"), csproj.replace("<ItemGroup>", "<ItemGroup Label=\"human\" />"));

  const manifest = await workdir.readManifest("t3", fx.workRoot);
  const report = await merge({
    projectRoot: fx.project,
    workDir: dir,
    baseDir: path.join(fx.workRoot, "t3.base"),
    manifest: manifest,
    target: "New"
  });

  assert.ok(report.conflicts.length > 0, "应当报冲突");
  assert.deepStrictEqual(report.applied, [], "有冲突时一个字节都不写");
  assert.ok(!fs.existsSync(path.join(fx.project, "Resources", "Pages", "New", "NewPage.xml")), "冲突时旁路文件也不能落盘");
}

function caseThreeWayDisjoint() {
  const base = ["a", "b", "c", "d", "e", ""].join("\n");
  const ours = ["a", "X", "b", "c", "d", "e", ""].join("\n");
  const theirs = ["a", "b", "c", "Y", "d", "e", ""].join("\n");
  const result = threeWayMerge(base, ours, theirs);
  assert.ok(result.ok, "不重叠的改动应当自动合上");
  assert.strictEqual(result.content, ["a", "X", "b", "c", "Y", "d", "e", ""].join("\n"));
  assert.ok(!threeWayMerge(base, ["a", "P", "b", "c", "d", "e", ""].join("\n"), ["a", "Q", "b", "c", "d", "e", ""].join("\n")).ok, "同一处各改各的要报冲突");
}

// 同一页第二次跑：主工程里那份 Generated/**（上一次运行的产物）先照原样复制进工作目录，
// 本次运行重新产出它们 —— 主工程那份没人动过就直接快进写回，被人动过也照样覆盖，但留一条说明。
// 冲突只留给源码文件（Resources/**、UI/**；Layout.xml 与 csproj 走行级三方合并）。
async function caseRerunOverwritesRunProducts(fx) {
  const project = path.join(fx.root, "RerunProject");
  write(path.join(project, "Resources", "Layout", "Layout.xml"), LAYOUT_BASE);
  write(path.join(project, "Generated", "Detail.summary.json"), "{\"上次运行\":true}\n");
  write(path.join(project, "Generated", "runs", "Detail", "run.json"), "{\"上次\":1}\n");

  await workdir.create({ projectRoot: project, taskId: "t6", workRoot: fx.workRoot });
  const dir = path.join(fx.workRoot, "t6");
  assert.strictEqual(
    read(path.join(dir, "Generated", "Detail.summary.json")),
    "{\"上次运行\":true}\n",
    "上一次运行的产物要照原样复制：插件直跑时看到的就是这份"
  );
  // 开工之后主工程那份又被别的运行改过：只有这种情况才需要说明。
  write(path.join(project, "Generated", "runs", "Detail", "run.json"), "{\"上次\":1,\"别人动过\":true}\n");
  write(path.join(dir, "Generated", "Detail.summary.json"), "{\"本次运行\":true}\n");
  write(path.join(dir, "Generated", "runs", "Detail", "run.json"), "{\"本次\":2}\n");
  write(path.join(dir, "Resources", "Pages", "Detail", "DetailPage.xml"), "<Page Name=\"Detail\" />\n");
  writeBundleAudit(dir, "Detail");

  const manifest = await workdir.readManifest("t6", fx.workRoot);
  const report = await merge({
    projectRoot: project,
    workDir: dir,
    baseDir: path.join(fx.workRoot, "t6.base"),
    manifest: manifest,
    target: "Detail",
    layout: fakeLayout()
  });

  assert.deepStrictEqual(report.conflicts, [], "运行产物不该拦合并（同一页第二次跑必须能合上）");
  assert.ok(report.applied.includes("Generated/Detail.summary.json"), "本次运行的产物要覆盖主工程那一份");
  assert.strictEqual(read(path.join(project, "Generated", "Detail.summary.json")), "{\"本次运行\":true}\n");
  assert.strictEqual(read(path.join(project, "Generated", "runs", "Detail", "run.json")), "{\"本次\":2}\n");
  assert.ok(
    report.notes.some((note) => note.startsWith("Generated/runs/Detail/run.json") && note.includes("本次运行的产物，覆盖主工程上一次的")),
    "覆盖要留一条说明"
  );
}

// 命名表/译文是本次运行的输入，也是上一次运行的记录：建工作目录时照原样复制，本次运行重新填过就刷新回去；
// 冲突只留给真正的源码文件（Resources/**、UI/**）。
async function caseRunInputRecordRefreshed(fx) {
  const project = path.join(fx.root, "HumanInputProject");
  write(path.join(project, "Resources", "Layout", "Layout.xml"), LAYOUT_BASE);
  write(path.join(project, "Generated", "_inputs", "Detail.lang-translations.json"), "{\"停止调整\":\"人改的\"}\n");

  await workdir.create({ projectRoot: project, taskId: "t7", workRoot: fx.workRoot });
  const dir = path.join(fx.workRoot, "t7");
  write(path.join(dir, "Generated", "_inputs", "Detail.lang-translations.json"), "{\"停止调整\":\"本次跑的\"}\n");
  write(path.join(dir, "Resources", "Pages", "Detail", "DetailPage.xml"), "<Page Name=\"Detail\" />\n");
  writeBundleAudit(dir, "Detail");

  const manifest = await workdir.readManifest("t7", fx.workRoot);
  const report = await merge({
    projectRoot: project,
    workDir: dir,
    baseDir: path.join(fx.workRoot, "t7.base"),
    manifest: manifest,
    target: "Detail",
    layout: fakeLayout()
  });

  assert.deepStrictEqual(report.conflicts, [], "输入记录不该拦合并");
  assert.ok(
    report.applied.includes("Generated/_inputs/Detail.lang-translations.json"),
    "本次运行填的译文记录要刷新到工程里"
  );
  assert.strictEqual(
    read(path.join(project, "Generated", "_inputs", "Detail.lang-translations.json")),
    "{\"停止调整\":\"本次跑的\"}\n",
    "工程里那份是上一次运行的记录，由本次运行刷新"
  );
}

// 冲突处的人工裁决：同一个文件再合一次，按选择落地。
// 选「保留主工程」一个字节都不动；选「以本任务为准」落本任务的版本并留一条说明。
async function caseResolutionsUnblockConflict(fx) {
  const project = path.join(fx.root, "ResolveProject");
  const rel = "Resources/Pages/Detail/DetailPage.xml";
  write(path.join(project, "Resources", "Layout", "Layout.xml"), LAYOUT_BASE);
  write(path.join(project, rel), "<Page Name=\"v0\" />\n");

  await workdir.create({ projectRoot: project, taskId: "t8", workRoot: fx.workRoot });
  const dir = path.join(fx.workRoot, "t8");
  // 本任务改了这页，主工程在任务开工之后也改了同一行 —— 三态判不了，必须报冲突。
  write(path.join(dir, rel), "<Page Name=\"task\" />\n");
  write(path.join(project, rel), "<Page Name=\"human\" />\n");

  const manifest = await workdir.readManifest("t8", fx.workRoot);
  const options = {
    projectRoot: project,
    workDir: dir,
    baseDir: path.join(fx.workRoot, "t8.base"),
    manifest: manifest,
    target: "Detail"
  };

  const blocked = await merge(options);
  assert.deepStrictEqual(blocked.applied, [], "没裁决前一个字节都不写");
  assert.strictEqual(blocked.conflicts.length, 1, "这一处要报冲突");
  assert.strictEqual(blocked.conflicts[0].path, rel);
  assert.strictEqual(blocked.conflicts[0].resolvable, true, "内容归属类冲突由人裁决");

  const kept = await merge(Object.assign({}, options, { resolutions: { [rel]: "main" } }));
  assert.deepStrictEqual(kept.conflicts, [], "选保留主工程后不再报冲突");
  assert.deepStrictEqual(kept.applied, [], "保留主工程就是不写这个文件");
  assert.strictEqual(read(path.join(project, rel)), "<Page Name=\"human\" />\n", "主工程那份原样不动");

  const taken = await merge(Object.assign({}, options, { resolutions: { [rel]: "mine" } }));
  assert.deepStrictEqual(taken.conflicts, []);
  assert.ok(taken.applied.includes(rel), "按人的选择以本任务产出为准");
  assert.strictEqual(read(path.join(project, rel)), "<Page Name=\"task\" />\n");
  assert.ok(
    taken.notes.some((note) => note.includes("按人工选择以本任务产出为准")),
    "裁决要留一条说明"
  );
}

// 人的选择本身不成立时不能放行：项目级文件取本任务那份、但那份结构就不合格，
// 依旧按冲突拦下，并且标成不可裁决 —— 这种只能回去修产物。
async function caseUnresolvableConflictStaysBlocked(fx) {
  const project = path.join(fx.root, "BrokenProject");
  const rel = "App.csproj";
  const base = "<Project>\n  <ItemGroup>\n  </ItemGroup>\n</Project>\n";
  write(path.join(project, "Resources", "Layout", "Layout.xml"), LAYOUT_BASE);
  write(path.join(project, rel), base);

  await workdir.create({ projectRoot: project, taskId: "t9", workRoot: fx.workRoot });
  const dir = path.join(fx.workRoot, "t9");
  // 本任务那份 csproj 结构是坏的（缺 Project 闭标签），而且改在主工程也改的那一行上。
  write(path.join(dir, rel), "<Project Label=\"task\">\n");
  write(path.join(project, rel), base.replace("<Project>", "<Project Label=\"human\">"));

  const manifest = await workdir.readManifest("t9", fx.workRoot);
  const options = {
    projectRoot: project,
    workDir: dir,
    baseDir: path.join(fx.workRoot, "t9.base"),
    manifest: manifest,
    target: "Detail"
  };

  const blocked = await merge(options);
  assert.strictEqual(blocked.conflicts.length, 1, "结构不合格也要报冲突");
  assert.strictEqual(blocked.conflicts[0].resolvable, true, "还没选之前这一处是人可以裁决的");
  assert.deepStrictEqual(blocked.applied, [], "一个字节都不写");

  const forced = await merge(Object.assign({}, options, { resolutions: { [rel]: "mine" } }));
  assert.deepStrictEqual(forced.applied, [], "选了也不放行");
  assert.strictEqual(forced.conflicts[0].resolvable, false, "本任务那份结构不合格，不能由人拍板");
  assert.ok(forced.conflicts[0].reason.includes("csproj"), "理由要说清是这份产物不合格");
  assert.strictEqual(read(path.join(project, rel)), base.replace("<Project>", "<Project Label=\"human\">"));
}

// 逐文件分流的判定表：纯函数，逐条钉死「哪条规则先命中」。
function caseClassifyDecisionTable() {
  const base = {
    rel: "Resources/Pages/Detail/DetailPage.xml",
    mainExists: true,
    mainHash: "B",
    baseHash: "A",
    mineHash: "C",
    isScratch: false,
    isBackup: false,
    isRunProduct: false,
    isProjectLevel: false
  };
  const decision = (patch) => classifyFile(Object.assign({}, base, patch));

  assert.strictEqual(decision({ isScratch: true }).action, "skip", "工作文件先出局");
  assert.strictEqual(decision({ isBackup: true }).action, "skip", "覆盖备份不回写");
  assert.strictEqual(decision({ mainHash: "C" }).action, "skip", "两边一致跳过");
  assert.strictEqual(decision({ mainHash: "A" }).action, "write", "主工程没动过快进");
  assert.strictEqual(decision({ mainHash: "A" }).seen, "A", "快进要记下写入前的哈希");
  assert.strictEqual(decision({ isRunProduct: true }).action, "write", "运行产物本次运行说了算");
  assert.match(decision({ isRunProduct: true }).note, /覆盖主工程上一次的/);
  assert.strictEqual(decision({ isProjectLevel: true }).action, "mergeLines", "项目级共享文件走行级三方合并");
  assert.strictEqual(decision({}).action, "conflict", "其余是真冲突");
  assert.strictEqual(decision({ mainExists: false, baseHash: null }).action, "write", "新文件直接写");
  assert.strictEqual(decision({ mainExists: false, baseHash: "A" }).action, "conflict", "主工程删过的文件不重建");
  assert.strictEqual(
    decision({ isRunProduct: true, isProjectLevel: true }).action,
    "write",
    "运行产物先于项目级判定：Generated/** 不会被当成需要三方合并的共享文件"
  );
}

function caseConcurrency() {
  const logical = logicalCores();
  const limit = parallelism(logical);
  assert.ok(limit >= 1 && limit <= 4, "并发上限要夹在 1..4");
  console.log("    逻辑核 " + logical + " → 并发上限 " + limit);
}

async function main() {
  const fx = fixture();
  const cases = [
    ["复制过滤与基线清单", caseCopy],
    ["合并产物并增量注册 Layout", caseMergeCopiesProductsAndMergesLayout],
    ["两个任务各加一页，Layout 重新注册后两页都在", caseMergeTwoPagesKeepsBoth],
    ["没有注册入口时 Layout 不允许整份覆盖", caseLayoutNeedsRegistrar],
    ["拿不到本页 Bundle 审计时 Layout 重注册必须停下", caseLayoutRegistrationNeedsBundleAudit],
    ["真冲突时不写半份", caseConflictWritesNothing],
    ["同一页第二次跑：运行产物由本次运行覆盖", caseRerunOverwritesRunProducts],
    ["工程里的输入记录由本次运行刷新", caseRunInputRecordRefreshed],
    ["运行工作文件按本任务清掉（含空目录）", caseScratchAppliesRemoval],
    ["被人改过的运行工作文件不替人删", caseScratchRemovalSkipsHumanEdited],
    ["冲突由人裁决后按选择落地", caseResolutionsUnblockConflict],
    ["产物不合格的冲突不能由人放行", caseUnresolvableConflictStaysBlocked],
    ["逐文件分流判定表", function () { caseClassifyDecisionTable(); }],
    ["行级三方合并", function () { caseThreeWayDisjoint(); }],
    ["并发上限", function () { caseConcurrency(); }]
  ];
  try {
    for (const [name, run] of cases) {
      await run(fx);
      console.log("  ok  " + name);
    }
    console.log("merge.test.js 全部通过");
  }
  finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
