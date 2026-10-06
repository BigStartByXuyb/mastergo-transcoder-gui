"use strict";

/*
 * 取远端清单这一套：源与凭据每次现取 → 按发布源拼清单地址 → 带重试与超时地取 → 校验「是清单形状」。
 *
 * 谁在用：程序更新（lib/update.js）与插件那一半（lib/plugin-update.js）—— 两条版本线取的是同一套协议，
 * 只有清单名不同。超时、重试次数、请求头与地址拼法都在这一处，两边不会各定一套取件口径。
 * 边界：只把清单取回来并校验形状；缓存、差分、下载与落盘留在各自的模块里。
 */

const { UserError } = require("./errors.js");
const { fetchJson } = require("./download.js");
const source = require("./source.js");

// 取清单的重试与超时；缓存目录名两条线共用（各自落在自己的根下）。
const TIMEOUT_MS = 15000;
const ATTEMPTS = 2;
const CACHE_DIR = "update-cache";

function createManifestFetch(options) {
  const opts = options || {};
  const fetchImpl = opts.fetchImpl || fetch;
  const name = opts.manifestName || source.MANIFEST_NAME;
  /*
   * 源与 token 都现取：设置里改完不重启客户端也要按新的走（与 MasterGo token 的取值链同一口径）。
   * 默认值只有 lib/source.js 一处；这里的入参只用来给测试注入固定值。
   */
  const sourceOf = typeof opts.source === "function" ? opts.source : function () { return opts.source || null; };
  const tokenOf = typeof opts.token === "function" ? opts.token : function () { return opts.token || ""; };

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

  return {
    currentSource: currentSource,
    token: tokenOf,
    headers: headers,
    fetchManifest: fetchManifest,
    fetchFrom: fetchFrom,
    describe: describe
  };
}

module.exports = { createManifestFetch, CACHE_DIR };
