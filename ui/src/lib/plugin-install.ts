import type { PluginUpdateStatus } from "@/lib/api"
import { failureText } from "@/lib/describe-failure"

/*
 * 客户端自带的那一份插件：状态怎么读、按钮该给哪句话。
 *
 * 与程序更新不是同一条版本线：插件装到「客户端自带」那一处，插件定位按最高版本现取，装完不用再切换
 * （自带那份排在查找顺序最后，Codex / Claude 里有时用的还是它们那份），所以这里没有「下载好了、等切换」
 * 这种状态，只有「没有 / 有新版 / 是最新 / 检查失败」。
 * 顺序与文案只在这一处，页面只渲染。
 */

export type PluginInstallTone = "secondary" | "outline" | "destructive"

export type PluginInstallSummary = {
  /** 一句话状态（说的是客户端自带的那一份）。 */
  label: string
  tone: PluginInstallTone
  /** 补充一句：差了几个文件、上次为什么没查成；没事就不说。 */
  note: string
  /** 主按钮上写什么。 */
  action: string
  /** 只有远端确实有新的那一版才让装。 */
  canInstall: boolean
}

export function describePluginInstall(status: PluginUpdateStatus | null): PluginInstallSummary {
  if (!status) {
    return { label: "读取中…", tone: "outline", note: "", action: "下载并安装", canInstall: false }
  }
  if (status.state === "error") {
    return {
      label: "检查失败",
      tone: "destructive",
      note: status.error ? failureText(status.error) : "",
      // 不能装时按钮别写「下载并安装」：写它要做的那一步（检查更新），与禁用状态一致。
      action: "先检查更新",
      canInstall: false
    }
  }
  // state 已经是 update_available 就一定有 available；这半句只是给类型收窄。
  if (status.state === "update_available" && status.available) {
    const installed = Boolean(status.local.dir)
    return {
      label: "有新版 v" + status.available.version,
      tone: "secondary",
      note: changeNote(status),
      // 「装了没有」只认目录（定位认它是一份插件就算装了）；版本号读不出时就照实说重装。
      action: installed ? (status.local.version ? "更新到 v" + status.available.version : "按远端重装") : "下载并安装",
      canInstall: true
    }
  }
  /*
   * 还没成功问过远端（离线首启，或启动时那次静默检查没成）时，别说「是最新」——
   * 本地有没有装分成两句，都说清「还没检查过」，人知道该点「检查更新」。
   */
  if (status.state === "unchecked") {
    return {
      label: status.local.dir ? (status.local.version ? "已装 v" + status.local.version : "已装（读不出版本）") : "还没装",
      tone: "outline",
      note: "还没检查过远端：点「检查更新」，看发布源里有没有插件发布件。",
      action: "先检查更新",
      canInstall: false
    }
  }
  // 走到这里：远端清单在，且不比本地新 —— 本地读得出版本才说得上「是最新」。
  return {
    label: status.local.version ? "是最新 v" + status.local.version : "已装",
    tone: "outline",
    note: "",
    action: "已是最新版",
    canInstall: false
  }
}

/* 差了几个文件：本地一份都没有就按全部文件说，本地有一版就按改动说。 */
function changeNote(status: PluginUpdateStatus): string {
  const available = status.available
  if (!available) return ""
  if (!status.local.dir) return "远端 v" + available.version + "，共 " + available.total + " 个文件"
  if (!status.local.version) return "远端 v" + available.version + "：本地这一份读不出版本，按它重装一遍"
  return "远端 v" + available.version + "，差 " + available.changed + " 个文件"
}

/**
 * 自带那一份的处境：没有 / 就是正在用的那份 / 装了但不是正在用的那份。
 * 判据用插件定位解析出的根（两边都是同一份来源算出来的绝对路径），不按版本号猜；
 * 比之前先归一 —— Windows 路径大小写不敏感，反斜杠与正斜杠也都能出现。
 */
export function localSituation(status: PluginUpdateStatus | null, activeRoot: string): "none" | "active" | "other" {
  if (!status || !status.local.dir) return "none"
  return samePath(status.local.dir, activeRoot) ? "active" : "other"
}

function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase()
}
