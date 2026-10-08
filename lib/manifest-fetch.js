"use strict";

/*
 * 远端清单这一套，两块：
 *   createManifestFetch  源与凭据每次现取 → 按发布源拼清单地址 → 带重试与超时地取 → 校验「是清单形状」
 *   createManifestCache  把取回来的清单与差分结果留下来（离线也能显示上次的结果）
 *
 * 谁在用：程序更新（lib/update.js）与插件那一半（lib/plugin-update.js）—— 两条版本线取的是同一套协议，
 * 只有清单名不同。超时、重试次数、请求头、地址拼法、缓存文件形状都在这一处，两边不会各定一套口径。
 * 边界：只跟「清单」打交道（取回来、存下来）；差分、下载与落盘留在各自的模块里。
 */

const fs = require("fs");
const path = require("path");

const { UserError } = require("./errors.js");
const { fetchJson } = require("./download.js");
const { getterOf } = require("./getter.js");
const source = require("./source.js");

// 取清单的重试与超时；缓存目录名两条线共用（各自落在自己的根下）。
const TIMEOUT_MS = 15000;
const ATTEMPTS = 2;
const CACHE_DIR = "update-cache";
/*
 * 两条更新线（客户端本体、插件）共用的复查节拍：启动时查一次，之后每这么久静默复查一次。
 * 节拍只有这一处 —— 两条线各写一个数就会出现「一条会自己发现新版、另一条不会」。
 */
const RECHECK_MS = 10 * 60 * 1000;

/*
 * 后台复查那一半（启动时查一次由各自的装配处做）：每 RECHECK_MS 静默查一次。
 * 这里连「起过就不再起」与 unref 一起管 —— 两条线各写一份的话，这类细节迟早只改一边。
 * isBusy 为真时跳过这一轮（正在下载 / 装：那一轮的结果马上会被顶掉，白问一次）。
 */
function createRecheck(options) {
  const opts = options || {};
  let timer = null;
  return function start() {
    if (timer) return;
    timer = setInterval(function () {
      if (opts.isBusy()) return;
      void opts.check();
    }, RECHECK_MS);
    if (typeof timer.unref === "function") timer.unref();
  };
}

function createManifestFetch(options) {
  const opts = options || {};
  const fetchImpl = opts.fetchImpl || fetch;
  const name = opts.manifestName || source.MANIFEST_NAME;
  /*
   * 源与 token 都现取：设置里改完不重启客户端也要按新的走（与 MasterGo token 的取值链同一口径）。
   * 默认值只有 lib/source.js 一处；这里的入参只用来给测试注入固定值。
   */
  const sourceOf = getterOf(opts.source, null);
  const tokenOf = getterOf(opts.token);
  /*
   * 有没有凭据：装配处可以注入一份廉价判断（程序更新与插件那一半都注入「设置里记的那个标记」，
   * 不在轮询路径上解密）；没注入时才顺着 token 取值链问一次。
   * 「注入优先、否则回落」这一句只有这里一份 —— 两条版本线各自读同一处，不各写一遍三元。
   */
  const hasTokenOf = typeof opts.hasToken === "function"
    ? opts.hasToken
    : function () { return Boolean(String(tokenOf() || "").trim()); };

  function currentSource() {
    return source.normalizeSource(sourceOf());
  }

  // 私有源（私有 GitHub / 私有 GitLab）带 creds：没有 token 就是 null，公开源不受影响。
  function headers() {
    return source.requestHeaders(currentSource(), tokenOf());
  }

  function url() {
    return source.manifestUrl(currentSource(), name);
  }

  /*
   * 按地址取一份清单：重试、超时、请求头与形状校验都在这一处。
   * fetchManifest 取最新那份；fetchFrom 给「按某一版的地址取」用（程序更新下历史版本）。
   */
  async function fetchFrom(manifestUrl) {
    const remote = await fetchJson(manifestUrl, {
      fetchImpl: fetchImpl,
      attempts: ATTEMPTS,
      timeoutMs: TIMEOUT_MS,
      headers: headers()
    });
    if (!remote || !remote.version || !remote.files || typeof remote.files !== "object") {
      throw new UserError("BAD_MANIFEST", "远端清单不是清单格式", manifestUrl);
    }
    return remote;
  }

  // 取最新那份清单：形状不对就当错误抛（要不要落成界面上的失败原因由调用方决定）。
  function fetchManifest() {
    return fetchFrom(url());
  }

  // 给界面看的那一份描述：现在会去哪个地址取这一份清单。
  function describe() {
    return source.describeSource(currentSource(), name);
  }

  /* 有没有凭据（注入的那份，或顺着 token 取值链问一次）。与取值分开：取那个值要走 DPAPI 解密。 */
  function hasToken() {
    return Boolean(hasTokenOf());
  }

  return {
    currentSource: currentSource,
    hasToken: hasToken,
    headers: headers,
    fetchManifest: fetchManifest,
    fetchFrom: fetchFrom,
    describe: describe
  };
}

/*
 * 上一次拉到的清单与差分：{checkedAt, manifest, diff}。
 * 请求失败时界面还能显示「有新版 / 改了几个文件」，所以这份缓存不是可选的。
 *
 * 缓存里记着**这份结果是哪个源给的**（source 注入的取值链，与取清单那边同一个键名）：源换过之后，旧源那份就不算数 ——
 * 否则换了源（比如插件改成它自己的仓库）还会照旧显示「已是最新」，而那已经不是现在这个源的结论。
 */
function createManifestCache(options) {
  const opts = options || {};
  const now = opts.now || function () { return new Date().toISOString(); };
  // 源可以给值，也可以给取值函数（两条线都是后一种）：归一方式与取清单那边同一处（lib/getter.js）。
  const sourceOf = getterOf(opts.source);
  // 清单名与取清单那边用同一个键名（manifestName）：同一个概念不两套叫法。
  const file = path.join(path.resolve(opts.dir), opts.manifestName || source.MANIFEST_NAME);

  // 源的身份就是类型 + 基址（地址怎么拼是 source.js 的事，这里只比「是不是同一个源」）。
  function sourceKey() {
    const current = source.normalizeSource(sourceOf());
    return current.kind + " " + current.base;
  }

  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!parsed || !parsed.manifest || !parsed.manifest.files) return null;
      // 没记来源的老缓存（升级上来的）当作对不上：宁可显示「还没检查过」，也不拿别的源的结果顶。
      if (String(parsed.source || "") !== sourceKey()) return null;
      return parsed;
    }
    catch {
      return null;
    }
  }

  function write(manifest, diff) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ checkedAt: now(), source: sourceKey(), manifest: manifest, diff: diff }, null, 2) + "\n",
      "utf8"
    );
  }

  return { read: read, write: write };
}

/*
 * 缓存 → 界面摘要里两条线共有的那几项：版本、发布时间、改了几个文件、上次检查时间。
 * 各自特有的（外壳下限、这一版改了什么、插件的 tag）由调用方往上加。
 */
function summarizeCache(cached) {
  if (!cached) return null;
  return {
    version: cached.manifest.version,
    releasedAt: String(cached.manifest.releasedAt || ""),
    changed: ((cached.diff || {}).changed || []).length,
    removed: ((cached.diff || {}).removed || []).length,
    total: ((cached.diff || {}).total || 0),
    checkedAt: String(cached.checkedAt || "")
  };
}

module.exports = { createManifestFetch, createManifestCache, summarizeCache, createRecheck, CACHE_DIR };

