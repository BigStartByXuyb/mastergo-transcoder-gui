"use strict";

// Layout.xml 的增量注册交给插件自己做。
//
// 为什么合并阶段不搬这份文件：Layout.xml 是全工程共享的读-改-写文件，每个任务都要往
// <Pages> 里插自己的 <Page> 块。而插件插入时的写法与原文件不一定一致 —— 实测
// gen-mtslg-layout.js 的 insertNewPage 会把 <Pages> 闭合标签的缩进去掉，于是
// 「整份搬过去」会覆盖掉别的页，「行级三方合并」也会把同一行的缩进变化误判成冲突。
//
// 所以这里既不搬运也不猜：拿本页的 Layout 清单，让插件把这一页重新注册进**主工程当前那份**
// Layout.xml（--overwrite 时同 Target 是替换，不是重复注册）。产物与流水线自己写出来的完全一致。
//
// 脚本路径与写法表都取自插件自己的路线描述符 references/adapters/<mode>/adapter.json，
// GUI 不另写一份；子进程以工程根为工作目录，与 run-all.ps1 的 Invoke-StepCommand 一致。

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

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

function createLayoutRegistrar(deps) {
  const pluginRoot = deps.pluginRoot;
  const descriptors = new Map();

  function describe(mode) {
    if (!descriptors.has(mode)) descriptors.set(mode, readDescriptor(pluginRoot, mode));
    return descriptors.get(mode);
  }

  // options: { projectRoot, manifestPath, mode }
  function register(options) {
    const entry = describe(String(options.mode || "mtslg-iocontrol"));
    if (!fs.existsSync(entry.script)) throw new Error("插件里找不到 Layout 注册脚本：" + entry.script);
    if (!fs.existsSync(options.manifestPath)) throw new Error("找不到本页的 Layout 清单：" + options.manifestPath);

    const args = [entry.script, "--manifest", options.manifestPath, "--overwrite"];
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

  return { register };
}

module.exports = { createLayoutRegistrar, SKILL_REL };
