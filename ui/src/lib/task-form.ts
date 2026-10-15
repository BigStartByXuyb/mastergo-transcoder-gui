import { readStored, writeStored } from "@/lib/storage"

/*
 * 新建任务表单：值跨刷新记住；两个展示用文案表在这里统一一份，界面各处引用同一处。
 */

export type TaskForm = {
  link: string
  projectRoot: string
  target: string
  ui: string
  mode: string
  stopAfter: string
  overwrite: boolean
}

const EMPTY_TASK_FORM: TaskForm = {
  link: "",
  projectRoot: "",
  target: "",
  ui: "",
  mode: "B",
  stopAfter: "",
  overwrite: false
}

// 下拉框里只显示短值，长说明放下面一行：否则触发按钮的宽度会随选中项变化，
// 弹层每次重新定位，看起来像「选一下就跳位置」。
export const MODE_HINT: Record<string, string> = {
  B: "B —— MTSLG IOContorl 页面 XML（缺省）",
  A: "A —— MW WPF XAML 页面",
  AB: "AB —— 两条都跑，两次独立运行（先 A 后 B）"
}

/*
 * 这一版走不走某条路线：与后端 lib/run.js 的 routesOfMode 同一口径（AB 两条都跑，回给界面的就是
 * 展开后的 routes）。表单里只有 mode 这一个值，所以按它判，不用子串匹配 —— 新增路线值不会被误命中。
 */
export function modeTakesRoute(mode: string, route: "A" | "B"): boolean {
  return mode === "AB" || mode === route
}

/*
 * A 路线多一道输入：设计稿位图。图必须与设计稿画板同尺寸，而画板尺寸要等流水线取数之后才知道 ——
 * 所以新建时选好的图先跟**任务**一起暂存（键是任务 id），任务跑到「取数 + 固化快照」之后自动核对尺寸再落地；
 * 也可以不在这里选，等跑到那一步在任务详情里传。这句话只有这一处。
 */
export const READ_IMAGE_HINT =
  "A 路线要读设计稿位图（按设计稿原尺寸导出）：现在选好就跟着任务一起暂存，流水线产出画板尺寸之后自动核对落地；也可以等那一步在任务详情里传。"

/* 这一项的标题：新建任务表单与看板弹窗都读它（两张表单对同一项说法一致）。 */
export const DESIGN_IMAGE_LABEL = "设计稿位图"

export const AUTOMATION_LABEL: Record<string, string> = {
  off: "关（不叫模型）",
  assist: "辅助",
  auto: "自动"
}

/* 「自动」这一层级的含义：身份候选不人工确认，直接采用。按钮入口与启动前共用这条规则。 */
export function adoptsIdentityWithoutConfirm(automation: string): boolean {
  return automation === "auto"
}

const STORAGE_KEY = "mastergo-transcoder-gui.pipeline"

export function readTaskForm(): TaskForm {
  return readStored(STORAGE_KEY, EMPTY_TASK_FORM, (raw) => ({
    link: String(raw.link ?? ""),
    projectRoot: String(raw.projectRoot ?? ""),
    target: String(raw.target ?? ""),
    ui: String(raw.ui ?? ""),
    mode: String(raw.mode ?? "") || EMPTY_TASK_FORM.mode,
    stopAfter: String(raw.stopAfter ?? ""),
    overwrite: raw.overwrite === true
  }))
}

export function writeTaskForm(form: TaskForm): void {
  writeStored(STORAGE_KEY, form)
}
