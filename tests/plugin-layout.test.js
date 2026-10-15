#!/usr/bin/env node
"use strict";

// plugin-layout 的机械验证：造一棵假插件（路线描述符 + 假 Layout 脚本 + 假写法表），
// 走一遍「解析本页清单 → 起子进程重新注册」，验子进程怎么起、清单是不是插件那份、
// 临时清单清没清，以及每一类失败报在哪一句。
// 跑法：node tests/plugin-layout.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createLayoutRegistrar, resolveManifest, SKILL_REL } = require("../lib/plugin-layout.js");
const workdir = require("../lib/workdir.js");

const ADAPTER_DIR = "references/adapters/mtslg-iocontrol";
const LAYOUT_SCRIPT = "adapters/mtslg-iocontrol/gen-mtslg-layout.js";

// 假 Layout 脚本：把收到的参数与清单原样记到工作目录的 .layout-call.json。
const FAKE_SCRIPT = [
  "\"use strict\";",
  "const fs = require(\"fs\");",
  "const path = require(\"path\");",
  "const argv = process.argv.slice(2);",
  "const call = { cwd: process.cwd(), overwrite: false, manifest: \"\", map: \"\" };",
  "for (let i = 0; i < argv.length; i += 1) {",
  "  if (argv[i] === \"--overwrite\") call.overwrite = true;",
  "  else if (argv[i] === \"--manifest\") { call.manifest = argv[i + 1]; i += 1; }",
  "  else if (argv[i] === \"--map\") { call.map = argv[i + 1]; i += 1; }",
  "}",
  "call.manifestBody = JSON.parse(fs.readFileSync(call.manifest, \"utf8\"));",
  "fs.writeFileSync(path.join(process.cwd(), \".layout-call.json\"), JSON.stringify(call, null, 2));",
  ""
].join("\n");

const FAILING_SCRIPT = [
  "\"use strict\";",
  // 尾行带终端色码：进到界面的失败原因里之前必须剥掉。
  "process.stderr.write(\"第一行\\n门禁没通过：缺少 LangName\\n\\u001b[31;1m拒绝写入：硬编码路径\\u001b[0m\\n\");",
  "process.exit(3);",
  ""
].join("\n");

// 输出很长、报错写在末尾：这一处读的是尾巴，从头截会把真正那句整段丢掉。
const LONG_FAILING_SCRIPT = [
  "\"use strict\";",
  "process.stderr.write(\"填表过程\\n\".repeat(2000));",
  "process.stderr.write(\"门禁没通过：末尾这句才是原因\\n\");",
  "process.exit(4);",
  ""
].join("\n");
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function temp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// 假插件根：只放 GUI 真正读的那几样 —— 路线描述符、写法表、Layout 脚本。
function fakePlugin(options) {
  const settings = options || {};
  const root = temp("mtslg-plugin-");
  const skill = path.join(root, SKILL_REL);
  const descriptor = settings.descriptor === undefined
    ? { scripts: { layout: LAYOUT_SCRIPT }, templateMap: ADAPTER_DIR + "/templates.json" }
    : settings.descriptor;
  write(path.join(skill, ADAPTER_DIR, "adapter.json"), JSON.stringify(descriptor, null, 2));
  write(path.join(skill, ADAPTER_DIR, "templates.json"), "{}\n");
  if (settings.script !== false) {
    // 脚本相对描述符所在目录解析：<skill>/scripts/<scripts.layout>，与插件自己的布局一致。
    write(path.join(skill, "scripts", settings.scriptPath || LAYOUT_SCRIPT), settings.script || FAKE_SCRIPT);
  }
  return root;
}

// 本页 Bundle 审计：inputs 就是插件第 10 步喂给 gen-mtslg-layout.js 的已解析清单。
function writeBundleAudit(dir, target, overrides) {
  const inputs = Object.assign({
    pageTarget: target,
    pageLangName: target + "PageTitle",
    mappingTag: "MTSLG",
    layoutStatus: "complete",
    layoutEvidence: { matchedBottomBarItems: 2, unresolvedBottomBarItems: 0, residentGroupItems: 0 },
    menuItems: [{ name: "对焦", index: 8, langName: "MenuItemFocus" }]
  }, overrides || {});
  write(path.join(dir, "Generated", target + ".bundle.manifest.json"), JSON.stringify({ inputs: inputs }, null, 2));
}

function withFixture(run) {
  const pluginRoot = fakePlugin(run.plugin);
  const project = temp("mtslg-project-");
  try {
    run.body({ pluginRoot: pluginRoot, project: project });
  }
  finally {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
}

function caseRegisterRunsPluginScript() {
  withFixture({ body: function (fx) {
    writeBundleAudit(fx.project, "Detail");
    const layout = createLayoutRegistrar({ pluginRoot: fx.pluginRoot });
    layout.register({
      projectRoot: fx.project,
      manifest: resolveManifest({ workDir: fx.project, target: "Detail" }),
      mode: "mtslg-iocontrol"
    });

    const call = JSON.parse(read(path.join(fx.project, ".layout-call.json")));
    assert.strictEqual(call.cwd, fx.project, "子进程工作目录必须是工程根");
    assert.strictEqual(call.overwrite, true, "重新注册必须是替换，不是重复注册");
    assert.ok(call.map.endsWith(path.join("adapters", "mtslg-iocontrol", "templates.json")), "写法表要按描述符解析：" + call.map);
    assert.strictEqual(call.manifestBody.pageTarget, "Detail", "清单取本页 Bundle 审计里的已解析清单");
    assert.strictEqual(call.manifestBody.layoutPath, workdir.LAYOUT_REL, "清单里的 Layout 路径是主工程相对路径");
    assert.strictEqual(call.manifestBody.menuItems[0].langName, "MenuItemFocus", "菜单项要带语言绑定产出的 LangName");
    assert.ok(!fs.existsSync(path.dirname(call.manifest)), "临时清单目录要清掉");
  } });
}

function caseRegisterDefaultsModeAndSkipsMapWithoutTemplateMap() {
  withFixture({
    plugin: { descriptor: { scripts: { layout: LAYOUT_SCRIPT } } },
    body: function (fx) {
      writeBundleAudit(fx.project, "Detail");
      const layout = createLayoutRegistrar({ pluginRoot: fx.pluginRoot });
      // 不传 mode：缺省就是 mtslg-iocontrol；描述符没有 templateMap 时不带 --map。
      layout.register({ projectRoot: fx.project, manifest: resolveManifest({ workDir: fx.project, target: "Detail" }) });
      const call = JSON.parse(read(path.join(fx.project, ".layout-call.json")));
      assert.strictEqual(call.map, "", "描述符没登记写法表就不带 --map：" + call.map);
      assert.strictEqual(call.manifestBody.pageTarget, "Detail", "缺省路线要能解析出来");
    }
  });
}

function caseRegisterReportsPluginFailure() {
  withFixture({
    plugin: { script: FAILING_SCRIPT },
    body: function (fx) {
      writeBundleAudit(fx.project, "Detail");
      const layout = createLayoutRegistrar({ pluginRoot: fx.pluginRoot });
      const manifest = resolveManifest({ workDir: fx.project, target: "Detail" });
      assert.throws(
        function () { layout.register({ projectRoot: fx.project, manifest: manifest, mode: "mtslg-iocontrol" }); },
        function (error) {
          assert.ok(/Layout 重新注册失败/.test(error.message), "要报出这是重新注册失败：" + error.message);
          assert.ok(/门禁没通过/.test(error.message), "要带上脚本的错误尾巴：" + error.message);
          assert.ok(error.message.indexOf("\u001b") < 0, "不许把色码带进失败原因：" + error.message);
          return true;
        }
      );
    }
  });
}

function caseLongFailureKeepsTail() {
  withFixture({
    plugin: { script: LONG_FAILING_SCRIPT },
    body: function (fx) {
      writeBundleAudit(fx.project, "Detail");
      const layout = createLayoutRegistrar({ pluginRoot: fx.pluginRoot });
      const manifest = resolveManifest({ workDir: fx.project, target: "Detail" });
      assert.throws(
        function () { layout.register({ projectRoot: fx.project, manifest: manifest, mode: "mtslg-iocontrol" }); },
        function (error) {
          assert.ok(/末尾这句才是原因/.test(error.message), "长输出要留尾巴，不能从头截：" + error.message.slice(-80));
          return true;
        }
      );
    }
  });
}

function caseDescriptorMustRegisterLayoutScript() {
  withFixture({
    plugin: { descriptor: { scripts: { mapping: "x.js" } } },
    body: function (fx) {
      const layout = createLayoutRegistrar({ pluginRoot: fx.pluginRoot });
      assert.throws(
        function () { layout.register({ projectRoot: fx.project, manifest: {}, mode: "mtslg-iocontrol" }); },
        /路线描述符没有登记 Layout 脚本/
      );
    }
  });
}

function caseLayoutScriptMustExist() {
  withFixture({
    plugin: { script: false },
    body: function (fx) {
      const layout = createLayoutRegistrar({ pluginRoot: fx.pluginRoot });
      assert.throws(
        function () { layout.register({ projectRoot: fx.project, manifest: {}, mode: "mtslg-iocontrol" }); },
        /插件里找不到 Layout 注册脚本/
      );
    }
  });
}

function caseRegisterNeedsManifest() {
  withFixture({ body: function (fx) {
    const layout = createLayoutRegistrar({ pluginRoot: fx.pluginRoot });
    assert.throws(
      function () { layout.register({ projectRoot: fx.project, mode: "mtslg-iocontrol" }); },
      /重新注册 Layout 缺少清单/
    );
  } });
}

function caseResolveManifestReadsBundleAudit() {
  withFixture({ body: function (fx) {
    writeBundleAudit(fx.project, "Detail");
    const manifest = resolveManifest({ workDir: fx.project, target: "Detail" });
    assert.strictEqual(manifest.layoutPath, workdir.LAYOUT_REL, "Layout 路径固定是主工程那份");
    assert.strictEqual(manifest.pageTarget, "Detail", "页面 Target 取自审计");
    assert.strictEqual(manifest.mappingTag, "MTSLG", "映射标签取自审计");
    assert.strictEqual(manifest.pageLangName, "DetailPageTitle", "页面语言名取自审计");
    assert.strictEqual(manifest.layoutStatus, "complete", "Layout 状态取自审计");
    assert.deepStrictEqual(manifest.layoutEvidence.matchedBottomBarItems, 2, "Layout 证据取自审计");
    assert.strictEqual(manifest.menuItems.length, 1, "菜单项取自审计");
  } });
}

function caseResolveManifestGuards() {
  withFixture({ body: function (fx) {
    assert.throws(function () { resolveManifest({ workDir: fx.project, target: "" }); }, /需要页面 Target/);
    assert.throws(function () { resolveManifest({ workDir: fx.project, target: "Detail" }); }, /找不到本页的 Bundle 审计/);

    write(path.join(fx.project, "Generated", "Detail.bundle.manifest.json"), "{ 不是 json\n");
    assert.throws(function () { resolveManifest({ workDir: fx.project, target: "Detail" }); }, /不是合法 JSON/);

    write(path.join(fx.project, "Generated", "Detail.bundle.manifest.json"), JSON.stringify({ inputs: { pageTarget: "Detail" } }) + "\n");
    assert.throws(function () { resolveManifest({ workDir: fx.project, target: "Detail" }); }, /没有已解析的 Layout 清单/);

    // 审计存在但 mappingTag 缺省：不算错，按 null 交给脚本自己兜。
    writeBundleAudit(fx.project, "Detail", { mappingTag: "" });
    assert.strictEqual(resolveManifest({ workDir: fx.project, target: "Detail" }).mappingTag, null, "空映射标签归一成 null");
  } });
}

async function main() {
  const cases = [
    ["注册按插件脚本重跑（工作目录 / --overwrite / 写法表 / 清单）", caseRegisterRunsPluginScript],
    ["缺省路线不带 --map 也能注册", caseRegisterDefaultsModeAndSkipsMapWithoutTemplateMap],
    ["插件脚本失败要连错误尾巴一起报", caseRegisterReportsPluginFailure],
    ["长输出的失败要留末尾那句", caseLongFailureKeepsTail],
    ["描述符没登记 Layout 脚本要停下", caseDescriptorMustRegisterLayoutScript],
    ["描述符登记了但脚本不在要停下", caseLayoutScriptMustExist],
    ["没有清单不许重新注册", caseRegisterNeedsManifest],
    ["清单从本页 Bundle 审计解析", caseResolveManifestReadsBundleAudit],
    ["清单缺失与非法时的报错", caseResolveManifestGuards]
  ];
  for (const [name, run] of cases) {
    await run();
    console.log("  ok  " + name);
  }
  console.log("plugin-layout.test.js 全部通过");
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
