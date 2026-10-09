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

// 两句共用的话：去哪解决、权限是什么问题。都只写一遍，下面的 hint 引用它们。
const TOKEN_SETTINGS = "「设置 → MasterGo token」";
const TOKEN_NO_PERMISSION = "token 没有这个文件的权限";

/*
 * 插件自己的话没有机器可读的错误码，只能按它输出里的 ASCII 标记认 —— 中文那部分在不同控制台
 * 编码下会变成乱码（与 lib/resolve-target.js 里认 `dsl.nodes[]` 同一口径）。
 * 能确认的只有一种：它没拿到 token —— 那句既提到 token，又教你从环境变量 / -ConfigPath
 * 怎么给一份；两个标记都要，别的配置类报错（只提到配置文件、不关 token）不许被认成这件事。
 * 其余提到 token 的报错（比如 MasterGo 说这份无效）不走这里：那是真的引擎报错，原样给人看更有用。
 */
const TOKEN_MENTIONED = /\btoken\b/i;

// 「它教你怎么给一份 token」的标记：环境变量名或 -ConfigPath，有一个就算。按字面量找，不拼正则。
function mentionsHowToGive(text) {
  return text.includes(TOKEN_ENV_KEY) || text.includes("ConfigPath");
}

// 缺 token 的说法只有这一份：客户端自己报错用它，插件报的那句也换成它。
const MISSING_TOKEN = {
  code: "NEED_TOKEN",
  message: "缺少 MasterGo token，取不到设计稿",
  hint: "到" + TOKEN_SETTINGS + "里填一次，或设环境变量 " + TOKEN_ENV_KEY + "，或用 --token 启动本工具。"
};

/*
 * 认出「插件没拿到 token」并给出客户端自己的说法 —— 判据与说法都只有这一处，
 * 流水线失败（lib/run.js）与控件查询（lib/resolve-target.js）都来这儿问；不是这件事就回 null。
 * 插件那句讲 -ConfigPath / config.toml 的说明不进界面：这里给的都是人能照做的。
 */
function tokenTrouble(text) {
  const value = String(text == null ? "" : text);
  if (!TOKEN_MENTIONED.test(value)) return null;
  return mentionsHowToGive(value) ? MISSING_TOKEN : null;
}

/*
 * 同一句话的整句形态（原因 + 怎么做），给只有一个字符串字段的地方用（流水线失败就是这种）。
 * 拼法只有这一处：接口那类带 {message, hint} 的地方仍按两段给，界面自己排版。
 */
function tokenTroubleText(text) {
  const trouble = tokenTrouble(text);
  return trouble ? trouble.message + "：" + trouble.hint : "";
}

/* 把 token 并进一份环境：为空就原样返回（让插件按它自己的 config.toml 兜底）。 */
function withToken(env, token) {
  const value = String(token || "").trim();
  if (!value) return env;
  return Object.assign({}, env || {}, { [TOKEN_ENV_KEY]: value });
}

function tokenEnv(token) {
  return withToken(process.env, token);
}

// 缺 token 一律给可照做的提示（去哪配、怎么配），不要丢给子进程拼一句含糊的退出码。
function requireToken(token) {
  const value = String(token || "").trim();
  if (value) return value;
  throw new UserError(MISSING_TOKEN.code, MISSING_TOKEN.message, MISSING_TOKEN.hint);
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

module.exports = {
  withToken, tokenEnv, requireToken, readConfigToken, createTokenSource,
  tokenTrouble, tokenTroubleText, TOKEN_NO_PERMISSION, SOURCE_LABELS,
  TOKEN_ENV_KEY
};
