import { readStored, writeStored } from "@/lib/storage"
import type { BoardModePolicy } from "@/lib/api"

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
  mode: "A",
  stopAfter: "",
  overwrite: false
}

// 下拉框里只显示短值，长说明放下面一行：否则触发按钮的宽度会随选中项变化，
// 弹层每次重新定位，看起来像「选一下就跳位置」。
export const MODE_HINT: Record<string, string> = {
  A: "A —— MW WPF XAML 页面",
  B: "B —— MTSLG IOContorl 页面 XML",
  AB: "AB —— 两条都跑，两次独立运行（先 A 后 B）"
}

/* 路线能力由后端 modePolicies 给；界面只按 mode 查表，不自己从字符串推断。 */
export function modePolicyOf(policies: BoardModePolicy[] | undefined, mode: string): BoardModePolicy | null {
  const wanted = String(mode || "").trim().toUpperCase()
  return (policies || []).find((item) => item.mode === wanted) || null
}

/* 两个新建入口的提交按钮用同一句话：需要页面 PNG 的路线会先暂存，再显式启动。 */
export function startActionLabel(takesPageImage: boolean): string {
  return takesPageImage ? "创建并开始" : "加入看板并开始"
}

/*
 * A 路线多一道输入：页面 PNG。图必须与设计稿画板同尺寸，而画板尺寸要等流水线取数之后才知道 ——
 * 所以新建时选好的图先跟**任务**一起暂存（键是任务 id），任务跑到「取数 + 固化快照」之后自动核对尺寸再落地。
 * A / AB 的启动门禁要求这里必须先选图。这句话只有这一处。
 */
export const READ_IMAGE_HINT =
  "按 MasterGo 画板原始尺寸导出。现在选好就跟着任务一起暂存，流水线产出画板尺寸之后自动核对落地。"

/* 这一项的标题：新建任务表单与看板弹窗都读它（两张表单对同一项说法一致）。 */
export const DESIGN_IMAGE_LABEL = "页面 PNG"

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
