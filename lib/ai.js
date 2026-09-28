"use strict";

/*
 * 模型调用。
 *
 * 只做「出候选」这一件事：把插件算好的清单喂给模型，要回结构化结果，交界面预填。
 * 从不直接写任何文件——写盘一律走 /api/confirm，人确认之后。
 *
 * 客户端用 openai 包（Apache-2.0，零传递依赖）：baseURL 一换就是任意 OpenAI 兼容厂商，
 * 重试 / 超时 / 流式 / 结构化错误都由它提供。这里自己补两件它不管的：熔断与 JSON 兜底解析。
 */

const { OpenAI } = require("openai");

const { UserError } = require("./errors.js");

const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 60 * 1000;
const MAX_ITEMS = 200;

const ICON_SYSTEM = [
  "你在为 MTSLG 界面资源命名。给你的是设计稿里需要登记的图标候选，",
  "每条含它所在的控件（ownerText / ownerControlType）、同级 PATH 数、图标尺寸与图层名。",
  "为每条给一个英文资源名，规则：",
  "1) name 必须是英文大驼峰，以 Geometry 结尾，例如 SetGeometry；",
  "2) 语义取自「它归属的控件/文本 + 图层名」，不要按图形外观猜；",
  "3) comment 用中文一句话说清这个图标表示什么；",
  "4) confidence 是 0~1 的数，不确定就给低分。",
  "只输出 JSON：{\"items\":[{\"index\":<候选下标>,\"name\":\"...\",\"comment\":\"...\",\"confidence\":0.0}]}"
].join("\n");

const TRANSLATION_SYSTEM = [
  "你在为工业设备界面做中译英。给你的是界面文案（中文），逐条给英文译文。",
  "规则：",
  "1) 译文要短，适合放在按钮/标签里，不要加句号；",
  "2) 数字、单位、型号、功能键名（ENTER / EXIT / F1）原样保留；",
  "3) 专业术语用设备行业的通用英文说法；",
  "4) 不确定的照字面直译，不要编造缩写。",
  "只输出 JSON：{\"items\":[{\"text\":\"<原中文>\",\"translation\":\"<英文>\"}]}"
].join("\n");

function stripFence(text) {
  return String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

// 模型偶尔会加解释或代码围栏；先按整体解析，失败再退到第一个 JSON 对象。
function parseJson(text) {
  const body = stripFence(text);
  try {
    return JSON.parse(body);
  }
  catch {
    /* 继续尝试截取 */
  }
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(body.slice(start, end + 1));
    }
    catch {
      /* 落到下面的报错 */
    }
  }
  throw new UserError("AI_BAD_JSON", "模型没有返回可解析的 JSON", body.slice(0, 500));
}

function createAi(deps) {
  const settings = deps.settings;

  let consecutiveFailures = 0;
  let openUntil = 0;

  function breakerCheck() {
    if (Date.now() < openUntil) {
      const seconds = Math.ceil((openUntil - Date.now()) / 1000);
      throw new UserError("AI_BREAKER", "模型连续失败，已暂停调用", seconds + " 秒后可重试；检查设置里的地址/模型/key。");
    }
  }

  function noteFailure() {
    consecutiveFailures += 1;
    if (consecutiveFailures >= BREAKER_THRESHOLD) {
      openUntil = Date.now() + BREAKER_COOLDOWN_MS;
      consecutiveFailures = 0;
    }
  }

  function noteSuccess() {
    consecutiveFailures = 0;
  }

  async function complete(system, user) {
    breakerCheck();
    const config = settings.resolveAi();
    const client = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
      maxRetries: 2,
      timeout: 120000
    });
    try {
      const response = await client.chat.completions.create({
        model: config.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      });
      noteSuccess();
      return response.choices?.[0]?.message?.content ?? "";
    }
    catch (error) {
      noteFailure();
      const status = error && error.status ? "（HTTP " + error.status + "）" : "";
      throw new UserError("AI_CALL", "调用模型失败" + status, String(error && error.message ? error.message : error).slice(0, 500));
    }
  }

  async function suggestIconNames(input) {
    const items = (Array.isArray(input.mustName) ? input.mustName : []).slice(0, MAX_ITEMS);
    if (items.length === 0) return { items: [] };
    const payload = items.map((item) => ({
      index: item.index,
      layerName: item.svgName ?? "",
      nodeName: item.nodeName ?? "",
      ownerText: item.ownerText ?? "",
      ownerControlType: item.ownerControlType ?? "",
      parentType: item.parentType ?? "",
      siblingPathCount: item.siblingPathCount ?? null,
      iconSize: item.ledgerFields?.iconSize ?? null,
      reason: item.reason ?? ""
    }));
    const text = await complete(ICON_SYSTEM, JSON.stringify({ icons: payload }, null, 2));
    const parsed = parseJson(text);
    const allowed = new Set(items.map((item) => item.index));
    const out = (Array.isArray(parsed.items) ? parsed.items : [])
      .filter((item) => allowed.has(item.index) && typeof item.name === "string" && item.name.trim())
      .map((item) => ({
        index: item.index,
        name: String(item.name).trim(),
        comment: String(item.comment ?? "").trim(),
        confidence: typeof item.confidence === "number" ? item.confidence : null
      }));
    return { items: out };
  }

  async function suggestTranslations(input) {
    const items = (Array.isArray(input.texts) ? input.texts : []).slice(0, MAX_ITEMS);
    if (items.length === 0) return { items: [] };
    const text = await complete(TRANSLATION_SYSTEM, JSON.stringify({ texts: items }, null, 2));
    const parsed = parseJson(text);
    const known = new Set(items.map((item) => String(item)));
    const out = (Array.isArray(parsed.items) ? parsed.items : [])
      .filter((item) => known.has(String(item.text)) && typeof item.translation === "string")
      .map((item) => ({ text: String(item.text), translation: String(item.translation).trim() }));
    return { items: out };
  }

  return { suggestIconNames, suggestTranslations };
}

module.exports = { createAi };
