"use strict";

/*
 * 下载：带超时与重试的 GET，返回 Buffer。
 *
 * 谁在用：lib/bundle-store.js 拉缺失的文件（程序更新、运行时与 agent 按需下载共用）。
 * 边界：只管把字节取回来；校验哈希、落盘、切指针都在 bundle-store。
 * fetchImpl 与 headers 可注入 —— 测试不联网；GitHub API 需要自己的 accept / user-agent。
 * onProgress 可选：给了就边读边报累计字节与总长（运行时那一个大包要出进度条）。
 */

const { UserError } = require("./errors.js");

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 400;

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function isPermanent(error) {
  // 4xx 重试没用：远端明确说了没有或不让拿。
  return Boolean(error && error.userFacing && /^HTTP_4\d\d$/.test(String(error.code)));
}

// 总长只在真的能给的时候才报：内容被压过的话 content-length 是压缩前的长度，按它对不上。
function contentLength(response) {
  const headers = response.headers;
  if (!headers || typeof headers.get !== "function") return 0;
  if (headers.get("content-encoding")) return 0;
  return Number(headers.get("content-length")) || 0;
}

/*
 * 读响应体。没有可读流（假实现、老引擎）或不需要进度时一次取回，行为与从前一致。
 */
async function readBody(response, onProgress) {
  const body = response.body;
  if (!onProgress || !body || typeof body.getReader !== "function") {
    return Buffer.from(await response.arrayBuffer());
  }
  const size = contentLength(response);
  const reader = body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    chunks.push(Buffer.from(step.value));
    received += step.value.length;
    onProgress(received, size);
  }
  return Buffer.concat(chunks);
}

async function fetchBuffer(url, options) {
  const opts = options || {};
  const fetchImpl = opts.fetchImpl || fetch;
  const attempts = Math.max(1, Number(opts.attempts) || DEFAULT_ATTEMPTS);
  const timeoutMs = Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const backoffMs = Number(opts.backoffMs) || DEFAULT_BACKOFF_MS;
  const headers = opts.headers || null;
  let last = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        redirect: "follow",
        ...(headers ? { headers: headers } : {})
      });
      if (!response.ok) {
        throw new UserError("HTTP_" + response.status, "下载失败（HTTP " + response.status + "）", url);
      }
      return await readBody(response, opts.onProgress || null);
    }
    catch (error) {
      last = error;
      if (isPermanent(error)) break;
      if (attempt < attempts) await sleep(backoffMs * attempt);
    }
    finally {
      clearTimeout(timer);
    }
  }
  if (last && last.userFacing) throw last;
  throw new UserError("DOWNLOAD_FAILED", "下载失败", url + "：" + String((last && last.message) || last));
}

async function fetchJson(url, options) {
  const buffer = await fetchBuffer(url, options);
  try {
    return JSON.parse(buffer.toString("utf8"));
  }
  catch {
    throw new UserError("BAD_JSON", "远端返回的不是合法 JSON", url);
  }
}

module.exports = { fetchBuffer, fetchJson };
