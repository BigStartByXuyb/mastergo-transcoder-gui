"use strict";

// MasterGo token 的两件事只在这里一份：怎么进子进程、缺了怎么报。
// token 只走环境变量：不进命令行（进程列表可见），也不落任何产物。

const { UserError } = require("./errors.js");

const TOKEN_ENV_KEY = "MASTERGO_MCP_TOKEN";

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
    "在 ~/.codex/config.toml 里配置 mastergo MCP token，或设环境变量 " + TOKEN_ENV_KEY + "，或用 --token 启动本工具。"
  );
}

module.exports = { tokenEnv, requireToken };
