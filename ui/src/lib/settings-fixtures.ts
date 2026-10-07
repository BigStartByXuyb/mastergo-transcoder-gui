import type { Health, PluginAvailable, PluginUpdateStatus, UpdateSource } from "@/lib/api"

/*
 * 设置页用例共用的那几件夹具：路径拼法、客户端健康快照、假响应。
 * 两份用例（更新页 / 运行环境页）本来各抄一份，接口加字段时容易只改一处。
 *
 * 夹具路径按段拼：源码里不出现「盘符 + 反斜杠」那种机器专属写法（结构检查会拦）。
 */

export function drive(letter: string, ...parts: string[]): string {
  return [letter + ":", ...parts].join("\\")
}

export const PLUGIN_ROOT = drive("C", "Users", "me", ".codex", "plugins", "cache", "bigstart", "mastergo-wpf-transcoder", "1.0.369")
export const ENGINE = drive("D", "app", "lib", "node-controls.js")
/** 客户端自带那一处：装好之后是 <安装根>/plugins/<插件名>/<版本>/。 */
export const INSTALL_PARENT = drive("D", "app", "plugins")
export const INSTALLED_ROOT = drive("D", "app", "plugins", "mastergo-wpf-transcoder", "1.0.369")

/** 界面侧夹具用的默认发布源：与后端 lib/source.js 的内置默认一致（两份不能互相引，各自一处、口径一致）。 */
export const SOURCE_BASE = "https://github.com/BigStartByXuyb/mastergo-transcoder-gui"

/** 发布源：程序更新与插件那一半显示的是同一处设置，夹具也只做一份。 */
export function sourceFixture(base = SOURCE_BASE): UpdateSource {
  return {
    kind: "github",
    base: base,
    manifestUrl: base + "/releases/latest/download/manifest.json",
    kinds: ["github", "gitlab", "static"]
  }
}

/** 远端清单那几项（插件这一半只用得上版本、时间与「差几个文件」）。 */
export function pluginAvailableFixture(over: Partial<PluginAvailable> = {}): PluginAvailable {
  return {
    version: "1.0.369",
    tag: "v1.0.369",
    releasedAt: "2026-10-06T00:00:00.000Z",
    changed: 0,
    removed: 0,
    total: 12,
    checkedAt: "2026-10-06T01:00:00.000Z",
    ...over
  }
}

/** 自带那一份插件的状态里，除「处境 + 清单」以外的那些（四种处境都一样）。 */
type PluginUpdateCommon = Omit<PluginUpdateStatus, "state" | "available">
export type PluginUpdateOverrides = Partial<PluginUpdateCommon> & {
  state?: PluginUpdateStatus["state"]
  available?: PluginAvailable | null
}

/**
 * 自带那一份插件的状态：没传覆盖项就是「本地装了 1.0.369，查过远端且是最新」。
 * 处境与清单的对齐只在这一处（与后端 readState 同一套：有清单才有「有新版 / 是最新」），
 * 用例只管说自己测的那一格。
 */
export function pluginUpdateFixture(over: PluginUpdateOverrides = {}): PluginUpdateStatus {
  const common: PluginUpdateCommon = {
    local: { version: "1.0.369", dir: INSTALLED_ROOT },
    error: null,
    task: { phase: "idle", done: 0, total: 0, downloaded: 0, error: null },
    busy: "",
    // 插件从哪儿取：与程序更新同一处设置（清单名不同），所以夹具也只做这一份。
    source: sourceFixture(),
    hasToken: false,
    ...over
  }
  const available = over.available === undefined ? pluginAvailableFixture() : over.available
  const state = over.state ?? (available ? "up_to_date" : "unchecked")
  if (state === "unchecked") return { ...common, state: state, available: null }
  if (state === "error") return { ...common, state: state, available: available }
  return { ...common, state: state, available: available ?? pluginAvailableFixture() }
}

export function healthFixture(version = "0.6.37"): Health {
  return {
    ok: true,
    version: version,
    supervised: true,
    plugin: { root: PLUGIN_ROOT, version: "1.0.369", engine: ENGINE, engineExists: true, runAllExists: true, failure: "" },
    frames: [],
    update: {
      state: "up_to_date",
      current: version,
      ready: "",
      busy: "",
      availableVersion: "",
      stagedFreshRunRequired: null
    }
  }
}

export function okResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}
