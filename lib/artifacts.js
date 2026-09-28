"use strict";

/*
 * 产物台账：把这次运行真正落到工程里的东西列出来，供「已完成」看板用。
 *
 * 数据源是插件自己的运行登记表 Generated/runs/<Target>/run.json 的 outputs ——
 * 每条带 kind（project / audit / work / backup）、exists、sha256。
 * 界面不自己扫目录：哪些算产物、哪些是中间件，以插件登记为准。
 */

const fs = require("fs");
const path = require("path");

const { UserError } = require("./errors.js");

function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  catch {
    return null;
  }
}

function createArtifacts() {
  function read(query) {
    const projectRoot = String(query.projectRoot || "").trim();
    const target = String(query.target || "").trim();
    if (!projectRoot || !target) throw new UserError("NEED_PROJECT", "缺少工程目录或页面 Target", "");

    const generated = path.join(projectRoot, "Generated");
    const run = readJsonIfExists(path.join(generated, "runs", target, "run.json"));
    if (!run) {
      return { available: false, reason: "还没有这页的运行登记表（流水线尚未跑到第 1 步）" };
    }

    const entries = Object.entries(run.outputs ?? {}).map(([file, info]) => ({
      file: file,
      kind: String(info?.kind ?? ""),
      exists: info?.exists === true,
      sha256: info?.sha256 ?? null,
      dependsOn: info?.dependsOn ?? null
    }));
    const alive = entries.filter((item) => item.exists);

    const summary = readJsonIfExists(path.join(generated, target + ".summary.json"));
    return {
      available: true,
      runId: String(run.runId ?? ""),
      mode: String(run.identity?.mode ?? ""),
      updatedAt: String(run.updatedAt ?? ""),
      // 真正进项目的产物 / 审计件 / 备份数量 / 已被清理的中间件
      project: alive.filter((item) => item.kind === "project"),
      audit: alive.filter((item) => item.kind === "audit"),
      backupCount: alive.filter((item) => item.kind === "backup").length,
      cleanedCount: entries.filter((item) => item.kind === "work" && !item.exists).length,
      summary: summary
        ? {
            generatedAt: summary.generatedAt ?? "",
            page: summary.page ?? null,
            pageProduct: summary.pageProduct ?? null,
            todos: summary.todos ?? [],
            notices: summary.notices ?? []
          }
        : null
    };
  }

  return { read };
}

module.exports = { createArtifacts };
