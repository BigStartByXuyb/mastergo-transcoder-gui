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
      action: "下载并安装",
      canInstall: false
    }
  }
  if (status.state === "update_available" && status.available) {
    return {
      label: "有新版 v" + status.available.version,
      tone: "secondary",
      note: changeNote(status),
      action: status.local.version ? "更新到 v" + status.available.version : "下载并安装",
      canInstall: true
    }
  }
  if (!status.local.version) {
    // 没查过（或启动时那次静默检查没成）就是这样：先让人点「检查更新」。
    return {
      label: "还没装",
      tone: "outline",
      note: "先点「检查更新」，看发布源里有没有插件发布件。",
      action: "下载并安装",
      canInstall: false
    }
  }
  return { label: "是最新 v" + status.local.version, tone: "outline", note: "", action: "已是最新版", canInstall: false }
}

/* 差了几个文件：本地一份都没有就按全部文件说，本地有一版就按改动说。 */
function changeNote(status: PluginUpdateStatus): string {
  const available = status.available
  if (!available) return ""
  if (!status.local.version) return "远端 v" + available.version + "，共 " + available.total + " 个文件"
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
