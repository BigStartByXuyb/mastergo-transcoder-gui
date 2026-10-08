"use strict";

/*
 * 用户设置与模型凭据。
 *
 *   local.json            非密设置（厂商 / base_url / 模型 / 自动化层级 / 参考源 / 指定的插件目录）
 *   credentials           模型 API key —— 经 Windows DPAPI（CurrentUser）加密后存这里
 *   mastergo-credentials  MasterGo token —— 同一套 DPAPI 加密
 *
 * 厂商表只放**核实过**的默认值：只列 DeepSeek（取自本机 ~/.codex/config.toml 的
 * model_providers.deepseek），其余走「自定义」。宁缺毋滥——写错的默认值比没有默认值更坑。
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { UserError } = require("./errors.js");
const { childOutputDetail, DETAIL_LIMITS } = require("./ansi.js");
const { resolvePwsh } = require("./plugin.js");
const source = require("./source.js");

const DPAPI_SCRIPT = path.join(__dirname, "dpapi.ps1");

const PROVIDERS = [
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" }
];

const AUTOMATION = ["off", "assist", "auto"];

/*
 * 参考源：一份「代码库清单 + 系统提示词」的成套配置，可以存多份，每条对话选一份生效。
 * 参考源与对话的关系记在对话上（chats.json 的 templateId），这里只管参考源本身。
 */
function normalizeTemplate(item, fallbackId) {
  const raw = item && typeof item === "object" ? item : {};
  return {
    id: String(raw.id || fallbackId || "t1"),
    name: String(raw.name || "").trim() || "未命名参考源",
    systemPrompt: String(raw.systemPrompt || ""),
    codebases: normalizeCodebases(raw.codebases)
  };
}

function normalizeTemplates(value) {
  const list = (Array.isArray(value) ? value : []).map(function (item, index) {
    return normalizeTemplate(item, "t" + (index + 1));
  });
  if (list.length) return list;
  // 还没有参考源时给一份空的，界面上就不会出现「一个都没有」的死角。
  return [{ id: "t1", name: "默认", systemPrompt: "", codebases: [] }];
}

/*
 * 代码库清单：用户自己填「哪个目录是什么库」，随每次提问一起给 AI（见 lib/agent-context.js）。
 * 只留路径 / 名称 / 说明 / 启停四样；路径不做存在性校验 —— 库可能在别的盘、也可能是别人交过来的。
 */
function normalizeCodebases(value) {
  return (Array.isArray(value) ? value : [])
    .map(function (item) {
      const raw = item && typeof item === "object" ? item : {};
      return {
        path: String(raw.path || "").trim(),
        name: String(raw.name || "").trim(),
        note: String(raw.note || "").trim(),
        enabled: raw.enabled !== false
      };
    })
    .filter(function (item) { return item.path; });
}

/*
 * 读参考源。用户机器上可能还留着上一版平铺的「系统提示词 + 代码库清单」：
 * 那份非空而参考源还没有时，就地当成一份「默认」参考源用 —— 不清掉人家配好的东西。
 */
function readTemplates(raw) {
  if (Array.isArray(raw.templates) && raw.templates.length) return normalizeTemplates(raw.templates);
  const legacyPrompt = String((raw.agent && raw.agent.systemPrompt) || "");
  const legacyBases = normalizeCodebases(raw.codebases);
  if (legacyPrompt.trim() || legacyBases.length) {
    return [{ id: "t1", name: "默认", systemPrompt: legacyPrompt, codebases: legacyBases }];
  }
  return normalizeTemplates([]);
}

function readActiveTemplateId(raw) {
  const templates = readTemplates(raw);
  const wanted = String(raw.activeTemplateId || "");
  return templates.some(function (item) { return item.id === wanted; }) ? wanted : templates[0].id;
}

/* 安装包镜像基址：只认 http(s)（内网也要能 HTTP 取，共享盘客户端取不了），其余一律当没填。 */
function normalizeMirror(value) {
  const base = String(value || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  return /^https?:\/\//i.test(base) ? base : "";
}

function dpapi(mode, text) {
  /*
   * 加解密要一份 PowerShell：优先用客户端自带那份；这台机器上还没有时用系统上的 pwsh 顶上。
   * 这里是有意的例外 —— 设置页正是用来下载自带那份的地方，卡在这里就等于「要装 pwsh 才能存 token、
   * 要存 token 才能进设置页」。它只用来加解密本机凭据，不参与「跑流水线用哪一份」（那份归 lib/runtime.js）。
   */
  const pwsh = resolvePwsh() || "pwsh";
  const result = spawnSync(pwsh, ["-NoProfile", "-File", DPAPI_SCRIPT, "-Mode", mode], {
    input: text,
    encoding: "utf8",
    timeout: 30000
  });
  if (result.status !== 0) {
    throw new UserError("DPAPI", "凭据加解密失败", childOutputDetail(result, DETAIL_LIMITS.hint));
  }
  return result.stdout;
}

function createSettings(home) {
  const settingsPath = path.join(home, "local.json");
  const credentialsPath = path.join(home, "credentials");
  const mastergoPath = path.join(home, "mastergo-credentials");
  // 私有发布源（私有 GitHub / 私有 GitLab）的只读 token：与其它凭据一样 DPAPI 加密存本机。
  const sourceTokenPath = path.join(home, "source-credentials");

  function readRaw() {
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
      return {};
    }
  }

  function hasKey() {
    try {
      return fs.readFileSync(credentialsPath, "utf8").trim().length > 0;
    }
    catch {
      return false;
    }
  }

  function hasMastergoToken() {
    try {
      return fs.readFileSync(mastergoPath, "utf8").trim().length > 0;
    }
    catch {
      return false;
    }
  }

  function hasSourceToken() {
    try {
      return fs.readFileSync(sourceTokenPath, "utf8").trim().length > 0;
    }
    catch {
      return false;
    }
  }

  /*
   * 给更新模块用：解出来给请求头；没存过就空串（公开源不需要）。
   * 解出来的值缓存在内存 —— 解密是同步起一次 PowerShell，而下载时每个文件都要用它拼请求头，
   * 每次都解会把单线程的事件循环整段堵住。改动或清除 token 时把缓存置空，下一次重新解。
   */
  let sourceTokenCache = null;
  function readSourceToken() {
    if (sourceTokenCache !== null) return sourceTokenCache;
    try {
      sourceTokenCache = dpapi("unprotect", fs.readFileSync(sourceTokenPath, "utf8"));
    }
    catch {
      /*
       * 解密失败不写缓存：这一次就当没有凭据，下一次重新解。
       * 把失败也缓存下来会让「起不来一次 PowerShell」变成整段会话静默不带凭据。
       */
      return "";
    }
    return sourceTokenCache;
  }

  // 给 token 取值链用：没保存过返回空串，由调用方决定再往下找哪一级。
  function readMastergoToken() {
    try {
      return dpapi("unprotect", fs.readFileSync(mastergoPath, "utf8"));
    }
    catch {
      return "";
    }
  }

  function read() {
    const raw = readRaw();
    const ai = raw.ai && typeof raw.ai === "object" ? raw.ai : {};
    const providerId = String(ai.provider || "");
    const preset = PROVIDERS.find((item) => item.id === providerId) || null;
    return {
      providers: PROVIDERS.map((item) => ({ id: item.id, label: item.label, baseUrl: item.baseUrl, model: item.model })),
      ai: {
        provider: providerId,
        baseUrl: String(ai.baseUrl || (preset ? preset.baseUrl : "")),
        model: String(ai.model || (preset ? preset.model : "")),
        hasKey: hasKey()
      },
      automation: AUTOMATION.includes(raw.automation) ? raw.automation : "assist",
      // 对话/自动模式的写盘开关：关着时 Codex 只读，开着才允许它直接改工程文件。
      agent: {
        allowWrite: Boolean(raw.agent && raw.agent.allowWrite),
      },
      templates: readTemplates(raw),
      activeTemplateId: readActiveTemplateId(raw),
      // 界面上选的那一份插件；空串＝按内置顺序自动找。
      pluginRoot: String(raw.pluginRoot || ""),
      /*
       * 运行时：system 是「这一份用系统上那份吗」（逐份，默认都不允许，见 lib/runtime-policy.js）；
       * mirror 是安装包的镜像基址（内网放那两个 zip 的目录），空＝用官方地址。
       */
      runtime: {
        system: {
          node: Boolean(raw.runtime && raw.runtime.system && raw.runtime.system.node),
          pwsh: Boolean(raw.runtime && raw.runtime.system && raw.runtime.system.pwsh)
        },
        mirror: normalizeMirror(raw.runtime && raw.runtime.mirror)
      },
      // 界面只管「存没存」：实际生效值可能是命令行或环境变量，那份由取值链判。
      mastergo: { hasToken: hasMastergoToken() },
      /*
       * 发布源：检查更新与下载新版本从哪儿取。空/坏配置一律回落内置默认（公开 GitHub 仓库），
       * 所以这里返回的永远是一份可用的值 —— 换成公司 GitLab 只改 lib/source.js 的默认基址一处。
       */
      source: Object.assign(source.normalizeSource(raw.source), { hasToken: hasSourceToken() }),
      /*
       * 插件那条线的源：自己那一项设置，没配／配坏了回插件仓库（lib/source.js 的 pluginSourceOf）。
       * 与程序更新那项分开，谁改谁的一处。
       */
      pluginSource: Object.assign(source.pluginSourceOf(raw.pluginSource), { hasToken: hasSourceToken() })
    };
  }

  function write(patch) {
    const raw = readRaw();
    if (patch.ai && typeof patch.ai === "object") {
      const current = raw.ai && typeof raw.ai === "object" ? raw.ai : {};
      raw.ai = {
        provider: String(patch.ai.provider ?? current.provider ?? ""),
        baseUrl: String(patch.ai.baseUrl ?? current.baseUrl ?? "").trim(),
        model: String(patch.ai.model ?? current.model ?? "").trim()
      };
      if (typeof patch.ai.apiKey === "string" && patch.ai.apiKey.trim()) {
        fs.writeFileSync(credentialsPath, dpapi("protect", patch.ai.apiKey.trim()), "utf8");
      }
      if (patch.ai.clearKey === true) {
        try {
          fs.unlinkSync(credentialsPath);
        }
        catch {
          /* 本来就没有 */
        }
      }
    }
    if (typeof patch.automation === "string" && AUTOMATION.includes(patch.automation)) {
      raw.automation = patch.automation;
    }
    if (typeof patch.pluginRoot === "string") {
      raw.pluginRoot = patch.pluginRoot.trim();
    }
    if (patch.agent && typeof patch.agent === "object") {
      const current = raw.agent && typeof raw.agent === "object" ? raw.agent : {};
      raw.agent = { allowWrite: typeof patch.agent.allowWrite === "boolean" ? patch.agent.allowWrite : Boolean(current.allowWrite) };
    }
    if (Array.isArray(patch.templates)) {
      // 落盘时把参考源固定下来，同时清掉早先那两个平铺字段（提示词与代码库已归参考源）。
      raw.templates = normalizeTemplates(patch.templates);
      const wanted = String(patch.activeTemplateId || raw.activeTemplateId || "");
      raw.activeTemplateId = raw.templates.some(function (item) { return item.id === wanted; })
        ? wanted
        : raw.templates[0].id;
      delete raw.codebases;
      if (raw.agent) delete raw.agent.systemPrompt;
    }
    if (patch.mastergo && typeof patch.mastergo === "object") {
      if (typeof patch.mastergo.token === "string" && patch.mastergo.token.trim()) {
        fs.writeFileSync(mastergoPath, dpapi("protect", patch.mastergo.token.trim()), "utf8");
      }
      if (patch.mastergo.clearToken === true) {
        try {
          fs.unlinkSync(mastergoPath);
        }
        catch {
          /* 本来就没有 */
        }
      }
    }
    if (patch.source && typeof patch.source === "object") {
      raw.source = source.normalizeSource(patch.source);
      if (typeof patch.source.token === "string" && patch.source.token.trim()) {
        fs.writeFileSync(sourceTokenPath, dpapi("protect", patch.source.token.trim()), "utf8");
      }
      if (patch.source.clearToken === true) {
        try {
          fs.unlinkSync(sourceTokenPath);
        }
        catch {
          /* 本来就没有 */
        }
      }
      sourceTokenCache = null;
    }
    /*
     * 插件那条线的源是**自己那一项**：两条线各有各的版本线，在插件页改插件源不该动到程序更新的源
     * （反之亦然）。凭据仍共用同一份（内网两处通常就是同一个站点）。
     */
    if (patch.pluginSource && typeof patch.pluginSource === "object") {
      raw.pluginSource = source.pluginSourceOf(patch.pluginSource);
      if (typeof patch.pluginSource.token === "string" && patch.pluginSource.token.trim()) {
        fs.writeFileSync(sourceTokenPath, dpapi("protect", patch.pluginSource.token.trim()), "utf8");
      }
      if (patch.pluginSource.clearToken === true) {
        try {
          fs.unlinkSync(sourceTokenPath);
        }
        catch {
          /* 本来就没有 */
        }
      }
      sourceTokenCache = null;
    }
    if (patch.runtime && typeof patch.runtime === "object") {
      /*
       * 这三项各有各的写入入口（每份运行时的「来源」弹窗、安装包地址），所以按字段合并：
       * 谁后写都只改自己那一项，不能把对方清空；system 里也是逐份合并。
       */
      const current = raw.runtime && typeof raw.runtime === "object" ? raw.runtime : {};
      const currentSystem = current.system && typeof current.system === "object" ? current.system : {};
      const patchSystem = patch.runtime.system && typeof patch.runtime.system === "object" ? patch.runtime.system : null;
      const pickSystem = (tool) => (patchSystem && typeof patchSystem[tool] === "boolean"
        ? patchSystem[tool] === true
        : currentSystem[tool] === true);
      raw.runtime = {
        system: { node: pickSystem("node"), pwsh: pickSystem("pwsh") },
        mirror: patch.runtime.mirror === undefined
          ? normalizeMirror(current.mirror)
          : normalizeMirror(patch.runtime.mirror)
      };
    }
    fs.writeFileSync(settingsPath, JSON.stringify(raw, null, 2) + "\n", "utf8");
    return read();
  }

  // 给 AI / agent 模块用：解出可直接调用的一组值；缺项一律抛可读错误。
  // provider 是厂商 id（自定义厂商为空串），Codex 起进程时用它当 model_provider 的名字。
  function resolveAi() {
    const current = read();
    const ai = current.ai;
    if (!ai.baseUrl) throw new UserError("NO_AI_URL", "还没有配置模型服务地址", "到「设置」里选厂商或填自定义 base_url。");
    if (!ai.model) throw new UserError("NO_AI_MODEL", "还没有配置模型名", "到「设置」里填模型名。");
    if (!ai.hasKey) throw new UserError("NO_AI_KEY", "还没有配置 API key", "到「设置」里填 key（用 Windows DPAPI 加密保存）。");
    return {
      provider: ai.provider,
      baseUrl: ai.baseUrl,
      model: ai.model,
      apiKey: dpapi("unprotect", fs.readFileSync(credentialsPath, "utf8"))
    };
  }

  /*
   * 插件那条线的源：插件有自己的版本线 —— 跟不跟发布源由 lib/source.js 的 pluginSourceOf 判，
   * 它读的是自己那一项设置（存盘原值），只有这一层拿得到。
   */
  function pluginSource() {
    return source.pluginSourceOf(readRaw().pluginSource);
  }

  return { read, write, resolveAi, readMastergoToken, readSourceToken, pluginSource };
}

module.exports = { createSettings };
