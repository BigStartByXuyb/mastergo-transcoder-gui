"use strict";

/*
 * 内网源服务怎么回答 winget 的三问：服务信息、搜索、取某个包的清单。
 *
 * 搜索语义照 winget 自己的说法：(Query || Inclusions...) && Filters...
 * —— Query 与 Inclusions 之间是「或」（winget 会把同一个关键词同时放进好几种字段的 Inclusions，
 * 任一字段命中就算这个包被包括进来），Filters 之间是「且」（每一条点名的字段都必须命中）。
 * 我们这份数据里没有的字段不猜：照实收进 UnsupportedPackageMatchFields。
 *
 * 放在 scripts/lib：只有源服务用它（三个 YAML 与内网源数据那两种形状在 winget-manifest.js）。
 * 边界：只认「包对象数组 + 一次请求」，不读盘、不碰 HTTP。
 */

const { compareVersions } = require("../../lib/versions.js");

// winget 认的 REST 版本：照微软参考实现（winget-cli-restsource）的清单给，客户端从里面挑一个能用的。
const API_VERSIONS = ["1.0.0", "1.1.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.9.0", "1.10.0"];
// winget 的 PackageMatchField 枚举：前四个我们按字段比对，后面的我们不认。
const MATCH_FIELDS = ["PackageIdentifier", "PackageName", "Moniker", "Command"];
const MATCH_FIELD_ENUM = MATCH_FIELDS.concat(["Tag", "PackageFamilyName", "ProductCode", "UpgradeCode", "NormalizedPackageNameAndPublisher", "Market", "HasInstallerType"]);

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
 * 一条比对，两边都先折成小写。
 *
 * Exact 与 CaseInsensitive 因此同路：winget 自己在客户端就把要比的值归一化
 * （RequestMatch.Value 的类型就是它的 NormalizedString），到我们这儿已经没有大小写信息了，
 * 这里再分出一套「区分大小写的精确」只会让 `winget install -e` 换个大小写就搜不到。
 * Fuzzy / FuzzySubstring 同理与 Substring 同路 —— 这份源里只有我们自己的包，
 * 模糊匹配没有别的信息可用；不做一套看着像模糊、实际看运气的东西。
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

/* 一个包算不算命中（语义见文件头）。Query 与 Inclusions 都为空＝整个库都是候选，只剩 Filters 收窄。 */
function matchesCriteria(pkg, criteria) {
  const keywordHit = criteria.query
    ? MATCH_FIELDS.some((field) => fieldHit(pkg, { field: field, keyword: criteria.query.keyword, matchType: criteria.query.matchType }))
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
  informationBody: informationBody,
  searchBody: searchBody,
  manifestBody: manifestBody
};
