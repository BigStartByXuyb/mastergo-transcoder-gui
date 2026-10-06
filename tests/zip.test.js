#!/usr/bin/env node
"use strict";

/*
 * 解 zip 的三条硬要求：内容与 CRC 对得上、目录结构还原、坏包当场报错。
 * 夹具用 git archive 真打一个 zip（发布件就是这么来的），不手搓 zip 字节。
 *
 * 跑法：node tests/zip.test.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const zip = require("../lib/zip.js");

function git(dir, args) {
  return execFileSync("git", ["-C", dir].concat(args), { encoding: "utf8" });
}

function makeZip() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mgtg-zip-"));
  const repo = path.join(base, "repo");
  fs.mkdirSync(path.join(repo, "skills", "mastergo-to-wpf"), { recursive: true });
  fs.writeFileSync(path.join(repo, "skills", "mastergo-to-wpf", "SKILL.md"), "# 说明书\n中文内容\n");
  fs.writeFileSync(path.join(repo, "plugin.json"), JSON.stringify({ version: "1.0.0" }));
  git(repo, ["init", "-q"]);
  // 夹具不跟着本机的换行设置走：断言的是「解出来的字节 == 写进去的字节」。
  git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "user.email", "ci@example.com"]);
  git(repo, ["config", "user.name", "ci"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "fixture"]);
  git(repo, ["tag", "v1.0.0"]);
  const zipPath = path.join(base, "fixture.zip");
  git(repo, ["archive", "--format=zip", "v1.0.0", "-o", zipPath]);
  return { base: base, zipPath: zipPath };
}

function main() {
  const fixture = makeZip();
  try {
    const out = path.join(fixture.base, "out");
    const files = zip.extractZip(fixture.zipPath, out);
    assert.ok(files >= 2, "解出来的文件数：" + files);
    assert.strictEqual(
      fs.readFileSync(path.join(out, "skills", "mastergo-to-wpf", "SKILL.md"), "utf8"),
      "# 说明书\n中文内容\n",
      "内容要一模一样（含中文）"
    );
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(out, "plugin.json"), "utf8")).version, "1.0.0");

    // 内容与记录对不上（CRC 不符）时要报错，不能悄悄解出坏文件：
    // 直接把中央目录里第一条的 CRC 字段改掉，这一条必然过不了校验。
    const broken = Buffer.from(fs.readFileSync(fixture.zipPath));
    let eocd = broken.length - 22;
    while (eocd > 0 && broken.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
    const firstCentral = broken.readUInt32LE(eocd + 16);
    assert.ok(firstCentral > 0, "夹具里应该能找到中央目录");
    broken[firstCentral + 16] = broken[firstCentral + 16] ^ 0xff;
    const corruptedPath = path.join(fixture.base, "corrupted.zip");
    fs.writeFileSync(corruptedPath, broken);
    assert.throws(function () { zip.extractZip(corruptedPath, path.join(fixture.base, "out2")); }, /校验不过/, "CRC 对不上要报错");

    // 不是 zip 的东西：直接报「不是 zip」。
    const junkPath = path.join(fixture.base, "junk.zip");
    fs.writeFileSync(junkPath, "这不是 zip");
    assert.throws(function () { zip.extractZip(junkPath, path.join(fixture.base, "out3")); }, /不是 zip/);

    assert.strictEqual(zip.crc32(Buffer.from("123456789")), 0xcbf43926, "CRC32 与标准值一致");
    console.log("zip.test.js 全部通过");
  }
  finally {
    fs.rmSync(fixture.base, { recursive: true, force: true });
  }
}

try {
  main();
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
