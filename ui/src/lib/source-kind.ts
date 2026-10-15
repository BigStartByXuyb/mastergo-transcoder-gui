/*
 * 发布源类型的显示名：徽章（「更新来源」那一行、改发布源的弹窗）与弹窗里的类型下拉读同一处。
 * 后端认哪几种由 status.source.kinds 给（lib/source.js 一处），这里只把枚举翻成给人看的名字；
 * 没登记的取值直接用原值，不猜。
 */

export const SOURCE_KIND_LABELS: Record<string, string> = {
  github: "GitHub 仓库",
  gitlab: "GitLab 通用包",
  static: "静态目录（nginx / 共享盘）"
}

export function sourceKindLabel(kind: string): string {
  return SOURCE_KIND_LABELS[kind] ?? kind
}
