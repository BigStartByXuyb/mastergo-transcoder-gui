"use strict";

// Layout.xml 的增量注册交给插件自己做。
//
// 为什么合并阶段不搬这份文件：Layout.xml 是全工程共享的读-改-写文件，每个任务都要往
// <Pages> 里插自己的 <Page> 块。而插件插入时的写法与原文件不一定一致 —— 实测
// gen-mtslg-layout.js 的 insertNewPage 会把 <Pages> 闭合标签的缩进去掉，于是
// 「整份搬过去」会覆盖掉别的页，「行级三方合并」也会把同一行的缩进变化误判成冲突。
//
// 所以这里既不搬运也不猜：拿本页已解析的 Layout 清单，让插件把这一页重新注册进**主工程当前那份**
// Layout.xml（--overwrite 时同 Target 是替换，不是重复注册）。
//
// 清单的取值来源是本页的 Bundle 审计 Generated/<Target>.bundle.manifest.json 的 inputs：
// 插件第 10 步喂给 gen-mtslg-layout.js 的就是那份（含语言绑定产出的 MenuItem.langName），
// 审计里的 inputs 就是它的快照。第 8 步的 _inputs/<Target>.layout-manifest.json 只有机械推导
// 结果、没有 langName，用它注册会把 MenuItem 的 LangName 写成空串，与插件单独跑不一致。
//
// 脚本路径与写法表都取自插件自己的路线描述符 references/adapters/<mode>/adapter.json，
// GUI 不另写一份；子进程以工程根为工作目录，与 run-all.ps1 的 Invoke-StepCommand 一致。

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const workdir = require("./workdir.js");

const SKILL_REL = path.join("skills", "mastergo-to-wpf");

function resolveUnder(root, relative) {
  return path.join(root, ...String(relative).split("/"));
}

function readDescriptor(pluginRoot, mode) {
  const skillRoot = path.join(pluginRoot, SKILL_REL);
  const file = path.join(skillRoot, "references", "adapters", mode, "adapter.json");
  const descriptor = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!descriptor.scripts || !descriptor.scripts.layout) {
    throw new Error("路线描述符没有登记 Layout 脚本：" + file);
  }
  return {
    script: resolveUnder(path.join(skillRoot, "scripts"), descriptor.scripts.layout),
    templateMap: descriptor.templateMap ? resolveUnder(skillRoot, descriptor.templateMap) : ""
  };
}

// 重新注册要用的清单：字段与插件 Bundle 步喂给 gen-mtslg-layout.js 的那份一一对应。
// layoutPath 固定用主工程那份相对路径 —— 脚本按子进程工作目录（主工程根）解析它。
function resolveManifest(options) {
  const target = String(options.target || "");
  if (!target) throw new Error("重新注册 Layout 需要页面 Target");
  const rel = workdir.runProductRel(target + ".bundle.manifest.json");
  const file = workdir.absolute(options.workDir, rel);
  if (!fs.existsSync(file)) {
    throw new Error("找不到本页的 Bundle 审计（" + rel + "）：拿不到含语言绑定的 Layout 清单，无法按插件口径重新注册");
  }
  let inputs = null;
  try {
    inputs = JSON.parse(fs.readFileSync(file, "utf8")).inputs;
  }
  catch (error) {
    throw new Error("Bundle 审计不是合法 JSON（" + rel + "）：" + error.message);
  }
  if (!inputs || !inputs.pageTarget || !Array.isArray(inputs.menuItems)) {
    throw new Error("Bundle 审计里没有已解析的 Layout 清单（inputs）：" + rel);
  }
  return {
    layoutPath: workdir.LAYOUT_REL,
    pageTarget: inputs.pageTarget,
    mappingTag: inputs.mappingTag || null,
    pageLangName: inputs.pageLangName,
    layoutStatus: inputs.layoutStatus,
    layoutEvidence: inputs.layoutEvidence,
    menuItems: inputs.menuItems
  };
}

function createLayoutRegistrar(deps) {
  // 插件根可能在设置里被换掉：取值收成函数，描述符缓存按「哪一份 + 哪条路线」分开存。
  const pluginRootOf = typeof deps.pluginRoot === "function"
    ? deps.pluginRoot
    : function () { return deps.pluginRoot || ""; };
  const descriptors = new Map();

  function describe(mode) {
    const key = pluginRootOf() + "|" + mode;
    if (!descriptors.has(key)) descriptors.set(key, readDescriptor(pluginRootOf(), mode));
    return descriptors.get(key);
  }

  // options: { projectRoot, manifest, mode }
  function register(options) {
    const entry = describe(String(options.mode || "mtslg-iocontrol"));
    if (!fs.existsSync(entry.script)) throw new Error("插件里找不到 Layout 注册脚本：" + entry.script);
    if (!options.manifest) throw new Error("重新注册 Layout 缺少清单");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtslg-layout-"));
    const manifestPath = path.join(dir, "layout-manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(options.manifest, null, 2) + "\n", "utf8");
    try {
      const args = [entry.script, "--manifest", manifestPath, "--overwrite"];
      if (entry.templateMap) args.push("--map", entry.templateMap);
      const result = spawnSync(process.execPath, args, {
        cwd: options.projectRoot,
        encoding: "utf8",
        timeout: 120000
      });
      if (result.error) throw new Error("调不起 node：" + result.error.message);
      if (result.status !== 0) {
        const detail = String(result.stderr || result.stdout || "").trim().split(/\r?\n/).slice(-4).join(" | ");
        throw new Error("Layout 重新注册失败：" + detail);
      }
    }
    finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  return { resolveManifest: resolveManifest, register: register };
}

module.exports = { createLayoutRegistrar, resolveManifest, SKILL_REL };
