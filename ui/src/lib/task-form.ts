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

export const AUTOMATION_LABEL: Record<string, string> = {
  off: "关（不叫模型）",
  assist: "辅助",
  auto: "自动"
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
