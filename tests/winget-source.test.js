#!/usr/bin/env node
"use strict";

// 内网 winget 源：纯函数直接调，服务用真进程真端口起 —— 验的就是 winget 会打的那几个地址。
// 跑法：node tests/winget-source.test.js

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const winget = require("../scripts/lib/winget-manifest.js");
const { FILES } = require("../scripts/lib/winget-source-deploy.js");
const { versionFacts } = require("../scripts/lib/winget-facts.js");

const ROOT = path.join(__dirname, "..");
const GENERATOR = path.join(ROOT, "scripts", "winget-source.js");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const FOLDER = "mastergo-transcoder-gui-" + pkg.version;
const ZIP = FOLDER + ".zip";
const ID = "BigStart.MasterGoTranscoder.Internal";
const BASE = "https://internal.example.com";

// 先自己占一个空端口再放掉：服务不用把端口写进日志，用例也不去解析那句给人看的文案。
function freePort() {
  return new Promise(function (resolve, reject) {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", function () {
      const port = probe.address().port;
      probe.close(function () {
        resolve(port);
      });
    });
  });
}

// 起来没有看端口答不答应，不看 stdout。
function startServer(script, root, port) {
  const child = spawn(process.execPath, [script, "--root", root, "--port", String(port), "--identifier", "BigStart"]);
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", function (chunk) {
    output += chunk;
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", function (chunk) {
    output += chunk;
  });
  return new Promise(function (resolve, reject) {
    child.on("error", reject);
    const deadline = Date.now() + 20000;
    (async function poll() {
      while (Date.now() < deadline) {
        try {
          const response = await fetch("http://127.0.0.1:" + port + "/api/information");
          if (response.ok) return resolve(child);
        }
        catch {
          // 还没监听上，接着等
        }
        await new Promise((done) => setTimeout(done, 200));
      }
      child.kill();
      reject(new Error("服务没起来：" + output));
      return undefined;
    })();
  });
}

/* 文档里那份部署清单（标记之间）——标记是给机器认的，正文怎么排版都行。 */
function listedInDoc() {
  const doc = fs.readFileSync(path.join(ROOT, "docs", "winget-internal-source.md"), "utf8");
  const start = doc.indexOf("<!-- winget-source-deploy:start -->");
  const end = doc.indexOf("<!-- winget-source-deploy:end -->");
  assert.ok(start >= 0 && end > start, "文档要留着部署清单的那对标记");
  return doc
    .slice(start, end)
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name) => name && name.endsWith(".js"));
}

/*
 * 照那份清单把文件摆进一个空目录 —— 这就是从零部署的样子。
 * 清单漏了文件、路径摆错，后面起服务那一步就会当场失败（比「文档里提没提到这个路径」实在）。
 */
function stageDeployment(stage) {
  for (const name of FILES) {
    const from = path.join(ROOT, name);
    assert.ok(fs.existsSync(from), "清单里的文件要真在仓库里：" + name);
    const to = path.join(stage, name);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

async function main() {
  assert.deepStrictEqual(
    listedInDoc().slice().sort(),
    FILES.slice().sort(),
    "文档那份清单要与 scripts/lib/winget-source-deploy.js 一致"
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gui-winget-source-"));
  const zip = path.join(tmp, ZIP);
  fs.writeFileSync(zip, "fake-zip-bytes", "utf8");
  // 部署目录照文档摆；数据与包放进服务读的那个目录（与文档里 data/ 的位置一致）。
  const stage = path.join(tmp, "deploy");
  stageDeployment(stage);
  const out = path.join(stage, "data");
  const sha = crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex").toUpperCase();
  const facts = { id: ID, version: pkg.version, url: BASE + "/files/" + ZIP, sha256: sha, folder: FOLDER };

  /*
   * 纯函数直接调：清单的两种形状、两个标识、内网源的目录约定。
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
  assert.deepStrictEqual(winget.manifestBody([winget.restPackage(facts)], ID, "9.9.9"), null, "没有这一版就是 null");
  assert.strictEqual(winget.manifestBody([winget.restPackage(facts)], ID, pkg.version).Data.Versions.length, 1);

  // 事实的装配只有一处：版本号取 package.json、zip 不在就当场报错（两个入口都从这里过）。
  const made = versionFacts({ id: ID, zip: zip, urlOf: (info) => BASE + "/files/" + info.folder + ".zip" });
  assert.strictEqual(made.version, pkg.version, "版本号取 package.json");
  assert.strictEqual(made.folder, FOLDER, "包内目录按版本拼");
  assert.strictEqual(made.sha256, sha, "哈希现算");
  assert.throws(
    () => versionFacts({ id: ID, zip: path.join(tmp, "nope.zip"), urlOf: () => "" }),
    /找不到这一版的 zip/,
    "包不在就要报错"
  );

  /*
   * 服务信息：源名、认的 REST 版本，以及「我们不认哪几个字段」——
   * 这一份与搜索里报的必须是同一份事实（信息接口照实声明，客户端能在发请求前就避开）。
   */
  const information = winget.informationBody("BigStart").Data;
  assert.strictEqual(information.SourceIdentifier, "BigStart", "服务信息里的源名");
  assert.ok(information.ServerSupportedVersions.includes("1.6.0"), "要认 winget 会挑的那个 REST 版本");
  assert.deepStrictEqual(
    information.UnsupportedPackageMatchFields,
    ["Tag", "PackageFamilyName", "ProductCode", "UpgradeCode", "NormalizedPackageNameAndPublisher", "Market", "HasInstallerType"],
    "信息接口声明的就是搜索那边报的同一份"
  );

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
  assert.strictEqual(winget.searchBody(packages, { Query: { KeyWord: "mastergo", MatchType: "Substring" }, MaximumResults: 0 }).Data.length, 1, "不限制条数");
  assert.deepStrictEqual(
    winget.searchBody(packages, { Inclusions: [match("ProductCode", ID, "Exact")] }).UnsupportedPackageMatchFields,
    ["ProductCode"],
    "没有的字段照实报出去，不猜"
  );

  // 生成器：数据文件与 zip 一起落盘，包地址指向这台源服务自己。
  const generated = spawnSync(process.execPath, [GENERATOR, "--zip", zip, "--out", out, "--base", BASE], { encoding: "utf8" });
  assert.strictEqual(generated.status, 0, "生成器要跑通：" + String(generated.stderr || ""));

  const document = JSON.parse(fs.readFileSync(path.join(out, "winget-source.json"), "utf8"));
  const entry = document.Packages[0];
  assert.strictEqual(entry.PackageIdentifier, ID, "内网那一份用带 .Internal 的标识");
  const version = entry.Versions[0];
  assert.strictEqual(version.PackageVersion, pkg.version, "版本号取 package.json");
  assert.strictEqual(version.Installers[0].InstallerUrl, BASE + "/files/" + ZIP, "包地址＝源地址 + 静态资产目录");
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

  const port = await freePort();
  const server = await startServer(path.join(stage, "scripts", "winget-source-server.js"), out, port);
  const origin = "http://127.0.0.1:" + port;
  const api = origin + "/api";
  try {
    // winget 先问服务认哪些 REST 版本，以及这个源不认哪些字段。
    const info = await (await fetch(api + "/information")).json();
    assert.strictEqual(info.Data.SourceIdentifier, "BigStart");
    assert.ok(info.Data.ServerSupportedVersions.includes("1.6.0"));
    assert.ok(info.Data.UnsupportedPackageMatchFields.includes("PackageFamilyName"), "信息接口与搜索同一份字段清单");

    async function search(body) {
      const response = await fetch(api + "/manifestSearch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      assert.strictEqual(response.status, 200, "搜索接口要回 200");
      return await response.json();
    }

    // 关键词搜（winget search 走这条）：回来的是包这一层 + 版本。
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
    assert.strictEqual(installer.InstallerUrl, BASE + "/files/" + ZIP);
    assert.strictEqual(installer.InstallerSha256, sha);
    assert.strictEqual(installer.NestedInstallerType, "portable");

    const missingVersion = await fetch(api + "/packageManifests/" + ID + "?Version=9.9.9");
    assert.strictEqual(missingVersion.status, 404);
    assert.strictEqual((await missingVersion.json()).ErrorCode, 404);
    const missingPackage = await fetch(api + "/packageManifests/BigStart.Nope");
    assert.strictEqual(missingPackage.status, 404);

    // 静态资产：zip 与部署时生成的证书都从这里取。
    const file = await fetch(origin + "/files/" + ZIP);
    assert.strictEqual(file.status, 200);
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.strictEqual(crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase(), sha, "发出去的 zip 与本地一致");

    // HEAD 与 GET 同路：只看一眼「在不在、多大」不该 404（下载前先核一遍大小用得上）。
    const head = await fetch(origin + "/files/" + ZIP, { method: "HEAD" });
    assert.strictEqual(head.status, 200);
    assert.strictEqual(Number(head.headers.get("content-length")), fs.statSync(zip).size);

    // 不许爬出资产目录。
    const escape = await fetch(origin + "/files/..%2Fwinget-source.json");
    assert.strictEqual(escape.status, 404);
  }
  finally {
    server.kill();
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("winget-source.test.js 全部通过");
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
