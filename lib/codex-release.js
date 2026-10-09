'use strict';

/*
 * Codex 发行版描述：把 GitHub Release 的资产折算成一份「清单 + 来源」。
 *
 * 清单（files）里要落盘的是 exe 本体，哈希取自同一 release 里**未压缩**的 .exe 资产 ——
 * 客户端因此能对解压后的字节做内容校验；来源（sources）给出对应的 .zst 资产与它自己的哈希。
 *
 * 谁在用：lib/codex.js 的检查版本与按需下载。
 * 边界：只描述 Windows x64（x86_64-pc-windows-msvc）这一条渠道；只拼清单，不下载、不落盘。
 */

const { UserError } = require('./errors.js');

const REPO = 'openai/codex';
const CHANNEL = 'x86_64-pc-windows-msvc';

// 一个能跑的 codex：主程序 + 它同目录调用的三个兄弟程序。
const BINARIES = ['codex', 'codex-command-runner', 'codex-code-mode-host', 'codex-windows-sandbox-setup'];

function releaseUrl(tag) {
  return tag
    ? 'https://api.github.com/repos/' + REPO + '/releases/tags/' + tag
    : 'https://api.github.com/repos/' + REPO + '/releases/latest';
}

function assetName(binary, suffix) {
  return binary + '-' + CHANNEL + '.exe' + suffix;
}

// GitHub 的资产摘要形如 sha256:<64 位十六进制>；不是这个形状就当没有。
function digestOf(asset) {
  const hit = /^sha256:([0-9a-f]{64})$/.exec(String((asset && asset.digest) || ''));
  return hit ? hit[1] : '';
}

// tag 形如 rust-v<版本>；版本号取 tag 里 -v 之后那一段。
function versionOfTag(tag) {
  const hit = /-v([0-9][^/]*)$/.exec(String(tag || ''));
  if (!hit) throw new UserError('BAD_TAG', '这个 release 的 tag 不是 rust-v<版本> 的形状', String(tag || ''));
  return hit[1];
}

/*
 * release → {version, tag, files, sources, missing}
 *   files   相对版本目录的路径（如 codex.exe） → 解压后字节的 sha256
 *   sources 同一路径 → {asset, sha256, url}（压缩包本身与它的哈希）
 *   missing 这个 release 里缺资产的程序名（缺 codex 本体直接抛错）
 */
function describeRelease(release) {
  const tag = String((release && release.tag_name) || '');
  const assets = Array.isArray(release && release.assets) ? release.assets : [];
  const byName = new Map(assets.map(function (asset) { return [String(asset.name || ''), asset]; }));
  const files = {};
  const sources = {};
  const missing = [];

  for (const binary of BINARIES) {
    const packed = byName.get(assetName(binary, '.zst'));
    const rawHash = digestOf(byName.get(assetName(binary, '')));
    const packedHash = digestOf(packed);
    if (!rawHash || !packedHash) {
      missing.push(binary);
      continue;
    }
    const name = binary + '.exe';
    files[name] = rawHash;
    sources[name] = {
      asset: assetName(binary, '.zst'),
      sha256: packedHash,
      url: 'https://github.com/' + REPO + '/releases/download/' + tag + '/' + assetName(binary, '.zst')
    };
  }

  if (!files['codex.exe']) {
    throw new UserError('NO_CODEX_ASSET', '这个 release 里没有 Windows x64 的 codex 程序', tag);
  }
  return { version: versionOfTag(tag), tag, files, sources, missing };
}

// tag 为空取最新一版；给了 tag 就取那一版（回退到已知能跑的那版时用）。
async function fetchRelease(options) {
  const opts = options || {};
  const release = await opts.fetchJson(releaseUrl(String(opts.tag || '')), {
    fetchImpl: opts.fetchImpl,
    attempts: opts.attempts || 2,
    timeoutMs: opts.timeoutMs || 15000,
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'mastergo-transcoder-gui' }
  });
  return describeRelease(release);
}

module.exports = { describeRelease, fetchRelease, versionOfTag };
