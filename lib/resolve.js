"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { UserError } = require("./errors.js");
const { getterOf } = require("./getter.js");
const { missingPluginFiles } = require("./node-controls.js");
const { requirePwshExe } = require("./runtime.js");
const { childOutputText } = require("./ansi.js");
const { tokenEnv, requireToken } = require("./mcp-token.js");
const {
  parseLink,
  findNodesByLayerId,
  isPageLevelLink,
  describeCaptureFailure,
  discoverFrames
} = require("./resolve-target.js");

const CAPTURE_TIMEOUT_MS = 10 * 60 * 1000;
const VERIFIED_FROM = new Set(["page-registry", "manifest", "snapshot", "frame-link"]);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  catch {
    return null;
  }
}

// 控件查询：链接 → 控件 ID。状态都在闭包里，便于按依赖构造与测试。
function createResolver(options) {
  const engine = options.engine;
  // 插件根可能在设置里被换掉：与 token 一样接受取值函数，换完不重启客户端也按新的走。
  const pluginRootOf = getterOf(options.pluginRoot);
  // pwsh 与插件根、token 同一口径：可以是值，也可以是取值函数（换了运行时/开关不用重启客户端）。
  const pwshOf = getterOf(options.pwsh);
  // token 可能是值，也可能是取值函数：设置里改完不重启客户端也要能按新值走。
  const tokenOf = getterOf(options.token);
  const project = options.project || "";
  const snapshot = options.snapshot || "";
  const workRoot = options.workRoot;

  // 同 fileId+layerId 的抓取结果不重复打 MCP
  const captureCache = new Map();
  // fileId → [{ layerId, name, from, snapshotPath, verified }]
  // 一个设计文件可以有多个页面帧（同一 fileId 下不同画面），所以是列表而不是单值。
  const frameIndex = new Map();

  function registerFrame(frame) {
    if (!frame || !frame.fileId || !frame.layerId) return;
    const verified = frame.verified === undefined ? VERIFIED_FROM.has(frame.from) : frame.verified;
    const list = frameIndex.get(frame.fileId) || [];
    const existing = list.find((item) => item.layerId === frame.layerId);
    if (existing) {
      if (frame.snapshotPath && !existing.snapshotPath) existing.snapshotPath = frame.snapshotPath;
      if (verified && !existing.verified) {
        existing.verified = true;
        existing.from = frame.from;
      }
      return;
    }
    list.unshift({
      fileId: frame.fileId,
      layerId: frame.layerId,
      name: frame.name || "",
      from: frame.from || "link",
      snapshotPath: frame.snapshotPath || "",
      verified: verified
    });
    frameIndex.set(frame.fileId, list);
  }

  // 试帧顺序：有本地快照的先试（离线、快），再按"已验证"优先，最后按登记时间倒序。
  function framesOf(fileId) {
    return (frameIndex.get(fileId) || []).slice().sort(function (left, right) {
      const snapshotDiff = (right.snapshotPath ? 1 : 0) - (left.snapshotPath ? 1 : 0);
      if (snapshotDiff !== 0) return snapshotDiff;
      return (right.verified ? 1 : 0) - (left.verified ? 1 : 0);
    });
  }

  function framesOfAllFiles() {
    const all = [];
    for (const list of frameIndex.values()) {
      for (const frame of list) all.push(frame);
    }
    return all;
  }

  function refreshProjectFrames() {
    const roots = [];
    if (project) roots.push(project);
    roots.push(process.cwd());
    registerProjectFrames(roots);
    if (snapshot) {
      const payload = readJson(snapshot);
      const fileId = payload && payload.fileId ? String(payload.fileId) : "";
      const root = payload && payload.dsl && Array.isArray(payload.dsl.nodes) ? payload.dsl.nodes[0] : null;
      if (fileId && root && root.id) {
        registerFrame({
          fileId: fileId,
          layerId: String(root.id),
          name: String(root.name || ""),
          from: "snapshot",
          snapshotPath: path.resolve(snapshot)
        });
      }
    }
  }

  // 从工程目录（或一串目录）里发现页面帧并登记。
  function registerProjectFrames(dirs) {
    const roots = (Array.isArray(dirs) ? dirs : [dirs]).filter(Boolean).map(String);
    for (const frame of discoverFrames(roots, { maxDepth: 4 })) registerFrame(frame);
  }

  // 抓取一个节点为根的 DSL，并补齐每个节点的 ID（引擎产出）
  function captureNode(target, fileId) {
    const key = (fileId || "") + "|" + target.layerId;
    if (captureCache.has(key)) return captureCache.get(key);
    const pluginRoot = pluginRootOf();

    // 编排在客户端、口径在插件：两边缺任何一份都直接说清楚，别把 Node 的堆栈丢给用户。
    if (!fs.existsSync(engine)) {
      throw new UserError(
        "NO_ENGINE",
        "客户端里没有控件查询引擎",
        "期望文件：" + engine + "（本客户端自带的编排入口 lib/node-controls.js）。"
      );
    }
    const missingDeps = pluginRoot ? missingPluginFiles(pluginRoot) : [];
    if (missingDeps.length > 0) {
      throw new UserError(
        "NO_QUERY_DEPS",
        "插件里缺少查询所需文件",
        "插件 " + pluginRoot + " 缺：" + missingDeps.join("、")
          + "。取数、固化快照、mapping、控件代码与 ID 公式都由插件提供。"
      );
    }

    const runDir = fs.mkdtempSync(path.join(workRoot, "capture-"));
    const outPath = path.join(runDir, "node-controls.json");
    const token = tokenOf();
    // 没有可用的一份就直说去哪儿补，别把空路径交给子进程变成「找不到文件」。
    const args = [engine, "--plugin", pluginRoot, "--out", outPath, "--quiet", "--work-dir", runDir, "--pwsh", pwshOf() || requirePwshExe()];
    if (target.snapshotPath) {
      args.push("--snapshot", target.snapshotPath);
    }
    else {
      if (!fileId) throw new UserError("NEED_FILE", "链接里没有 file=，无法定位设计文件", "请在 MasterGo 里选中节点后复制链接。");
      requireToken(token);
      args.push("--file-id", fileId, "--layer-id", target.layerId);
    }

    const result = spawnSync(process.execPath, args, {
      encoding: "utf8",
      env: tokenEnv(token),
      timeout: CAPTURE_TIMEOUT_MS,
      maxBuffer: 256 * 1024 * 1024
    });
    if (result.status !== 0) {
      // 判据看全文（标记可能出现在很前面）；给人看的那段由 describeCaptureFailure 按档位掐长度。
      const failure = describeCaptureFailure(childOutputText(result), target.layerId);
      throw new UserError(failure.code, failure.message, failure.hint);
    }

    const payload = readJson(outPath);
    if (!payload || !Array.isArray(payload.nodes) || payload.nodes.length === 0) {
      throw new UserError("EMPTY_NODES", "没抓到节点（" + target.layerId + "）", "确认链接指向的是设计稿里的容器/控件，且该图层仍在画布上。");
    }
    const capture = {
      pageKey: String(payload.pageKey || ""),
      source: String(payload.source || ""),
      snapshotPath: target.snapshotPath || "",
      nodes: payload.nodes
    };
    captureCache.set(key, capture);
    return capture;
  }

  function summarize(capture) {
    const nodes = capture.nodes || [];
    return {
      pageKey: capture.pageKey,
      source: capture.source,
      totalCount: nodes.length,
      mappedCount: nodes.filter((node) => node.xml).length
    };
  }

  // 主流程：链接 → 控件 ID（单控件，或整个容器里的控件清单）
  function resolveQuery(request) {
    const startedAt = Date.now();
    const parsed = parseLink(request.link);
    const frameHint = request.frameLink ? parseLink(request.frameLink) : { fileId: "", layerId: "", pageId: "" };
    const fileId = parsed.fileId || frameHint.fileId;
    const layerId = parsed.layerId || frameHint.layerId;
    if (!layerId) {
      throw new UserError(
        "NEED_LAYER",
        parsed.pageId ? "链接里只有 page_id，没有具体图层" : "链接里没有 layer_id",
        "请在 MasterGo 画布上选中那个容器（页面帧）或控件，再用「复制链接」，链接里会带 layer_id。"
      );
    }
    // 页面链接（page_id 被当成 layer_id）在 MasterGo 侧必然取不到图层：提前拦住，别让它白等十几秒再报一句看不懂的错。
    if (isPageLevelLink(parsed) || isPageLevelLink(frameHint)) {
      throw new UserError(
        "PAGE_LINK",
        "贴的是「页面」链接，不是容器/控件",
        "这是页面（page_id=" + (parsed.pageId || frameHint.pageId) + "）的链接，MasterGo 取不到它的图层数据。"
          + "请在画布上选中那个容器（页面帧）或控件，再复制链接粘过来。"
      );
    }

    const notes = [];
    // 高级里显式给的页面帧链接：直接登记为已验证的页面帧。
    if (frameHint.layerId) {
      registerFrame({ fileId: fileId, layerId: frameHint.layerId, name: "", from: "frame-link", snapshotPath: "" });
    }

    // 已知页面帧（一个文件可能有多个：工程登记表 / 快照 / 之前贴过的页面帧链接）
    const frames = fileId ? framesOf(fileId) : [];

    // ① 贴的是控件，且在某个已知页面帧里找得到 → 直接给这一个控件的 ID（与整页转码一致）
    //    「自己就是页面帧」不进这个循环：拿自己当帧搜自己没有意义。
    for (const frame of frames) {
      if (frame.layerId === layerId) continue;
      const frameCapture = captureNode(frame, fileId);
      const hits = findNodesByLayerId(frameCapture.nodes, layerId);
      if (hits.length === 0) continue;
      if (hits.length > 1) notes.push("该 layer_id 在页面里出现 " + hits.length + " 次（图层被复用），已取最靠上的一个；请对照坐标确认。");
      return {
        ok: true,
        mode: "single",
        requested: parsed,
        frame: { layerId: frame.layerId, from: frame.from, verified: frame.verified },
        target: hits[0],
        candidates: hits.length > 1 ? hits : [],
        capture: summarize(frameCapture),
        nodes: frameCapture.nodes,
        notes: notes,
        elapsedMs: Date.now() - startedAt
      };
    }
    const otherFrames = frames.filter((frame) => frame.layerId !== layerId);
    if (otherFrames.length > 0) {
      notes.push("这个 layer_id 不在已登记的页面帧（" + otherFrames.map((frame) => frame.layerId).join("、") + "）里，已改为把链接本身当容器解析。");
    }

    // ② 把链接本身当容器（页面帧）：列出里面的控件与各自 ID
    const containerCapture = captureNode({ layerId: layerId, snapshotPath: "" }, fileId);
    if (fileId) {
      registerFrame({
        fileId: fileId,
        layerId: layerId,
        name: containerCapture.nodes[0] ? containerCapture.nodes[0].name : "",
        from: "link",
        snapshotPath: "",
        verified: false
      });
    }
    const frameEntry = (frameIndex.get(fileId) || []).find((item) => item.layerId === layerId)
      || { layerId: layerId, from: "link", verified: false };
    if (!frameEntry.verified) {
      notes.push("本次页面键取你贴的链接（" + layerId + "）。"
        + "若这其实是某个控件、而不是整页那个容器（页面帧），算出的 ID 会与整页转码不一致——"
        + "请改贴页面帧链接，或在「高级」里填工程目录/页面帧链接。");
    }
    return {
      ok: true,
      mode: "container",
      requested: parsed,
      frame: { layerId: layerId, from: frameEntry.from, verified: frameEntry.verified },
      target: null,
      candidates: [],
      capture: summarize(containerCapture),
      nodes: containerCapture.nodes,
      notes: notes,
      elapsedMs: Date.now() - startedAt
    };
  }

  return {
    refreshProjectFrames: refreshProjectFrames,
    resolveQuery: resolveQuery,
    registerProjectFrames: registerProjectFrames,
    framesOfAllFiles: framesOfAllFiles
  };
}

module.exports = { createResolver };
