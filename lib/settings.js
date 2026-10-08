"use strict";

/*
 * 用户设置与模型凭据。
 *
 *   local.json            非密设置（厂商 / base_url / 模型 / 自动化层级 / 参考源 / 两条版本线的发布源）
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
  /*
   * 私有发布源的只读 token：与其它凭据一样 DPAPI 加密存本机。
   * 两条版本线各存一份 —— 它们的源是两个地址（程序更新＝客户端仓库 / 插件＝插件仓库，内网也可能各自不同），
   * 共用一份会在「插件那条默认指向另一个主机」时把私有 GitLab 的 token 当 Bearer 发过去，
   * 清一条也会把另一条清掉。所以凭据跟着源走，一边一份。
   *
   * 文件名按字段名派生：连字符形式 + "-credentials"（source → source-credentials、
   * pluginSource → plugin-source-credentials）。这份**落盘布局**是设置层的事，但字段清单不在这里列 ——
   * 「有哪几条版本线、默认是哪一条」只由 lib/source.js 的 LINES 决定（lineOf），
   * 字段名一律经它归一后再传进来，这里只按名字算文件名，不再认第二遍。
   * 名字是已装机器上凭据的位置，改名等于把老凭据丢掉：tests/settings-templates.test.js 钉住这两个名字。
   */
  function credentialFileName(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase() + "-credentials";
  }
  function tokenPathOf(name) {
    return path.join(home, credentialFileName(name));
  }

  function readRaw() {
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
      return {};
    }
  }

  /*
   * 「这份凭据存过吗」＝那个文件存在且非空：只看文件、不解密。
   * 三份凭据（模型 key、MasterGo token、两条版本线的发布源 token）走同一处判断，路径各自算。
   */
  function nonEmptyText(file) {
    try {
      return fs.readFileSync(file, "utf8").trim().length > 0;
    }
    catch {
      return false;
    }
  }

  function hasKey() { return nonEmptyText(credentialsPath); }

  function hasMastergoToken() { return nonEmptyText(mastergoPath); }

  // 传进来的已经是归一后的字段名（readSourceToken / hasSourceToken 那两处经 lineOf 过一遍）。
  function hasTokenOf(name) { return nonEmptyText(tokenPathOf(name)); }

  /*
   * 给更新模块用：解出来给请求头；没存过就空串（公开源不需要）。
   * 解出来的值缓存在内存 —— 解密是同步起一次 PowerShell，而下载时每个文件都要用它拼请求头，
   * 每次都解会把单线程的事件循环整段堵住。改动或清除 token 时把缓存置空，下一次重新解。
   */
  // 每条线一份缓存：解出来给请求头用（解密要起一次 PowerShell，下载时每个文件都要用它）。
  const sourceTokenCache = {};
  function readTokenOf(name) {
    if (sourceTokenCache[name] !== undefined) return sourceTokenCache[name];
    try {
      sourceTokenCache[name] = dpapi("unprotect", fs.readFileSync(tokenPathOf(name), "utf8"));
    }
    catch {
      /*
       * 解密失败不写缓存：这一次就当没有凭据，下一次重新解。
       * 把失败也缓存下来会让「起不来一次 PowerShell」变成整段会话静默不带凭据。
       */
      return "";
    }
    return sourceTokenCache[name];
  }

  /*
   * 给更新模块用：两条版本线读的是同一个形状，只是 field 不同（不传＝程序更新那条）。
   * 「读」与「有没有」各一处，别按线再抄一套名字；默认是哪个字段由 lineOf 一处说了算。
   */
  function readSourceToken(field) { return readTokenOf(source.lineOf(field).field); }
  function hasSourceToken(field) { return hasTokenOf(source.lineOf(field).field); }

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
    };
  }

  function write(patch) {
    const raw = readRaw();
    /*
     * 一次写请求里可能同时带几类字段（界面各弹窗只带自己那一类）。按字段域拆开，
     * 每一类的合并规则各自成一条纵向的读法 —— 改发布源不会翻到运行时那一段去。
     */
    writeAi(patch, raw);
    if (typeof patch.automation === "string" && AUTOMATION.includes(patch.automation)) raw.automation = patch.automation;
    writeAgent(patch, raw);
    writeTemplates(patch, raw);
    writeMastergoToken(patch);
    writeSources(patch, raw);
    writeRuntime(patch, raw);
    fs.writeFileSync(settingsPath, JSON.stringify(raw, null, 2) + "\n", "utf8");
    return read();
  }

  // 模型凭据（厂商 / 地址 / 模型 + key）。
  function writeAi(patch, raw) {
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
  }

  // 写盘开关。
  function writeAgent(patch, raw) {
    if (patch.agent && typeof patch.agent === "object") {
      const current = raw.agent && typeof raw.agent === "object" ? raw.agent : {};
      raw.agent = { allowWrite: typeof patch.agent.allowWrite === "boolean" ? patch.agent.allowWrite : Boolean(current.allowWrite) };
    }
  }

  // 参考源（提示词 / 代码库）整份替换，并清掉早先那两个平铺字段。
  function writeTemplates(patch, raw) {
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
  }

  // MasterGo 取数凭据。
  function writeMastergoToken(patch) {
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
  }

  /*
   * 两项发布源写法完全同形，只有「读哪个补丁字段、写哪个 raw 字段、用哪一处归一」不同：
   *   source       程序更新（客户端仓库那份默认）
   *   pluginSource 插件（插件仓库那份默认，它有自己的版本线）
   * 两条线互不影响（在插件页改源不该动到程序更新那条，反之亦然）—— 源与凭据都各归各的。
   */
  function writeSources(patch, raw) {
    // 逐条版本线处理：字段名、归一、凭据位置都从这一条线取（表与默认只有 lib/source.js 一处说）。
    for (const line of source.lines()) {
      const patchValue = patch[line.field];
      if (!patchValue || typeof patchValue !== "object") continue;
      // 补丁没带源（只清凭据 / 只换 token）就不动这一项设置：不然一次「清除 token」会把源也改回默认。
      if (typeof patchValue.kind === "string" || typeof patchValue.base === "string") {
        raw[line.field] = line.normalize(patchValue);
      }
      const tokenPath = tokenPathOf(line.field);
      if (typeof patchValue.token === "string" && patchValue.token.trim()) {
        fs.writeFileSync(tokenPath, dpapi("protect", patchValue.token.trim()), "utf8");
      }
      if (patchValue.clearToken === true) {
        try {
          fs.unlinkSync(tokenPath);
        }
        catch {
          /* 本来就没有 */
        }
      }
      delete sourceTokenCache[line.field];
    }
  }

  // 运行时策略：两个「用系统那份」开关逐份合并（各弹窗各改自己那一项），安装包镜像地址可选。
  function writeRuntime(patch, raw) {
    if (patch.runtime && typeof patch.runtime === "object") {
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
   * 某条版本线的发布源（不传＝程序更新那条）：读的是自己那一项设置（local.json 的 source / pluginSource），
   * 没配／配坏了回这条线自己的默认 —— 判据只有 lib/source.js 的 LINES 一处。
   * 发布源**只有这一个入口**：界面上看「从哪儿取」读的是各条更新状态里的 describe()（后端拼好的地址），
   * read() 那份设置视图因此不带 source —— 同一项设置不摆两个形状。
   */
  function sourceOf(field) {
    const line = source.lineOf(field);
    return line.normalize(readRaw()[line.field]);
  }

  return {
    read,
    write,
    resolveAi,
    readMastergoToken,
    // 两条版本线各读各的凭据（与各自的源配套）：同一个形状，传自己的 field。
    readSourceToken,
    /** 有没有那份凭据（廉价判断：只看存没存，不解密）—— 两条线与装配处都读这一处。 */
    hasSourceToken,
    sourceOf
  };
}

module.exports = { createSettings };
