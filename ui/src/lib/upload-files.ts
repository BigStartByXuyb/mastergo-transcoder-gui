import { api, type UploadedFile } from "@/lib/api"

/*
 * 选好的文件 → base64 → 后端落盘。三处入口（图片 / 文件 / 文件夹 / 拖拽）共用这一份，
 * 判据（格式、大小上限）全在后端：这一侧只负责读字节与拼 base64，不自己再判一遍。
 */

export type PickedFile = {
  file: File
  /** 选文件夹时带相对路径；选单个文件时不填。 */
  relativePath?: string
}

/**
 * 文件读成 base64：对话附件与作业A 的设计稿位图共用这一份（大图分块拼，别爆栈）。
 *
 * 这里**不**判文件大小：上限（单文件与总量）只有后端 lib/limits.js 一处判据，它按原话拒绝。
 * 前端再存一份数字，改一处就会漂 —— 宁可让超限的传一趟被后端挡回来，也不要两处口径。
 */
export async function fileToBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer())
  let binary = ""
  // 一次拼 32 KB：大图用 String.fromCharCode(...bytes) 会爆栈。
  const chunk = 0x8000
  for (let at = 0; at < buffer.length; at += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(buffer.subarray(at, at + chunk)))
  }
  return btoa(binary)
}

export async function uploadAttachments(picked: PickedFile[]): Promise<UploadedFile[]> {
  const list = picked.filter((item) => item.file)
  if (list.length === 0) return []
  const payload = []
  for (const item of list) {
    payload.push({
      name: item.file.name,
      relativePath: item.relativePath || item.file.webkitRelativePath || item.file.name,
      base64: await fileToBase64(item.file)
    })
  }
  const payloadResult = await api.agentUpload(payload)
  return payloadResult.files
}

/** 给 <img> 用的预览地址：走后端那条只认附件的读文件路由。 */
export function attachmentUrl(path: string): string {
  return "/api/agent/file?path=" + encodeURIComponent(path)
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB"
  return (bytes / (1024 * 1024)).toFixed(1) + " MB"
}
