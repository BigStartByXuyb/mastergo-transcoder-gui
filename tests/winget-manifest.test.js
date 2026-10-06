#!/usr/bin/env node
"use strict";

// winget 清单：版本/地址/哈希/入口必须与这一版的 zip 对得上，且能过 winget 的模式校验（字段齐全）。
// 跑法：node tests/winget-manifest.test.js

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "winget-manifest.js");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const FOLDER = "mastergo-transcoder-gui-" + pkg.version;

function run(args) {
  return spawnSync(process.execPath, [SCRIPT].concat(args), { encoding: "utf8" });
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gui-winget-"));
  const zip = path.join(tmp, FOLDER + ".zip");
  fs.writeFileSync(zip, "fake-zip-bytes", "utf8");
  const out = path.join(tmp, "winget");
  const base = "https://git.example.com/team/repo";

  const result = run(["--zip", zip, "--out", out, "--base", base]);
  assert.strictEqual(result.status, 0, "生成器要跑通：" + String(result.stderr || ""));

  const installer = fs.readFileSync(path.join(out, "BigStart.MasterGoTranscoder.installer.yaml"), "utf8");
  assert.match(installer, new RegExp("PackageVersion: " + pkg.version), "版本号取 package.json");
  assert.match(
    installer,
    new RegExp("InstallerUrl: " + base + "/releases/download/v" + pkg.version + "/" + FOLDER + "\\.zip"),
    "包地址＝基址 + 这一版的 zip 名"
  );
  const sha = crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex").toUpperCase();
  assert.match(installer, new RegExp("InstallerSha256: " + sha), "哈希现算，与包一致");
  assert.match(installer, new RegExp("RelativeFilePath: " + FOLDER + "/mastergo-transcoder\\.exe"), "入口指向包里的启动器");
  assert.match(installer, /NestedInstallerType: portable/, "portable：不跑安装程序");

  const locale = fs.readFileSync(path.join(out, "BigStart.MasterGoTranscoder.locale.zh-CN.yaml"), "utf8");
  for (const field of ["PackageName:", "Publisher:", "ShortDescription:", "License:", "Moniker:"]) {
    assert.ok(locale.indexOf(field) >= 0, "清单要有 " + field + "（winget 的模式校验会查）");
  }

  // 包不在就得报错，不许生成一份指向空地址的清单。
  const missing = run(["--zip", path.join(tmp, "nope.zip"), "--out", out]);
  assert.notStrictEqual(missing.status, 0);
  assert.match(String(missing.stderr || ""), /找不到这一版的 zip/);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("winget-manifest.test.js 全部通过");
}

try {
  main();
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
