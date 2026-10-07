import type { PluginAvailable, PluginUpdateStatus } from "@/lib/api"
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
  // 有新版这一格一定带着远端清单（类型就这么写的），所以这里只看处境、不再判一次有没有清单。
  if (status.state === "update_available") {
    const installed = Boolean(status.local.dir)
    return {
      label: "有新版 v" + status.available.version,
      tone: "secondary",
      note: changeNote(status, status.available),
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
  // 走到这里只剩「是最新」（error / unchecked / 有新版都在上面返回了）：清单一定在，本地读得出版本才说得上「是最新」。
  return {
    label: status.local.version ? "是最新 v" + status.local.version : "已装",
    tone: "outline",
    // 已是最新就不再说「差几个文件」（那是 0，说了是噪音）。
    note: "",
    action: "已是最新版",
    canInstall: false
  }
}

/* 差了几个文件：本地一份都没有就按全部文件说，本地有一版就按改动说。 */
function changeNote(status: PluginUpdateStatus, available: PluginAvailable): string {
  if (!status.local.dir) return "远端 v" + available.version + "，共 " + available.total + " 个文件"
  if (!status.local.version) return "远端 v" + available.version + "：本地这一份读不出版本，按它重装一遍"
  return "远端 v" + available.version + "，差 " + available.changed + " 个文件"
}
