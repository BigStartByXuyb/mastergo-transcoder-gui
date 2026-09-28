"use strict";

/*
 * 并发额度。
 *
 * 一个任务 = 一条 run-all.ps1 路线，底下是 pwsh + 若干 node 子进程，绝大多数时间在等
 * MCP、网络和磁盘。额度取「逻辑核数的一半」并夹在 1..4：核少的机器不被排队压死，
 * 核多的机器也不至于开出一堆互相抢 IO 的流水线。
 */

const os = require("os");

function logicalCores() {
  return Math.max(1, os.cpus().length);
}

function parallelism(logical) {
  const cores = Number.isFinite(logical) && logical > 0 ? Math.floor(logical) : logicalCores();
  return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}

module.exports = { logicalCores, parallelism };
