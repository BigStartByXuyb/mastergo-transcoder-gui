import { api, type UploadedFile } from "@/lib/api"

/*
 * 选好的文件 → base64 → 后端落盘。三处入口（图片 / 文件 / 文件夹 / 拖拽）共用这一份，
 * 顺便把「太大」在浏览器这头先拦住 —— 传到一半才说不合适太浪费。
 */

// 与后端 lib/uploads.js 的两道上限一致；这里先拦一道只是为了别白传一趟。
const MAX_FILE_BYTES = 25 * 1024 * 1024

export type PickedFile = {
  file: File
  /** 选文件夹时带相对路径；选单个文件时不填。 */
  relativePath?: string
}

async function toBase64(file: File): Promise<string> {
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
  const tooBig = list.find((item) => item.file.size > MAX_FILE_BYTES)
  if (tooBig) throw new Error("这个文件超过 25 MB：" + tooBig.file.name + "；大文件先放进工程，再让 AI 去读它的路径。")
  const payload = []
  for (const item of list) {
    payload.push({
      name: item.file.name,
      relativePath: item.relativePath || item.file.webkitRelativePath || item.file.name,
      base64: await toBase64(item.file)
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
