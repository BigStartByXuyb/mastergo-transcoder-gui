"use strict";

// MasterGo token 的三件事只在这里一份：从哪取、怎么进子进程、缺了怎么报。
// 取到的值只经环境变量交给子进程：不进命令行（进程列表可见），也不落任何产物。

const fs = require("fs");
const path = require("path");

const { UserError } = require("./errors.js");

const TOKEN_ENV_KEY = "MASTERGO_MCP_TOKEN";

const SOURCE_LABELS = {
  cli: "启动参数 --token",
  env: "环境变量 " + TOKEN_ENV_KEY,
  saved: "本机保存",
  config: "~/.codex/config.toml"
};

function tokenEnv(token) {
  const value = String(token || "").trim();
  if (!value) return process.env;
  return Object.assign({}, process.env, { [TOKEN_ENV_KEY]: value });
}

// 缺 token 一律给可照做的提示（去哪配、怎么配），不要丢给子进程拼一句含糊的退出码。
function requireToken(token) {
  const value = String(token || "").trim();
  if (value) return value;
  throw new UserError(
    "NEED_TOKEN",
    "缺少 MasterGo token，取不到设计稿",
    "到「设置 → MasterGo token」里填一次，或设环境变量 " + TOKEN_ENV_KEY + "，或用 --token 启动本工具。"
  );
}

// 插件早先的配置位置也认：~/.codex/config.toml 里那行 --token=mg_xxx。
function readConfigToken(home) {
  try {
    const hit = /--token=(mg_[A-Za-z0-9_\-]+)/.exec(fs.readFileSync(path.join(home, "config.toml"), "utf8"));
    return hit ? hit[1] : "";
  }
  catch {
    return "";
  }
}

/*
 * 取值顺序只有这一处：启动参数 > 环境变量 > 本机保存 > ~/.codex/config.toml。
 * 每次现算 —— 设置页保存后立刻按新值走，不用重启客户端。
 */
function createTokenSource(options) {
  const cli = String(options.cli || "").trim();
  const home = options.home || "";
  const settings = options.settings || null;

  function pick() {
    if (cli) return { value: cli, source: "cli" };
    const env = String(process.env[TOKEN_ENV_KEY] || "").trim();
    if (env) return { value: env, source: "env" };
    const saved = settings ? String(settings.readMastergoToken() || "").trim() : "";
    if (saved) return { value: saved, source: "saved" };
    const config = readConfigToken(home);
    if (config) return { value: config, source: "config" };
    return { value: "", source: "" };
  }

  return {
    value: function () { return pick().value; },
    source: function () { return pick().source; }
  };
}

module.exports = { tokenEnv, requireToken, readConfigToken, createTokenSource, SOURCE_LABELS };
