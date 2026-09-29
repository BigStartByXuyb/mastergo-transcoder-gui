"use strict";

/*
 * 用户设置与模型凭据。
 *
 *   local.json   非密设置（厂商 / base_url / 模型 / 自动化层级）
 *   credentials  API key —— 经 Windows DPAPI（CurrentUser）加密后存这里
 *
 * 厂商表只放**核实过**的默认值：只列 DeepSeek（取自本机 ~/.codex/config.toml 的
 * model_providers.deepseek），其余走「自定义」。宁缺毋滥——写错的默认值比没有默认值更坑。
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { UserError } = require("./errors.js");
const { resolvePwsh } = require("./plugin.js");

const DPAPI_SCRIPT = path.join(__dirname, "dpapi.ps1");

const PROVIDERS = [
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" }
];

const AUTOMATION = ["off", "assist", "auto"];

function dpapi(mode, text) {
  const result = spawnSync(resolvePwsh(), ["-NoProfile", "-File", DPAPI_SCRIPT, "-Mode", mode], {
    input: text,
    encoding: "utf8",
    timeout: 30000
  });
  if (result.status !== 0) {
    throw new UserError("DPAPI", "凭据加解密失败", String(result.stderr || result.stdout || "").trim().slice(0, 400));
  }
  return result.stdout;
}

function createSettings(home) {
  const settingsPath = path.join(home, "local.json");
  const credentialsPath = path.join(home, "credentials");

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
      agent: { allowWrite: Boolean(raw.agent && raw.agent.allowWrite) }
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
    if (patch.agent && typeof patch.agent === "object" && typeof patch.agent.allowWrite === "boolean") {
      raw.agent = { allowWrite: patch.agent.allowWrite };
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

  return { read, write, resolveAi };
}

module.exports = { createSettings };
