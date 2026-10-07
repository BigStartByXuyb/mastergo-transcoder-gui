#!/usr/bin/env node
"use strict";

// 内网 winget 源：数据生成（标识 / 版本 / 包地址 / 哈希）与四个 REST 端点。
// 服务用真进程真端口起，验的就是 winget 会打的那几个地址。
// 跑法：node tests/winget-source.test.js

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const winget = require("../lib/winget-manifest.js");

const ROOT = path.join(__dirname, "..");
const GENERATOR = path.join(ROOT, "scripts", "winget-source.js");
const SERVER = path.join(ROOT, "scripts", "winget-source-server.js");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const FOLDER = "mastergo-transcoder-gui-" + pkg.version;
const ZIP = FOLDER + ".zip";
const ID = "BigStart.MasterGoTranscoder.Internal";

// 起服务、等它把真实端口打出来（--port 0 让系统分一个空端口）。
function startServer(root) {
  return new Promise(function (resolve, reject) {
    const child = spawn(process.execPath, [SERVER, "--root", root, "--port", "0", "--identifier", "BigStart"]);
    let output = "";
    const timer = setTimeout(function () {
      child.kill();
      reject(new Error("服务没起来：" + output));
    }, 20000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", function (chunk) {
      output += chunk;
      const found = output.match(/端口：(\d+)/);
      if (found) {
        clearTimeout(timer);
        resolve({ child: child, port: Number(found[1]) });
      }
    });
    child.on("error", function (error) {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gui-winget-source-"));
  const zip = path.join(tmp, ZIP);
  fs.writeFileSync(zip, "fake-zip-bytes", "utf8");
  const out = path.join(tmp, "winget-source");
  const base = "https://10.101.0.62:8443";
  const sha = crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex").toUpperCase();
  const facts = { id: ID, version: pkg.version, url: base + "/files/" + ZIP, sha256: sha, folder: FOLDER };

  /*
   * 纯函数部分直接调：清单的两种形状、两个标识、内网源的目录约定。
   * 这些名字是外面的契约（winget 认标识、部署按目录名找数据文件），钉在这里改一处就知道。
   */
  assert.deepStrictEqual(
    winget.yamlFiles(facts).map((file) => file.name),
    [ID + ".yaml", ID + ".locale.zh-CN.yaml", ID + ".installer.yaml"],
    "三个 YAML 的文件名"
  );
  assert.strictEqual(winget.restPackage(facts).Versions[0].Installers[0].InstallerUrl, facts.url, "REST 清单里的包地址");
  assert.strictEqual(winget.sourceDocument([winget.restPackage(facts)]).Packages.length, 1, "内网源数据就装包对象");
  assert.strictEqual(winget.SOURCE_FILE, "winget-source.json", "服务读的数据文件名");
  assert.strictEqual(winget.SOURCE_FILES_DIR, "files", "静态资产目录名");
  assert.strictEqual(winget.DEFAULT_ID, "BigStart.MasterGoTranscoder", "公网那一份的标识");
  assert.strictEqual(winget.INTERNAL_ID, "BigStart.MasterGoTranscoder.Internal", "内网那一份的标识");
  const information = winget.informationBody("BigStart").Data;
  assert.strictEqual(information.SourceIdentifier, "BigStart", "服务信息里的源名");
  assert.ok(information.ServerSupportedVersions.includes("1.6.0"), "要认 winget 会挑的那个 REST 版本");
  assert.deepStrictEqual(winget.manifestBody([winget.restPackage(facts)], ID, "9.9.9"), null, "没有这一版就是 null");
  assert.strictEqual(winget.manifestBody([winget.restPackage(facts)], ID, pkg.version).Data.Versions.length, 1);

  /*
   * 搜索语义：(Query || Inclusions...) && Filters...
   * winget 装包前会把同一个关键词同时放进好几个字段的 Inclusions —— 那是「或」，命中任一字段就算包括进来；
   * 按「且」算就一个都匹配不上，客户端据此判定「这个源不支持这次搜索」并中止安装。
   */
  const packages = [winget.restPackage(facts)];
  const match = (field, keyword, matchType) => ({ PackageMatchField: field, RequestMatch: { KeyWord: keyword, MatchType: matchType } });
  assert.strictEqual(winget.searchBody(packages, { Inclusions: [match("PackageFamilyName", ID, "Exact"), match("PackageIdentifier", ID, "CaseInsensitive")] }).Data.length, 1, "Inclusions 之间是或");
  assert.strictEqual(winget.searchBody(packages, { Inclusions: [match("PackageName", ID, "CaseInsensitive")] }).Data.length, 0, "名字对不上就是没命中");
  assert.strictEqual(winget.searchBody(packages, { Filters: [match("PackageIdentifier", ID, "CaseInsensitive")] }).Data.length, 1, "Filters 命中");
  assert.strictEqual(winget.searchBody(packages, { Filters: [match("PackageName", ID, "CaseInsensitive")] }).Data.length, 0, "Filters 是且，点名字就必须名字命中");
  assert.strictEqual(winget.searchBody(packages, { Query: { KeyWord: "mastergo", MatchType: "Substring" } }).Data.length, 1, "关键词搜");
  assert.strictEqual(winget.searchBody(packages, { Query: { KeyWord: "别的包", MatchType: "Substring" } }).Data.length, 0, "搜不到就是空列表");
  assert.strictEqual(winget.searchBody(packages, { FetchAllManifests: true, MaximumResults: 1 }).Data.length, 1, "Query 与 Inclusions 都为空＝整个库都是候选");
  assert.deepStrictEqual(
    winget.searchBody(packages, { Inclusions: [match("ProductCode", ID, "Exact")] }).UnsupportedPackageMatchFields,
    ["ProductCode"],
    "没有的字段照实报出去，不猜"
  );

  const made = spawnSync(process.execPath, [GENERATOR, "--zip", zip, "--out", out, "--base", base], { encoding: "utf8" });
  assert.strictEqual(made.status, 0, "生成器要跑通：" + String(made.stderr || ""));

  // 数据文件：包与版本的 REST 形状，包地址指向这个服务自己发的 zip。
  const document = JSON.parse(fs.readFileSync(path.join(out, "winget-source.json"), "utf8"));
  const entry = document.Packages[0];
  assert.strictEqual(entry.PackageIdentifier, ID, "内网那一份用带 .Internal 的标识");
  const version = entry.Versions[0];
  assert.strictEqual(version.PackageVersion, pkg.version, "版本号取 package.json");
  assert.strictEqual(version.Installers[0].InstallerUrl, base + "/files/" + ZIP, "包地址＝源地址 + 静态资产目录");
  assert.strictEqual(version.Installers[0].InstallerSha256, sha, "哈希现算，与包一致");
  assert.strictEqual(
    version.Installers[0].NestedInstallerFiles[0].RelativeFilePath,
    FOLDER + "/mastergo-transcoder.exe",
    "入口指向包里的启动器"
  );
  assert.ok(fs.existsSync(path.join(out, "files", ZIP)), "zip 随数据目录一起落盘");

  // 基址写坏要报错：服务地址不对，清单会指向取不到的包。
  const badBase = spawnSync(process.execPath, [GENERATOR, "--zip", zip, "--out", out, "--base", "svn://10.0.0.9/x"], { encoding: "utf8" });
  assert.notStrictEqual(badBase.status, 0);
  assert.match(String(badBase.stderr || ""), /基址不合法/);

  const server = await startServer(out);
  const api = "http://127.0.0.1:" + server.port + "/api";
  try {
    // winget 先问服务认哪些 REST 版本。
    const information = await (await fetch(api + "/information")).json();
    assert.strictEqual(information.Data.SourceIdentifier, "BigStart");
    assert.ok(information.Data.ServerSupportedVersions.includes("1.6.0"), "要认 winget 会用到的那个版本");
    assert.deepStrictEqual(information.Data.UnsupportedPackageMatchFields, []);

    async function search(body) {
      const response = await fetch(api + "/manifestSearch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      assert.strictEqual(response.status, 200, "搜索接口要回 200");
      return await response.json();
    }

    // 关键词搜（winget search 走这条）。
    const byKeyword = await search({ Query: { KeyWord: "mastergo", MatchType: "Substring" } });
    assert.strictEqual(byKeyword.Data.length, 1);
    assert.strictEqual(byKeyword.Data[0].PackageIdentifier, ID);
    assert.strictEqual(byKeyword.Data[0].PackageName, "MasterGo 转码客户端");
    assert.deepStrictEqual(byKeyword.Data[0].Versions, [{ PackageVersion: pkg.version }]);

    /*
     * 这一条是 winget 真发过的原文（装包之前那一次「这一整套身份里有没有它」）：
     * 同一个关键词同时放进五个字段的 Inclusions。之前按「且」算，一个都匹配不上，
     * 客户端看到「0 条 + 有没支持的字段」就报「一个或多个源不支持搜索请求」并中止安装 ——
     * 这条请求因此留在用例里，改搜索语义要过它。
     */
    const correlation = await search({
      Inclusions: ["PackageFamilyName", "ProductCode", "PackageIdentifier", "PackageName", "Moniker"].map((field) => ({
        PackageMatchField: field,
        RequestMatch: { KeyWord: ID, MatchType: field === "PackageFamilyName" || field === "ProductCode" ? "Exact" : "CaseInsensitive" }
      }))
    });
    assert.strictEqual(correlation.Data.length, 1, "只要有任一个字段命中就算包括进来");
    assert.strictEqual(correlation.Data[0].PackageIdentifier, ID);
    // 我们的数据里没有的字段不猜：照实报回去（winget 看得到，不会当成「支持了」）。
    assert.deepStrictEqual(correlation.UnsupportedPackageMatchFields, ["PackageFamilyName", "ProductCode"]);

    // 取清单：winget 拿着标识（和版本）来要安装信息。
    const manifest = await (await fetch(api + "/packageManifests/" + ID + "?Version=" + pkg.version)).json();
    const installer = manifest.Data.Versions[0].Installers[0];
    assert.strictEqual(installer.InstallerUrl, base + "/files/" + ZIP);
    assert.strictEqual(installer.InstallerSha256, sha);
    assert.strictEqual(installer.NestedInstallerType, "portable");

    const missingVersion = await fetch(api + "/packageManifests/" + ID + "?Version=9.9.9");
    assert.strictEqual(missingVersion.status, 404);
    assert.strictEqual((await missingVersion.json()).ErrorCode, 404);
    const missingPackage = await fetch(api + "/packageManifests/BigStart.Nope");
    assert.strictEqual(missingPackage.status, 404);

    // 静态资产：zip 与部署时生成的证书都从这里取。
    const file = await fetch("http://127.0.0.1:" + server.port + "/files/" + ZIP);
    assert.strictEqual(file.status, 200);
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.strictEqual(crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase(), sha, "发出去的 zip 与本地一致");

    // HEAD 与 GET 同路：只看一眼「在不在、多大」不该 404（下载前先核一遍大小用得上）。
    const head = await fetch("http://127.0.0.1:" + server.port + "/files/" + ZIP, { method: "HEAD" });
    assert.strictEqual(head.status, 200);
    assert.strictEqual(Number(head.headers.get("content-length")), fs.statSync(zip).size);

    // 不许爬出资产目录。
    const escape = await fetch("http://127.0.0.1:" + server.port + "/files/..%2Fwinget-source.json");
    assert.strictEqual(escape.status, 404);
  }
  finally {
    server.child.kill();
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("winget-source.test.js 全部通过");
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
