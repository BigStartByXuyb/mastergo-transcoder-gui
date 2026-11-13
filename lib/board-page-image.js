"use strict";

// A 路线页面位图：等图停点、停点缓存与新建任务暂存件落地。
// 看板只保存任务状态并调用这里，不在这里调度运行或执行合并。

const designImage = require("./design-image.js");
const { failureSentence } = require("./errors.js");
const { modeTakesRoute } = require("./run.js");

const PAGE_IMAGE_LABEL = "页面 PNG";
// 兼容旧 board.json 的冻结字面量：显示名以后可改，历史记录识别不能跟着漂。
const LEGACY_PAGE_IMAGE_STOP_LABEL = "页面 PNG";

/*
 * A 路线读图：任务跑到 done 后，必须先有与 DSL 画板同尺寸的页面 PNG，才允许进入待合并。
 * 这里只看工作目录里的实际输入，不拿 task.designImage 这句提示代替位图事实；
 * 也不把位图缺失败写进 task.error —— 它是可补齐的语义停点。
 */
function stopOf(task, layoutStep) {
  let state;
  try {
    state = designImage.read({ projectRoot: task.workDir, target: task.request.target });
  }
  catch (error) {
    return {
      stepName: layoutStep,
      message: "无法核对" + PAGE_IMAGE_LABEL + "：" + failureSentence(error)
    };
  }
  if (state.matches) return null;
  if (!state.image) {
    return {
      stepName: layoutStep,
      message: task.designImage ||
        "含 A 的路线需要" + PAGE_IMAGE_LABEL + "：按 MasterGo 画板原始尺寸导出一张后在这里上传。"
    };
  }
  if (!state.canvas) {
    return {
      stepName: layoutStep,
      message: "含 A 的路线还不能核对" + PAGE_IMAGE_LABEL + "：" + designImage.NO_CANVAS_REASON +
        "；完成后重新上传" + PAGE_IMAGE_LABEL + "。"
    };
  }
  if (!state.image.width || !state.image.height) {
    return {
      stepName: layoutStep,
      message: PAGE_IMAGE_LABEL + " 读不出尺寸（文件可能坏了）：重新导出成 PNG / JPEG 后再上传。"
    };
  }
  return {
    stepName: layoutStep,
    message: PAGE_IMAGE_LABEL + " 与画板尺寸不一致：" +
      designImage.sizeMismatchText(state.image, state.canvas) +
      "。按原始尺寸重新导出后再上传。"
  };
}

/** 含 A 的路线按工作目录里的位图身份做停点缓存；图片或布局步骤没变时不重复读尺寸。 */
function pipelineStopOf(task, layoutStep, cache) {
  if (!modeTakesRoute(task.request.mode, "A")) {
    cache.delete(task.id);
    return null;
  }
  if (!task.workDir || !task.request.target) {
    cache.delete(task.id);
    return {
      stepName: layoutStep,
      message: "含 A 的路线需要页面 Target 与" + PAGE_IMAGE_LABEL + " 才能合并；请补齐页面身份后重试。"
    };
  }
  let signature;
  try {
    signature = [
      layoutStep,
      task.designImage || "",
      designImage.inputSignature({ projectRoot: task.workDir, target: task.request.target })
    ].join("|");
  }
  catch (error) {
    cache.delete(task.id);
    return {
      stepName: layoutStep,
      message: "无法核对" + PAGE_IMAGE_LABEL + "：" + failureSentence(error)
    };
  }
  const cached = cache.get(task.id);
  if (cached && cached.signature === signature) return cached.stop;
  const stop = stopOf(task, layoutStep);
  cache.set(task.id, { signature: signature, stop: stop });
  return stop;
}

/*
 * 新建任务时先选好的页面 PNG 在流水线产出画板尺寸后落地。
 * 返回 discard / none / result 三种结果；只有 result 会让看板比较并保存 task.designImage。
 */
function stagedNoticeOf(task, home, blocked) {
  if (!modeTakesRoute(task.request.mode, "A")) return { kind: "discard", notice: "" };
  if (!task.workDir || !task.request.target || blocked) return { kind: "none", notice: "" };
  let notice = "";
  try {
    const result = designImage.installStaged({
      home: home,
      taskId: task.id,
      target: task.request.target,
      workDir: task.workDir
    });
    if (result && result.unreadable) {
      notice = "先选的那张" + PAGE_IMAGE_LABEL + " 读不出尺寸（文件可能坏了）：在任务详情里重新传一张。";
    } else if (result && result.mismatch) {
      notice =
        "先选的那张" + PAGE_IMAGE_LABEL + " 与画板尺寸不一致：" +
        designImage.sizeMismatchText(result.mismatch.image, result.mismatch.canvas) +
        "。按原尺寸重新导出后，在任务详情里重新传一张。";
    }
  }
  catch (error) {
    notice = "先选的那张" + PAGE_IMAGE_LABEL + " 落地失败：" + failureSentence(error);
  }
  return { kind: "result", notice: notice };
}

module.exports = {
  LEGACY_PAGE_IMAGE_STOP_LABEL,
  pipelineStopOf,
  stagedNoticeOf
};
