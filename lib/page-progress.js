"use strict";

/*
 * 「这一页推进到哪儿」的唯一口径：插件自己的运行登记表 Generated/runs/<Target>/run.json。
 *
 * 登记表是这一页**跨多次运行**的合并记录（续跑接着写同一份），所以它同时回答两件事：
 *   1. 这一页跑完了没有 —— 步骤数达到插件契约，且全部 ok；
 *   2. 没跑完时从哪一步续 —— 第一条没跑成的步骤（failed，或还没跑到）。
 * 运行管理器里的 job 只在进程内存里：客户端重启过、旧 job 被挤掉，查询就落空。
 * 登记表在磁盘上，所以长期口径只能是它。
 */

function isComplete(registered, total) {
  const steps = Array.isArray(registered) ? registered : [];
  if (!Number.isFinite(total) || total <= 0) return false;
  if (steps.length < total) return false;
  return steps.every(function (step) { return step.status === "ok"; });
}

function resumeStepOf(registered) {
  const steps = Array.isArray(registered) ? registered : [];
  return steps.find(function (step) { return step.status !== "ok"; }) || null;
}

/*
 * 生成 Bundle 清单的那一步：契约里 Outputs 写着 <Target>.bundle.json 的那一步。
 *
 * 为什么续跑要认识它：安全阀是那一步写进清单的 —— 已有这一页时，-Overwrite 会喂成
 * operation=replace-existing。从更晚的一步续跑会拿旧清单再撞一次「同名目标文件已存在」。
 */
function bundleManifestStep(contract) {
  const steps = Array.isArray(contract) ? contract : [];
  const hit = steps.find(function (step) {
    return (step.Outputs || []).some(function (item) { return String(item).includes(".bundle.json"); });
  });
  return hit ? String(hit.Name) : "";
}

module.exports = { isComplete, resumeStepOf, bundleManifestStep };
