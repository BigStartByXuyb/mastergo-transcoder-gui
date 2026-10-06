"use strict";

/*
 * 一条版本线下载时的编排（程序更新与插件那一半共用）：
 *   syncManifest       远端清单 ↔ 本地清单：算本地清单 → 同内容收进内容库 → 写缓存
 *   createDownloadTask task 生命周期与进度：一次只跑一条 → 下 → 拼 → done / error，收尾由钩子给
 *
 * 边界：不认识「哪一版」也不认识「清单里有什么」；取内容与落盘是 lib/bundle-store.js 的事。
 * 两条线各自特有的部分（每版清单、外壳下限、坏版本记号、装完要不要重新定位）由调用方给：
 * syncManifest 收 localManifest，createDownloadTask 收 skipIf / onSuccess / busyError。
 */

const { UserError, toFailure } = require("./errors.js");
const { diffManifests } = require("./app-manifest.js");

/*
 * 远端清单 ↔ 本地清单：本地已有的同内容直接收进内容库（换版本时只下变了的），
 * 再把清单与差分结果写进缓存（离线也能显示「有新版 / 改了几个文件」）。
 */
function syncManifest(options) {
  const local = options.localManifest();
  if (local.dir) options.store.seedFrom(local.dir, local.manifest, options.remote);
  options.cache.write(options.remote, diffManifests(local.manifest, options.remote));
  return local;
}

function createDownloadTask(options) {
  const opts = options || {};
  const store = opts.store;
  const fetchBlob = opts.fetchBlob;
  // 这两样是每条线自己的语义，必须由调用方给：本地那份算不算「已经有」、下完要收什么尾。
  const skipIf = opts.skipIf;
  const onSuccess = opts.onSuccess;
  const busyError = opts.busyError || new UserError("BUSY_DOWNLOAD", "已经在下载了", "等这一次下载结束。");

  let task = { phase: "idle", done: 0, total: 0, downloaded: 0, error: null };
  let running = null;

  /*
   * 起一条下载：已经在跑就按 busyError 拒；本地已有就早退；否则后台跑，进度写进 task。
   * 调用方立刻拿到结果，往后的进度与成败读 task()。
   */
  function start(manifest) {
    if (running) throw busyError;
    if (skipIf(manifest)) {
      task = { phase: "done", done: 0, total: 0, downloaded: 0, error: null };
      return { started: false, version: manifest.version, reason: "本地已经有这一版" };
    }
    task = { phase: "downloading", done: 0, total: 0, downloaded: 0, error: null };
    running = store
      .materialize(manifest, function (hash) { return fetchBlob(manifest, hash); }, function (progress) {
        task.done = progress.done;
        task.total = progress.total;
        task.downloaded = progress.downloaded;
        task.phase = progress.done >= progress.total ? "materializing" : "downloading";
      })
      .then(function (result) {
        task = { phase: "done", done: task.done, total: task.total, downloaded: result.downloaded, error: null };
        onSuccess(manifest, result);
        return result;
      })
      .catch(function (error) {
        task = {
          phase: "error",
          done: task.done,
          total: task.total,
          downloaded: task.downloaded,
          error: toFailure(error)
        };
      })
      .finally(function () {
        running = null;
      });
    return { started: true, version: manifest.version, reason: "" };
  }

  return {
    start: start,
    running: function () { return Boolean(running); },
    task: function () { return task; }
  };
}

module.exports = { syncManifest, createDownloadTask };
