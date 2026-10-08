"use strict";

/*
 * 两条更新线（客户端本体、插件）共用的后台复查：启动时的那一次由各自的装配处做，这里管「之后每 10 分钟
 * 静默查一次」。节拍、起过就不再起、unref、忙时跳过都只有这一处 —— 各写一份的话，这类细节迟早只改一边，
 * 表现就是「一条会自己发现新版、另一条不会」。
 *
 * 边界：只调度，不问「查什么」（check 由调用方给）、也不碰清单与来源（那是 lib/manifest-fetch.js 的事）。
 */

const RECHECK_MS = 10 * 60 * 1000;

function createRecheck(options) {
  const opts = options || {};
  let timer = null;
  return function start() {
    if (timer) return;
    timer = setInterval(function () {
      // 正在下载 / 装的那一轮不去问远端：结果马上会被顶掉，白问一次。
      if (opts.isBusy()) return;
      void opts.check();
    }, RECHECK_MS);
    if (typeof timer.unref === "function") timer.unref();
  };
}

module.exports = { createRecheck };
