"use strict";

const { sendJson, sendText, readBody, serveStatic } = require("./http.js");
const { readPipelineSteps } = require("./plugin.js");

// 路由表：每条 = 一个方法 + 一个路径 + 一个 handler。
// handler 返回对象则自动以 200 JSON 回；`body: true` 表示先解析 JSON 请求体。
function createRoutes(deps) {
  const resolver = deps.resolver;
  const plugin = deps.plugin;
  const version = deps.version;
  const runs = deps.runs;

  function pluginSummary() {
    return {
      root: plugin.root,
      version: plugin.version,
      engine: plugin.engine,
      engineExists: plugin.engineExists,
      runAllExists: plugin.runAllExists
    };
  }

  return [
    {
      method: "GET",
      path: "/api/health",
      handler: function () {
        return {
          ok: true,
          version: version,
          plugin: pluginSummary(),
          frames: resolver.framesOfAllFiles()
        };
      }
    },
    {
      method: "GET",
      path: "/api/plugin",
      handler: function () {
        // 步骤清单不写死在 GUI：插件改了流程，这里跟着变。
        const steps = readPipelineSteps(plugin.root);
        return { ok: true, plugin: pluginSummary(), steps: steps };
      }
    },
    {
      method: "POST",
      path: "/api/resolve",
      body: true,
      handler: function (context) {
        const body = context.body || {};
        if (body.projectDir) resolver.registerProjectFrames(String(body.projectDir));
        return resolver.resolveQuery({
          link: body.link,
          frameLink: body.frameLink || ""
        });
      }
    },
    {
      method: "POST",
      path: "/api/run",
      body: true,
      handler: function (context) {
        return { ok: true, job: runs.start(context.body || {}) };
      }
    },
    {
      method: "POST",
      path: "/api/run/stop",
      body: true,
      handler: function (context) {
        return { ok: true, job: runs.stop((context.body || {}).runId || "") };
      }
    },
    {
      method: "GET",
      path: "/api/run/status",
      handler: function (context) {
        return { ok: true, job: runs.status(context.url.searchParams.get("runId") || "") };
      }
    },
    {
      method: "GET",
      path: "/api/run/log",
      handler: function (context) {
        const slice = runs.log(
          context.url.searchParams.get("runId") || "",
          Number(context.url.searchParams.get("from") || 0)
        );
        return { ok: true, ...slice };
      }
    }
  ];
}

function errorPayload(error) {
  if (error && error.userFacing) {
    return { status: 400, body: { ok: false, error: { code: error.code, message: error.message, hint: error.hint || "" } } };
  }
  return {
    status: 500,
    body: { ok: false, error: { code: "INTERNAL", message: String(error && error.message ? error.message : error), hint: "" } }
  };
}

async function dispatch(routes, request, response, publicDir) {
  const url = new URL(request.url, "http://" + (request.headers.host || "127.0.0.1"));
  const route = routes.find((item) => item.method === request.method && item.path === url.pathname);

  if (route) {
    try {
      const body = route.body ? await readBody(request) : null;
      const payload = await route.handler({ request, response, url, body: body });
      if (payload !== undefined) sendJson(response, 200, payload);
    }
    catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      const failure = errorPayload(error);
      sendJson(response, failure.status, failure.body);
    }
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { ok: false, error: { code: "NO_ROUTE", message: "没有这个接口：" + url.pathname, hint: "" } });
    return;
  }
  if (request.method === "GET") {
    if (serveStatic(response, publicDir, url.pathname)) return;
    sendText(response, 404, "404");
    return;
  }
  sendText(response, 405, "405");
}

module.exports = { createRoutes, dispatch };
