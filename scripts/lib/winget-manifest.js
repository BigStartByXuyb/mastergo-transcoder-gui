"use strict";

/*
 * winget 的包：同一份事实渲染成两种形状。
 *
 *   三个 YAML —— 提公网源（winget-pkgs）用；客户机 `winget install --manifest <目录>` 也吃这一份。
 *   REST 清单 —— 内网源服务（scripts/winget-source-server.js）按它回答 winget 的询问。
 *
 * 包是 portable：zip 里就是我们的启动器，winget 把 zip 解进自己的包目录、把 mastergo-transcoder.exe
 * 链进 PATH，不跑任何安装程序。
 *
 * 放在 scripts/lib 而不是 lib：它不是运行时代码（客户端那份运行树的清单只收 lib/public/vendor，
 * 放 lib 会跟着每个客户机的更新包走）。用它的是两个生成器与内网源服务。
 *
 * 边界：只认调用方给的事实（标识 / 版本 / 包地址 / 哈希 / 包内目录），自身不做 IO ——
 * 服务机上跑的就是这一份，它只该带 lib/versions.js 一个依赖（见 docs/winget-internal-source.md）。
 * 「这一版的事实」怎么装配（读 package.json、算哈希）在 scripts/lib/winget-facts.js，那是构建机上的事。
 */

const { compareVersions } = require("../../lib/versions.js");

// 公网那一份的标识；内网那一份用 INTERNAL_ID（同一台机器上两个同名包会打架）。
const DEFAULT_ID = "BigStart.MasterGoTranscoder";
const INTERNAL_ID = "BigStart.MasterGoTranscoder.Internal";
const PUBLISHER = "BigStart";
const PACKAGE_NAME = "MasterGo 转码客户端";
const SHORT_DESCRIPTION = "MasterGo 设计稿转码客户端：看板跑流水线、待确认、更新与回退";
// 内部工具：清单里必须有一项 License。这里按「公司内部使用」写，改发布策略时改这一处。
const LICENSE = "Proprietary";
const MONIKER = "mastergo-transcoder";
// 装完链进 PATH 的命令名。
const COMMAND_ALIAS = "mastergo-transcoder";
const LOCALE = "zh-CN";
// zip 里保留着那一层目录，所以入口的相对路径要带上包内目录。
const ENTRY_EXE = "mastergo-transcoder.exe";
// 内网源的数据文件：生成器写它、服务读它，名字只在这一处。
const SOURCE_FILE = "winget-source.json";
// 内网源里的静态资产（zip、部署时生成的证书）放在这个子目录下。
const SOURCE_FILES_DIR = "files";
// winget 认的 REST 版本：照微软参考实现（winget-cli-restsource）的清单给，客户端从里面挑一个能用的。
const API_VERSIONS = ["1.0.0", "1.1.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.9.0", "1.10.0"];
// winget 的 PackageMatchField 枚举：前四个我们按字段比对，后面的我们不认。
const MATCH_FIELDS = ["PackageIdentifier", "PackageName", "Moniker", "Command"];
const MATCH_FIELD_ENUM = MATCH_FIELDS.concat(["Tag", "PackageFamilyName", "ProductCode", "UpgradeCode", "NormalizedPackageNameAndPublisher", "Market", "HasInstallerType"]);

// 入口在包里的相对路径。
function entryOf(pkg) {
  return pkg.folder + "/" + ENTRY_EXE;
}

/* 三个 YAML。字段名与结构由 winget 的模式定死，这里只填值。 */
function yamlFiles(pkg) {
  return [
    {
      name: pkg.id + ".yaml",
      body: [
        "# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.1.6.0.schema.json",
        "PackageIdentifier: " + pkg.id,
        "PackageVersion: " + pkg.version,
        "DefaultLocale: " + LOCALE,
        "ManifestType: version",
        "ManifestVersion: 1.6.0",
        ""
      ].join("\n")
    },
    {
      name: pkg.id + ".locale." + LOCALE + ".yaml",
      body: [
        "# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.1.6.0.schema.json",
        "PackageIdentifier: " + pkg.id,
        "PackageVersion: " + pkg.version,
        "PackageLocale: " + LOCALE,
        "Publisher: " + PUBLISHER,
        "PackageName: " + PACKAGE_NAME,
        "ShortDescription: " + SHORT_DESCRIPTION,
        "License: " + LICENSE,
        "Moniker: " + MONIKER,
        "ManifestType: defaultLocale",
        "ManifestVersion: 1.6.0",
        ""
      ].join("\n")
    },
    {
      name: pkg.id + ".installer.yaml",
      body: [
        "# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.1.6.0.schema.json",
        "PackageIdentifier: " + pkg.id,
        "PackageVersion: " + pkg.version,
        "InstallerType: zip",
        "NestedInstallerType: portable",
        "NestedInstallerFiles:",
        "  - RelativeFilePath: " + entryOf(pkg),
        "    PortableCommandAlias: " + COMMAND_ALIAS,
        "Installers:",
        "  - Architecture: x64",
        "    InstallerUrl: " + pkg.url,
        "    InstallerSha256: " + pkg.sha256,
        "ManifestType: installer",
        "ManifestVersion: 1.6.0",
        ""
      ].join("\n")
    }
  ];
}

/* 一个包的 REST 形状：版本、默认区域、安装器。 */
function restPackage(pkg) {
  return {
    PackageIdentifier: pkg.id,
    Versions: [
      {
        PackageVersion: pkg.version,
        DefaultLocale: {
          PackageLocale: LOCALE,
          Publisher: PUBLISHER,
          PackageName: PACKAGE_NAME,
          ShortDescription: SHORT_DESCRIPTION,
          License: LICENSE,
          Moniker: MONIKER
        },
        Installers: [
          {
            Architecture: "x64",
            InstallerType: "zip",
            NestedInstallerType: "portable",
            NestedInstallerFiles: [{ RelativeFilePath: entryOf(pkg), PortableCommandAlias: COMMAND_ALIAS }],
            InstallerUrl: pkg.url,
            InstallerSha256: pkg.sha256
          }
        ]
      }
    ]
  };
}

/* 内网源服务读的那一份文件的内容：它一问，服务就照包对象回答。 */
function sourceDocument(packages) {
  return { Packages: packages.slice() };
}

/* 我们不认的那几个字段＝枚举里除去我们能比对的那些：信息接口照实声明，客户端能在发请求前就避开。 */
function unsupportedMatchFields() {
  return MATCH_FIELD_ENUM.filter((field) => !MATCH_FIELDS.includes(field));
}

/* 服务信息：winget 先问这一嘴，从中挑一个双方都认的 REST 版本。 */
function informationBody(identifier) {
  return {
    Data: {
      SourceIdentifier: identifier,
      ServerSupportedVersions: API_VERSIONS.slice(),
      RequiredPackageMatchFields: [],
      UnsupportedPackageMatchFields: unsupportedMatchFields(),
      UnsupportedQueryParameters: [],
      RequiredQueryParameters: []
    }
  };
}

function versionsOf(pkg) {
  return Array.isArray(pkg && pkg.Versions) ? pkg.Versions : [];
}

// 包这一层的名字/发行者取最高那一版（搜索结果是按包给的，版本在下面单列）。
function latestOf(pkg) {
  return versionsOf(pkg).reduce(
    (best, item) => (!best || compareVersions(item.PackageVersion, best.PackageVersion) > 0 ? item : best),
    null
  );
}

// 一个字段上可供比对的文本：命令这一项取安装器里的命令别名。
function fieldValues(pkg, field) {
  const latest = latestOf(pkg);
  const locale = (latest && latest.DefaultLocale) || {};
  if (field === "PackageIdentifier") return [pkg.PackageIdentifier];
  if (field === "PackageName") return [locale.PackageName];
  if (field === "Moniker") return [locale.Moniker];
  if (field === "Command") {
    const installers = (latest && latest.Installers) || [];
    const files = installers.reduce((all, item) => all.concat(item.NestedInstallerFiles || []), []);
    return files.map((file) => file.PortableCommandAlias);
  }
  return [];
}

function wildcardPattern(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + escaped.replace(/\\\*/g, ".*").replace(/\\\?/g, ".") + "$");
}

/*
 * 一条比对。Fuzzy / FuzzySubstring 与 Substring 走同一判断 —— 这份源里只有我们自己的包，
 * 模糊匹配在这里没有别的信息可用；不做一套看着像模糊、实际看运气的东西。
 */
function matches(value, keyword, matchType) {
  const haystack = String(value === undefined || value === null ? "" : value).toLowerCase();
  const needle = String(keyword || "").toLowerCase();
  if (!needle) return true;
  switch (matchType) {
    case "Exact":
    case "CaseInsensitive":
      return haystack === needle;
    case "StartsWith":
      return haystack.startsWith(needle);
    case "Wildcard":
      return wildcardPattern(needle).test(haystack);
    default:
      return haystack.includes(needle);
  }
}

/*
 * 一次搜索请求解析成什么：关键词、点名的字段（Inclusions / Filters）、我们不认的字段、条数上限。
 * 我们不认的字段不猜：收进 unsupported，随响应照实告诉客户端。
 */
function searchCriteria(request) {
  const asked = request && typeof request === "object" ? request : {};
  const unsupported = [];
  const named = function (items) {
    const list = [];
    for (const item of items) {
      const field = String((item && item.PackageMatchField) || "");
      if (!MATCH_FIELDS.includes(field)) {
        if (field && !unsupported.includes(field)) unsupported.push(field);
        continue;
      }
      const match = (item && item.RequestMatch) || {};
      list.push({ field: field, keyword: match.KeyWord, matchType: match.MatchType });
    }
    return list;
  };
  return {
    query: asked.Query ? { keyword: asked.Query.KeyWord, matchType: asked.Query.MatchType } : null,
    inclusions: named(asked.Inclusions || []),
    filters: named(asked.Filters || []),
    unsupported: unsupported,
    // MaximumResults 按契约：0 或不给＝不限制。
    limit: Number(asked.MaximumResults) > 0 ? Number(asked.MaximumResults) : 0
  };
}

function fieldHit(pkg, one) {
  return fieldValues(pkg, one.field).some((value) => matches(value, one.keyword, one.matchType));
}

/*
 * 一个包算不算命中：请求语义照 winget 自己的说法 (Query || Inclusions...) && Filters...
 * —— Query 与 Inclusions 之间是「或」（winget 会把同一个关键词同时放进好几种字段的 Inclusions，
 * 任一字段命中就算这个包被包括进来），Filters 之间是「且」（每一条点名的字段都必须命中）。
 * Query 与 Inclusions 都为空＝整个库都是候选，只剩 Filters 收窄。
 */
function matchesCriteria(pkg, criteria) {
  const keywordHit = criteria.query
    ? MATCH_FIELDS.some((field) => fieldValues(pkg, field).some((value) => matches(value, criteria.query.keyword, criteria.query.matchType)))
    : false;
  if ((criteria.query || criteria.inclusions.length) && !keywordHit && !criteria.inclusions.some((one) => fieldHit(pkg, one))) {
    return false;
  }
  return criteria.filters.every((one) => fieldHit(pkg, one));
}

/* 搜索结果里的一行：包这一层给标识、名字、发行者，版本单列。 */
function searchRow(pkg) {
  const latest = latestOf(pkg);
  const locale = (latest && latest.DefaultLocale) || {};
  return {
    PackageIdentifier: pkg.PackageIdentifier,
    PackageName: locale.PackageName,
    Publisher: locale.Publisher,
    Versions: versionsOf(pkg).map((item) => ({ PackageVersion: item.PackageVersion }))
  };
}

function searchBody(packages, request) {
  const criteria = searchCriteria(request);
  const rows = packages.filter((pkg) => matchesCriteria(pkg, criteria)).map(searchRow);
  return {
    Data: criteria.limit > 0 ? rows.slice(0, criteria.limit) : rows,
    RequiredPackageMatchFields: [],
    UnsupportedPackageMatchFields: criteria.unsupported
  };
}

/* 取某个包的清单；给了版本就只回那一版。没有这个包（或这一版）返回 null。 */
function manifestBody(packages, identifier, version) {
  const pkg = packages.find((item) => item.PackageIdentifier === identifier);
  if (!pkg) return null;
  const wanted = String(version || "").trim();
  if (!wanted) return { Data: pkg };
  const one = versionsOf(pkg).find((item) => item.PackageVersion === wanted);
  if (!one) return null;
  return { Data: { PackageIdentifier: pkg.PackageIdentifier, Versions: [one] } };
}

module.exports = {
  DEFAULT_ID: DEFAULT_ID,
  INTERNAL_ID: INTERNAL_ID,
  SOURCE_FILE: SOURCE_FILE,
  SOURCE_FILES_DIR: SOURCE_FILES_DIR,
  yamlFiles: yamlFiles,
  restPackage: restPackage,
  sourceDocument: sourceDocument,
  informationBody: informationBody,
  searchBody: searchBody,
  manifestBody: manifestBody
};
