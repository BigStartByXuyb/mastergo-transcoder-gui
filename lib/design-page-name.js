"use strict";

// 从链接取「设计页名」：调插件自己的取数脚本拿 getDsl，读根节点名字。
// 取数口径（token 来源、响应形状、失败文案）已经在插件里实现过，客户端不复制一份；
// 这里只把响应文件里的 dsl.nodes[0].name 取出来给界面。设计页名是「停止调整」这类中文原名，不是 Target。

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const MCP_TOOL_REL = path.join("skills", "mastergo-to-wpf", "scripts", "core", "call-mastergo-mcp.js");

function resolveDesignPageName(options) {
  const pluginRoot = String(options.pluginRoot || "").trim();
  const fileId = String(options.fileId || "").trim();
  const layerId = String(options.layerId || "").trim();
  if (!pluginRoot) throw new Error("还没有定位到插件目录");
  if (!fileId || !layerId) throw new Error("链接里缺 file= 或 layer_id=");

  const tool = path.join(pluginRoot, MCP_TOOL_REL);
  if (!fs.existsSync(tool)) {
    throw new Error("插件里找不到取数脚本：" + MCP_TOOL_REL + "（确认插件版本包含 core/call-mastergo-mcp.js）");
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "gui-design-name-"));
  const outPath = path.join(workDir, "getDsl.json");
  try {
    const result = spawnSync(process.execPath, [
      tool, "--tool", "getDsl", "--fileId", fileId, "--layerId", layerId,
      "--format", "json", "--out", outPath
    ], { encoding: "utf8", timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw new Error("取设计页名失败：起不来取数脚本（" + result.error.message + "）");
    if (result.status !== 0) {
      const detail = String(result.stderr || result.stdout || "").trim().slice(0, 400);
      throw new Error("取设计页名失败（exit " + result.status + "）" + (detail ? "：" + detail : ""));
    }
    if (!fs.existsSync(outPath)) throw new Error("取数脚本没有落盘响应，读不到设计页名");
    const payload = JSON.parse(fs.readFileSync(outPath, "utf8").replace(/^\uFEFF/, ""));
    const root = payload && payload.dsl && Array.isArray(payload.dsl.nodes) ? payload.dsl.nodes[0] : null;
    if (!root) throw new Error("响应里没有 dsl.nodes[]，取不到设计页名");
    return { pageName: String(root.name || "").trim(), rootId: String(root.id || "").trim() };
  }
  finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

module.exports = { resolveDesignPageName, MCP_TOOL_REL };
