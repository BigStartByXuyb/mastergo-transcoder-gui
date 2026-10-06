"use strict";

/*
 * 「有任务在跑」这道门禁：跑流水线 / 看板任务时，挡住会影响生效的操作
 * （切 / 回退版本、切 / 回退 Codex 版本、换一份插件、装插件、重启客户端）。
 *
 * 错误码与那句主文案只在这一处 —— 界面按同一个码把「先等它跑完」显示成同一句话；
 * 被挡住的是哪一步、跑着的又是什么，由 hint 说清。每一步自己判断「这一步要不要挡」，
 * 挡的文案与码不各自发明。
 *
 * 运行时那条线例外：它下载运行时只往自己那一层落版本，不换生效的那一份（要换去「用这份」），
 * 所以忙时不抛错、只回一句提示（lib/runtime.js 的 startDownload），界面按提示显示。
 */

const { UserError } = require("./errors.js");

function requireIdle(isBusy, action) {
  const busy = String(isBusy() || "");
  if (!busy) return;
  throw new UserError(
    "RUNNING_TASKS",
    "有任务在跑，先等它结束",
    busy + "；" + String(action || "这一步") + "要等它跑完。"
  );
}

module.exports = { requireIdle };
