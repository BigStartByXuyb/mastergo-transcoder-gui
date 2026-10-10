"use strict";

// 待确认队列：列出**当前所有还缺语义输入的页面**，不区分它从哪儿发起。
//
// 真值源只有一个：插件自己产出的待确认清单（待命名候选 / 待译文案 / 待补术语）与
// 「有设计稿位图但没有分组表」这条布局确认（lib/pending.js 的 layout 一节）。
// 这里只做两件事：把这些清单逐个读一遍，并且按「工程目录 + Target」去重 ——
// 因为同一个页面可能被「流水线」页直跑过、也被看板跑过，那是两份工作目录、两条记录。
//
// 一条都不需要你填的页面不列出来：列表只放真的有东西要填的。

const { stateLabelOf } = require("./board.js");

function createPendingQueue(deps) {
  const runs = deps.runs;
  const board = deps.board;
  const pending = deps.pending;

  function inspectEntry(entry) {
    let info = null;
    try {
      info = pending.inspect({ projectRoot: entry.projectRoot, target: entry.target });
    }
    catch {
      return null;
    }
    const icons = info.icons || {};
    const texts = info.translations || {};
    const layout = info.layout || {};
    /*
     * 「这一页要不要人填」只看三节各自的 waiting：口径在 lib/pending.js 算一次
     * （图标那节还含命名表写歪的旧下标与重名组），这里不再拿 needsXxx 重算一遍。
     * 三项与看板、流水线详情同形：图标一节、文案一节、布局一节。
     */
    const counts = {
      icons: icons.waiting ?? 0,
      translations: texts.waiting ?? 0,
      layout: layout.waiting ?? 0
    };
    const total = counts.icons + counts.translations + counts.layout;
    if (total === 0) return null;
    return {
      source: entry.source,
      projectRoot: entry.projectRoot,
      target: entry.target,
      runId: entry.runId || "",
      taskId: entry.taskId || "",
      runState: entry.runState || "",
      // 状态名只在 lib/board.js 的 stateLabelOf 一处映射（看板任务与运行的状态都在那一份里），界面不自己抄。
      stateLabel: stateLabelOf(entry.runState || ""),
      orphan: entry.orphan === true,
      counts: counts,
      total: total
    };
  }

  function snapshot() {
    const tasks = board ? board.snapshot().tasks : [];
    const workRoot = board ? String(board.workRoot || "").toLowerCase() : "";
    const byWorkDir = new Map();
    for (const task of tasks) {
      if (task.workDir) byWorkDir.set(task.workDir.toLowerCase(), task);
    }

    const candidates = [];
    for (const task of tasks) {
      if (!task.workDir) continue;
      candidates.push({
        source: "board",
        projectRoot: task.workDir,
        target: task.request.target,
        runId: task.jobId,
        taskId: task.id,
        runState: task.state
      });
    }
    for (const job of runs.list()) {
      const root = String(job.projectRoot);
      const task = byWorkDir.get(root.toLowerCase());
      // 看板任务被移除、工作目录还在的条目一样算看板来源：按路径判，不按任务表判。
      const fromBoard = Boolean(task) || (workRoot !== "" && root.toLowerCase().startsWith(workRoot));
      candidates.push({
        source: fromBoard ? "board" : "pipeline",
        projectRoot: job.projectRoot,
        target: job.target,
        runId: job.id,
        taskId: task ? task.id : "",
        runState: job.state,
        orphan: fromBoard && !task
      });
    }

    const seen = new Set();
    const items = [];
    for (const entry of candidates) {
      const key = entry.projectRoot.toLowerCase() + "\u0000" + entry.target;
      if (seen.has(key)) continue;
      seen.add(key);
      const item = inspectEntry(entry);
      if (item) items.push(item);
    }
    items.sort(function (left, right) {
      if (right.total !== left.total) return right.total - left.total;
      return left.target.localeCompare(right.target);
    });
    return { items: items };
  }

  return { snapshot };
}

module.exports = { createPendingQueue };
