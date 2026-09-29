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
const { merge, threeWayMerge } = require("../lib/merge.js");
const { parallelism, logicalCores } = require("../lib/concurrency.js");

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

// 假的 Layout 注册入口：照着插件 gen-mtslg-layout.js 的 insertNewPage 走 ——
// 插在 </Pages> 前，并且会把闭合标签的缩进去掉（真实实现就是这样）。
function fakeLayout() {
  return {
    register: async function (options) {
      const manifest = JSON.parse(fs.readFileSync(options.manifestPath, "utf8"));
      const file = path.join(options.projectRoot, "Resources", "Layout", "Layout.xml");
      const existing = fs.readFileSync(file, "utf8");
      const page = "  <Page Target=\"" + manifest.pageTarget + "\" LangName=\"" + manifest.pageTarget + "PageTitle\" />";
      const close = existing.indexOf("</Pages>");
      const before = existing.slice(0, close).replace(/\s*$/, "");
      fs.writeFileSync(file, before + "\n" + page + "\n" + existing.slice(close), "utf8");
    }
  };
}

function writeLayoutManifest(dir, target, projectRoot) {
  write(
    path.join(dir, "Generated", "_inputs", target + ".layout-manifest.json"),
    JSON.stringify({ pageTarget: target, layoutPath: "Resources/Layout/Layout.xml", projectRoot: projectRoot }, null, 2)
  );
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mtslg-merge-"));
  const project = path.join(root, "Project");
  write(path.join(project, "Resources", "Layout", "Layout.xml"), LAYOUT_BASE);
  write(path.join(project, "Resources", "Pages", "Home", "HomePage.xml"), "<Page />\n");
  write(path.join(project, "App.csproj"), "<Project>\n  <ItemGroup>\n  </ItemGroup>\n</Project>\n");
  write(path.join(project, "docs", "page-registry.json"), "{}\n");
  // 这些必须被复制过滤掉：版本库元数据、编译产物、旧的 Generated。
  write(path.join(project, ".svn", "entries"), "x\n");
  write(path.join(project, "bin", "old.dll"), "x\n");
  write(path.join(project, "Generated", "_work", "steps", "01-fetch.log"), "旧日志\n");
  return { root: root, project: project, workRoot: path.join(root, "work") };
}

async function caseCopy(fx) {
  await workdir.create({ projectRoot: fx.project, taskId: "t1", workRoot: fx.workRoot });
  const dir = path.join(fx.workRoot, "t1");
  assert.ok(fs.existsSync(path.join(dir, "Resources", "Layout", "Layout.xml")), "工程文件要复制过来");
  assert.ok(!fs.existsSync(path.join(dir, ".svn")), ".svn 不复制");
  assert.ok(!fs.existsSync(path.join(dir, "bin")), "bin 不复制");
  assert.ok(!fs.existsSync(path.join(dir, "Generated")), "Generated 不复制（产物按运行重建）");
  const manifest = await workdir.readManifest("t1", fx.workRoot);
  assert.ok(manifest.files["Resources/Layout/Layout.xml"], "基线清单要有相对路径哈希");
  assert.ok(!manifest.files["Generated/_work/steps/01-fetch.log"], "基线清单不含没复制的文件");
  assert.ok(fs.existsSync(path.join(fx.workRoot, "t1.base", "Resources", "Layout", "Layout.xml")), "项目级文件要留基线内容");
}

async function caseMergeCopiesProductsAndMergesLayout(fx) {
  const dir = path.join(fx.workRoot, "t1");
  // 任务跑到一半：新页面产物 + Layout 增量注册 + 一条会被覆盖名字相同的工作日志。
  write(path.join(dir, "Resources", "Pages", "Detail", "DetailPage.xml"), "<Page Name=\"Detail\" />\n");
  write(path.join(dir, "Generated", "runs", "Detail", "run.json"), "{}\n");
  write(path.join(dir, "Generated", "_work", "steps", "01-fetch.log"), "本次日志\n");
  write(path.join(dir, "Resources", "Layout", "Layout.xml"), insertPage(read(path.join(dir, "Resources", "Layout", "Layout.xml")), "Detail"));
  writeLayoutManifest(dir, "Detail", fx.project);

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
  assert.ok(!layout.includes("<Page Target=\"Home\""), "不该凭空多出别的页面");
  assert.strictEqual(
    read(path.join(fx.project, "Generated", "_work", "steps", "01-fetch.log")),
    "旧日志\n",
    "工作日志不回写，主工程那份原样不动"
  );
}

async function caseMergeTwoPagesKeepsBoth(fx) {
  // 第二个任务的工作目录是从「只注册了 Detail」的主工程复制出来的。
  await workdir.create({ projectRoot: fx.project, taskId: "t2", workRoot: fx.workRoot });
  const dir = path.join(fx.workRoot, "t2");
  write(path.join(dir, "Resources", "Pages", "Report", "ReportPage.xml"), "<Page Name=\"Report\" />\n");
  write(path.join(dir, "Resources", "Layout", "Layout.xml"), insertPage(read(path.join(dir, "Resources", "Layout", "Layout.xml")), "Report"));
  writeLayoutManifest(dir, "Report", fx.project);
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

// 同一页第二次跑：主工程里留着上一次运行的产物（Generated/**），本次运行会重新产出它们 ——
// 运行产物按「本次运行说了算」覆盖，人给的输入（命名表/译文/术语表/约束）两边都动过才停下。
async function caseRerunOverwritesRunProducts(fx) {
  const project = path.join(fx.root, "RerunProject");
  write(path.join(project, "Resources", "Layout", "Layout.xml"), LAYOUT_BASE);
  write(path.join(project, "Generated", "Detail.summary.json"), "{\"上次运行\":true}\n");
  write(path.join(project, "Generated", "runs", "Detail", "run.json"), "{\"上次\":1}\n");

  await workdir.create({ projectRoot: project, taskId: "t6", workRoot: fx.workRoot });
  const dir = path.join(fx.workRoot, "t6");
  write(path.join(dir, "Generated", "Detail.summary.json"), "{\"本次运行\":true}\n");
  write(path.join(dir, "Generated", "runs", "Detail", "run.json"), "{\"本次\":2}\n");
  write(path.join(dir, "Resources", "Pages", "Detail", "DetailPage.xml"), "<Page Name=\"Detail\" />\n");
  writeLayoutManifest(dir, "Detail", project);

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
    report.notes.some((note) => note.includes("本次运行的产物，覆盖主工程上一次的")),
    "覆盖要留一条说明"
  );
}

// GUI 的运行不消费工程里那份 Generated/_inputs（建工作目录时整层不复制），它只是上一次运行的记录。
// 所以本次运行重新填的命名表/译文照样按「本次运行说了算」刷新，并留一条说明；
// 冲突只留给真正的源码文件（Resources/**、UI/**）。
async function caseRunInputRecordRefreshed(fx) {
  const project = path.join(fx.root, "HumanInputProject");
  write(path.join(project, "Resources", "Layout", "Layout.xml"), LAYOUT_BASE);
  write(path.join(project, "Generated", "_inputs", "Detail.lang-translations.json"), "{\"停止调整\":\"人改的\"}\n");

  await workdir.create({ projectRoot: project, taskId: "t7", workRoot: fx.workRoot });
  const dir = path.join(fx.workRoot, "t7");
  write(path.join(dir, "Generated", "_inputs", "Detail.lang-translations.json"), "{\"停止调整\":\"本次跑的\"}\n");
  write(path.join(dir, "Resources", "Pages", "Detail", "DetailPage.xml"), "<Page Name=\"Detail\" />\n");
  writeLayoutManifest(dir, "Detail", project);

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
    ["真冲突时不写半份", caseConflictWritesNothing],
    ["同一页第二次跑：运行产物由本次运行覆盖", caseRerunOverwritesRunProducts],
    ["工程里的输入记录由本次运行刷新", caseRunInputRecordRefreshed],
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
