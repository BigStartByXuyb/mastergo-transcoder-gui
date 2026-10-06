import type { Health, PluginUpdateStatus } from "@/lib/api"

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

/** 自带那一份插件的状态：没传覆盖项就是「本地装了 1.0.369，且是最新」。 */
export function pluginUpdateFixture(over: Partial<PluginUpdateStatus> = {}): PluginUpdateStatus {
  return {
    state: "up_to_date",
    local: { version: "1.0.369", dir: INSTALLED_ROOT },
    available: null,
    error: null,
    task: { phase: "idle", done: 0, total: 0, downloaded: 0, error: null },
    ...over
  }
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
