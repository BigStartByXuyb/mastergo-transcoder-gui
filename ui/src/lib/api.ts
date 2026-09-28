/* 后端接口的类型与调用封装。接口形状以 server.js / lib/routes.js 为准。 */

export type PluginSummary = {
  root: string
  version: string
  engine: string
  engineExists: boolean
  runAllExists: boolean
}

export type FrameEntry = {
  fileId: string
  layerId: string
  name: string
  from: string
  verified: boolean
}

export type Health = {
  ok: true
  version: string
  plugin: PluginSummary
  frames: FrameEntry[]
}

export type PipelineStep = {
  Id: number
  Name: string
  Title: string
  Inputs: string[]
  Outputs: string[]
  Failures: string[]
  Recovery: string[]
}

export type PluginInfo = {
  ok: true
  plugin: PluginSummary
  steps: PipelineStep[]
}

export type ResolvedNode = {
  ref: string
  id: string
  layerId: string
  name: string
  text: string
  type: string
  pageAbsX?: number
  pageAbsY?: number
  width?: number
  height?: number
  template?: string
  controlType?: string
  xml?: string
}

export type ResolveResult = {
  ok: true
  mode: "single" | "container"
  requested: { fileId: string; layerId: string; pageId: string }
  frame: { layerId: string; from: string; verified: boolean }
  target: ResolvedNode | null
  candidates: ResolvedNode[]
  capture: { pageKey: string; source: string; totalCount: number; mappedCount: number }
  nodes: ResolvedNode[]
  notes: string[]
  elapsedMs: number
}

export type RunStepState = "pending" | "running" | "ok" | "failed" | "skipped"

export type RunStep = {
  id: number
  name: string
  title: string
  state: RunStepState
  seconds: number | null
  note: string
}

export type RunFailure = {
  stepId: number
  stepName: string
  message: string
  resume: string
  contract: PipelineStep | null
}

export type RunEntry = {
  mode: string
  label: string
  state: "pending" | "running" | "done" | "failed" | "stopped"
  startedAt: string
  endedAt: string
  exitCode: number | null
  currentStep: number
  steps: Record<string, RunStep>
  failure: RunFailure | null
  command: string
}

export type JobState = "running" | "stopping" | "stopped" | "done" | "failed"

export type Job = {
  id: string
  createdAt: string
  state: JobState
  request: {
    projectRoot: string
    target: string
    layerId: string
    fileId: string
    ui: string
    mode: string
    stopAfter: string
    progress: string
    overwrite: boolean
  }
  plan: string[]
  runs: RunEntry[]
  log: { base: number; next: number }
  error: string
}

export type RunStartRequest = {
  projectRoot: string
  link?: string
  target?: string
  layerId?: string
  fileId?: string
  ui?: string
  mode?: string
  stopAfter?: string
  overwrite?: boolean
}

export type LogSlice = { from: number; next: number; truncated: boolean; text: string }

export type ProviderPreset = { id: string; label: string; baseUrl: string; model: string }

export type Settings = {
  providers: ProviderPreset[]
  ai: { provider: string; baseUrl: string; model: string; hasKey: boolean }
  automation: "off" | "assist" | "auto"
}

export type IconCandidate = {
  index: number
  sourceRef: string
  svgName: string
  nodeName: string
  status: string
  reason: string
  ownerText: string
  ownerControlType: string | null
  parentType: string
  siblingPathCount: number
  registration: { register: boolean; basis: string; source: string; matchedName?: string }
  ledgerFields: { iconSize?: { width: number; height: number } }
}

export type PendingIcons = {
  available: boolean
  reason?: string
  candidatesPath: string
  namingPath: string
  registrationSummary: {
    register: number
    skip: number
    review: number
    byBasis: Record<string, number>
    notes: string
  } | null
  candidates: IconCandidate[]
  mustName: IconCandidate[]
  naming: { index: number; name: string; comment: string }[]
  needsNaming: boolean
}

export type PendingText = { key: string; locale: string; text: string; sourceRef: string }

export type PendingTranslations = {
  available: boolean
  reason?: string
  translationsPath: string
  glossaryPath: string
  pendingTranslations: PendingText[]
  glossaryRequired: unknown[]
  translations: Record<string, string>
  needsTranslation: boolean
}

export type Pending = {
  projectRoot: string
  target: string
  summary: unknown
  icons: PendingIcons
  translations: PendingTranslations
}

export class ApiFailure extends Error {
  code: string
  hint: string

  constructor(code: string, message: string, hint: string) {
    super(message)
    this.name = "ApiFailure"
    this.code = code
    this.hint = hint
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch (error) {
    throw new ApiFailure("OFFLINE", "连不上本地服务", String(error instanceof Error ? error.message : error))
  }

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      throw new ApiFailure("BAD_RESPONSE", "服务返回的不是 JSON", text.slice(0, 300))
    }
  }

  if (!response.ok) {
    const failure = (payload as { error?: { code?: string; message?: string; hint?: string } } | null)?.error
    throw new ApiFailure(failure?.code ?? "HTTP_" + response.status, failure?.message ?? "请求失败", failure?.hint ?? "")
  }
  return payload as T
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  })
}

export const api = {
  health: () => request<Health>("/api/health"),
  plugin: () => request<PluginInfo>("/api/plugin"),
  resolve: (body: { link: string; frameLink: string; projectDir: string }) => post<ResolveResult>("/api/resolve", body),
  runStart: (body: RunStartRequest) => post<{ ok: true; job: Job }>("/api/run", body),
  runStop: (runId: string) => post<{ ok: true; job: Job }>("/api/run/stop", { runId }),
  runStatus: (runId = "") =>
    request<{ ok: true; job: Job | null }>("/api/run/status?runId=" + encodeURIComponent(runId)),
  runLog: (runId: string, from: number) =>
    request<{ ok: true } & LogSlice>(
      "/api/run/log?runId=" + encodeURIComponent(runId) + "&from=" + Math.max(0, from)
    ),
  settingsGet: () => request<{ ok: true; settings: Settings }>("/api/settings"),
  settingsSave: (body: unknown) => post<{ ok: true; settings: Settings }>("/api/settings", body),
  pending: (projectRoot: string, target: string) =>
    request<{ ok: true; pending: Pending }>(
      "/api/pending?projectRoot=" + encodeURIComponent(projectRoot) + "&target=" + encodeURIComponent(target)
    ),
  aiIconNames: (mustName: IconCandidate[]) =>
    post<{ ok: true; items: { index: number; name: string; comment: string; confidence: number | null }[] }>(
      "/api/ai/suggest",
      { kind: "icon-name", mustName }
    ),
  aiTranslations: (texts: string[]) =>
    post<{ ok: true; items: { text: string; translation: string }[] }>("/api/ai/suggest", {
      kind: "translation",
      texts
    }),
  confirm: (body: {
    projectRoot: string
    target: string
    runId?: string
    naming?: { index: number; name: string; comment: string }[]
    translations?: Record<string, string>
    allowEmptyLedger?: boolean
    resume?: boolean
  }) => post<{ ok: true; written: { path: string; count: number }[]; job: Job | null; note?: string }>("/api/confirm", body)
}
