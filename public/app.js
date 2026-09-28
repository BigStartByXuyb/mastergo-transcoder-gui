"use strict";
/* 前端逻辑：调 /api/resolve，渲染控件清单 + 详情 + 复制。 */

const el = (id) => document.getElementById(id);
const state = { payload: null, selectedRef: "", filter: "", onlyMapped: true };

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function nodeLabelOf(node) {
  return node && node.name ? node.name : "(未命名)";
}

function posOf(node) {
  const x = typeof node.pageAbsX === "number" ? Math.round(node.pageAbsX) : null;
  const y = typeof node.pageAbsY === "number" ? Math.round(node.pageAbsY) : null;
  const w = typeof node.width === "number" ? Math.round(node.width) : null;
  const h = typeof node.height === "number" ? Math.round(node.height) : null;
  if (x === null || y === null) return "";
  return x + "," + y + (w !== null && h !== null ? " · " + w + "×" + h : "");
}

/* ---------- toast ---------- */
let toastTimer = 0;
function toast(text) {
  const box = el("toast");
  box.textContent = text;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { box.hidden = true; }, 1600);
}

async function copyText(text, label) {
  const value = String(text || "");
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch (error) {
    const area = document.createElement("textarea");
    area.value = value;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
  }
  toast("已复制" + (label ? "：" + label : ""));
}

/* ---------- 健康检查 ---------- */
async function loadHealth() {
  const slot = el("health");
  try {
    const health = await (await fetch("/api/health")).json();
    const parts = [];
    parts.push('<span class="badge ' + (health.engine ? "badge-secondary" : "badge") + '">引擎' + (health.engine ? "就绪" : "缺失") + "</span>");
    parts.push('<span class="badge ' + (health.hasToken ? "badge-secondary" : "badge-muted") + '">' + (health.hasToken ? "设计稿接口就绪" : "无 token（仅本地快照）") + "</span>");
    const frames = Array.isArray(health.frames) ? health.frames : [];
    if (frames.length) parts.push('<span class="badge badge-secondary">已登记页面帧 ' + frames.length + "</span>");
    slot.innerHTML = parts.join("");
  } catch (error) {
    slot.innerHTML = '<span class="badge badge-muted">服务未就绪</span>';
  }
}

/* ---------- 查询 ---------- */
function setLoading(loading) {
  el("submit").disabled = loading;
  el("spinner").hidden = !loading;
  el("submit-text").textContent = loading ? "查询中…" : "查询";
}

function showAlert(html) {
  el("alert-slot").innerHTML = html;
}

async function submit() {
  const link = el("link").value.trim();
  if (!link) {
    showAlert('<div class="alert alert-destructive"><span class="alert-title">请先粘贴 MasterGo 链接</span><span>在 MasterGo 里选中容器（页面帧）或控件，用「复制链接」，然后粘到上面的输入框。</span></div>');
    return;
  }
  saveInputs();
  showAlert('<div class="alert"><span class="alert-title">正在取设计稿…</span><span>首次查询一个页面大约 10–30 秒（之后同一页面走缓存，几毫秒）。</span></div>');
  setLoading(true);
  try {
    const response = await fetch("/api/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        link: link,
        frameLink: el("frame-link").value.trim(),
        projectDir: el("project").value.trim()
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      const error = payload.error || {};
      showAlert('<div class="alert alert-destructive"><span class="alert-title">' + escapeHtml(error.message || "查询失败") + "</span>"
        + (error.hint ? "<span>" + escapeHtml(error.hint) + "</span>" : "") + "</div>");
      return;
    }
    showAlert("");
    render(payload);
  } catch (error) {
    showAlert('<div class="alert alert-destructive"><span class="alert-title">连不上本地服务</span><span>' + escapeHtml(String(error && error.message ? error.message : error)) + "</span></div>");
  } finally {
    setLoading(false);
    loadHealth();
  }
}

/* ---------- 渲染 ---------- */
function render(payload) {
  state.payload = payload;
  state.filter = el("filter").value = "";
  state.onlyMapped = el("only-mapped").checked = true;
  const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  state.selectedRef = payload.mode === "single" && payload.target ? payload.target.ref : "";

  el("result-card").hidden = false;
  el("result-title").textContent = payload.mode === "single"
    ? "控件：" + nodeLabelOf(payload.target)
    : "容器内控件（" + payload.capture.totalCount + "）";
  el("result-subtitle").textContent = payload.mode === "single"
    ? "已按页面帧 " + payload.frame.layerId + " 定位到该控件；下表同时列出同一容器里的其他控件。"
    : "这些 ID 与整页转码一致（页面键 = " + payload.capture.pageKey + "）。点一行看它该用的 ID 与控件代码。";

  const badges = [];
  const frameSources = {
    "page-registry": "工程登记表",
    manifest: "工程快照",
    snapshot: "本地快照",
    "frame-link": "你指定的页面帧链接",
    link: "你贴的链接"
  };
  badges.push('<span class="badge ' + (payload.frame.verified ? "badge-secondary" : "badge-outline") + '">页面帧 '
    + escapeHtml(payload.frame.layerId) + " · " + escapeHtml(frameSources[payload.frame.from] || payload.frame.from)
    + (payload.frame.verified ? "" : "（未核对工程）") + "</span>");
  badges.push('<span class="badge badge-outline">页面键 ' + escapeHtml(payload.capture.pageKey) + "</span>");
  badges.push('<span class="badge badge-secondary">节点 ' + payload.capture.totalCount + "</span>");
  badges.push('<span class="badge badge-secondary">映射命中 ' + payload.capture.mappedCount + "</span>");
  badges.push('<span class="badge badge-muted">' + (payload.capture.source === "mastergo" ? "设计稿实时" : "本地快照") + "</span>");
  badges.push('<span class="badge badge-muted">' + (payload.elapsedMs / 1000).toFixed(1) + "s</span>");
  el("result-badges").innerHTML = badges.join("");

  const alerts = [];
  for (const note of payload.notes || []) {
    alerts.push('<div class="alert alert-muted">' + escapeHtml(note) + "</div>");
  }
  el("notes-slot").innerHTML = alerts.join("");

  renderRows();
  if (state.selectedRef) {
    const target = nodes.find((node) => node.ref === state.selectedRef);
    if (target) renderDetail(target);
  } else {
    el("detail-card").hidden = true;
  }
}

function visibleNodes() {
  const nodes = (state.payload && state.payload.nodes) || [];
  const keyword = state.filter.trim().toLowerCase();
  return nodes.filter(function (node) {
    // 有搜索词时按全量节点找（设计新增的控件可能还没登记映射）；没搜索词才应用「只看控件」。
    if (!keyword) return state.onlyMapped ? Boolean(node.xml) : true;
    return [node.name, node.text, node.layerId, node.id, node.ref, node.controlType]
      .join(" ").toLowerCase().indexOf(keyword) >= 0;
  });
}

function renderRows() {
  const nodes = visibleNodes();
  el("rows").innerHTML = nodes.map(function (node) {
    const mapped = node.controlType
      ? '<span class="badge badge-secondary">' + escapeHtml(node.controlType) + "</span>"
      : '<span class="badge badge-muted">未登记</span>';
    return '<tr data-ref="' + escapeHtml(node.ref) + '"' + (node.ref === state.selectedRef ? ' class="selected"' : "") + ">"
      + '<td><div class="cell-name">' + escapeHtml(nodeLabelOf(node)) + "</div>"
      + (node.text ? '<div class="cell-text">' + escapeHtml(node.text) + "</div>" : "")
      + '<div class="cell-layer">' + escapeHtml(node.layerId || "") + " · " + escapeHtml(node.type || "") + "</div></td>"
      + '<td class="cell-text">' + escapeHtml(posOf(node)) + "</td>"
      + '<td><div class="cell-id"><code>' + escapeHtml(node.id) + "</code></div></td>"
      + "<td>" + mapped + "</td></tr>";
  }).join("");
  el("empty").hidden = nodes.length > 0;
  Array.from(el("rows").querySelectorAll("tr")).forEach(function (row) {
    row.addEventListener("click", function () {
      const node = (state.payload.nodes || []).find((item) => item.ref === row.getAttribute("data-ref"));
      if (!node) return;
      state.selectedRef = node.ref;
      renderRows();
      renderDetail(node);
    });
  });
}

function renderDetail(node) {
  el("detail-card").hidden = false;
  el("detail-name").textContent = nodeLabelOf(node) + (node.text ? "（" + node.text + "）" : "");
  el("detail-sub").textContent = "layer_id " + (node.layerId || "") + " · " + (node.type || "");
  const stylePart = node.template && node.template.indexOf(" / ") > 0 ? " · " + escapeHtml(node.template.split(" / ")[1]) : "";
  el("detail-badge").innerHTML = node.controlType
    ? '<span class="badge badge-secondary">' + escapeHtml(node.controlType) + stylePart + "</span>"
    : '<span class="badge badge-muted">未登记映射</span>';
  el("detail-id").textContent = node.id;
  el("detail-meta").innerHTML = [
    ["控件", nodeLabelOf(node)],
    ["文本", node.text || "—"],
    ["layer_id", node.layerId || ""],
    ["位置", posOf(node) || "—"],
    ["节点 ref", node.ref || ""],
    ["页面键", (state.payload && state.payload.capture ? state.payload.capture.pageKey : "")]
  ].map(function (pair) {
    return "<div><dt>" + escapeHtml(pair[0]) + "</dt><dd>" + escapeHtml(pair[1]) + "</dd></div>";
  }).join("");

  const hasCode = Boolean(node.xml);
  el("code-field").hidden = !hasCode;
  el("no-code").hidden = hasCode;
  el("detail-code").textContent = hasCode ? node.xml : "";
  el("copy-id").onclick = function () { copyText(node.id, nodeLabelOf(node)); };
  el("copy-code").onclick = function () { copyText(node.xml, nodeLabelOf(node) + " 的控件代码"); };
}

/* ---------- 输入记忆 ---------- */
function saveInputs() {
  try {
    localStorage.setItem("mtslg-id-gui", JSON.stringify({
      link: el("link").value,
      frameLink: el("frame-link").value,
      project: el("project").value
    }));
  } catch (error) { /* 隐私模式下忽略 */ }
}

function restoreInputs() {
  try {
    const saved = JSON.parse(localStorage.getItem("mtslg-id-gui") || "{}");
    if (saved.link) el("link").value = saved.link;
    if (saved.frameLink) el("frame-link").value = saved.frameLink;
    if (saved.project) el("project").value = saved.project;
  } catch (error) { /* 忽略 */ }
}

/* ---------- 事件绑定 ---------- */
el("submit").addEventListener("click", submit);
el("link").addEventListener("keydown", function (event) { if (event.key === "Enter") submit(); });
el("frame-link").addEventListener("keydown", function (event) { if (event.key === "Enter") submit(); });
el("filter").addEventListener("input", function () { state.filter = el("filter").value; renderRows(); });
el("only-mapped").addEventListener("change", function () { state.onlyMapped = el("only-mapped").checked; renderRows(); });

restoreInputs();
loadHealth();
