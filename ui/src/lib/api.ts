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
  /** 失败摘要后面那几行：真正的原因常常写在这里（例如「目标文件已存在，未覆盖: …」）。 */
  detail: string
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
  /** sourceId 是否指向页面根：是则几何为整页级别，命名表必须标 fromDsl。由后端机械判定。 */
  sourceIsPageRoot?: boolean
  /** 命名表里是否已经有名字（后端跟已写入的命名表比对得出）。 */
  filled?: boolean
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
  /** 需登记但命名表里还没名字的条数。 */
  missing: number
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
  /** 派生不出语义键、必须靠术语表给标识符的条目（插件按 provisionalKeys 分组得出）。 */
  glossaryRequired: { key: string; text: string; menuIndex?: number }[]
  translations: Record<string, string>
  glossary: Record<string, string>
  needsTranslation: boolean
  needsGlossary: boolean
}

export type Pending = {
  projectRoot: string
  target: string
  summary: unknown
  icons: PendingIcons
  translations: PendingTranslations
}

export type ArtifactEntry = {
  file: string
  kind: string
  exists: boolean
  sha256: string | null
  dependsOn: string | null
}

export type Artifacts = {
  available: boolean
  reason?: string
  runId: string
  mode: string
  updatedAt: string
  project: ArtifactEntry[]
  audit: ArtifactEntry[]
  backupCount: number
  cleanedCount: number
  /** 插件运行登记表里的步骤（跨多次运行合并的一份）。 */
  steps: RunRegistryStep[]
  summary: {
    generatedAt: string
    page: unknown
    pageProduct: unknown
    todos: { kind?: string; count?: number; byReason?: Record<string, number>; note?: string }[]
    notices: unknown[]
  } | null
}

export type RunRegistryStep = {
  id: number
  name: string
  status: string
  seconds: number
  note: string
}

export type BoardTaskState =
  | "queued"
  | "preparing"
  | "running"
  | "waiting"
  | "ready"
  | "merging"
  | "merged"
  | "conflict"
  | "failed"
  | "stopped"

export type BoardTaskRun = {
  label: string
  state: string
  done: number
  total: number
  currentTitle: string
}

export type BoardProgress = {
  done: number
  total: number
  currentTitle: string
  runs: BoardTaskRun[]
}

export type BoardMergeConflict = { path: string; reason: string }

export type BoardMergeReport = {
  at: string
  applied: string[]
  skipped: string[]
  notes: string[]
  conflicts: BoardMergeConflict[]
}

export type BoardTask = {
  id: string
  createdAt: string
  updatedAt: string
  state: BoardTaskState
  /** 中文状态名，后端给好，界面直接用。 */
  stateLabel: string
  request: {
    mode: "A" | "B" | "AB"
    link: string
    target: string
    ui: string
    projectRoot: string
    fileId: string
    layerId: string
  }
  /** 这次运行在当前进程里的 id；客户端重启后为空或指向已经结束的那次。 */
  jobId: string
  /** 这个任务自己的工作目录（流水线的 -ProjectRoot）。 */
  workDir: string
  autoMerge: boolean
  progress: BoardProgress | null
  /** 这一页的流程：步骤来自插件自己的运行登记表，续跑会接着写同一份。 */
  steps: BoardTaskStep[]
  aiFills: BoardAiFill[]
  failure: {
    /** semantic = 停在语义判断点（不是错误）；error = 真的失败。 */
    kind: "" | "semantic" | "error"
    stepName: string
    title: string
    message: string
    logPath: string
  } | null
  merge: BoardMergeReport | null
  error: string
}

export type BoardAiFill = {
  at: string
  /** 补的输入由这一步消费（续跑锚点）。 */
  stepName: string
  stepTitle: string
  /** 流水线当时停在哪一步。 */
  stoppedAt: string
  filled: string[]
}

export type BoardTaskStep = {
  id: number
  name: string
  status: string
  seconds: number
  note: string
  /** 这一步吃人/AI 写的输入文件（判据取自插件步骤契约的 Inputs）。 */
  humanInput: boolean
  aiFill: BoardAiFill | null
}

export type Board = {
  workRoot: string
  limits: { logical: number; limit: number }
  /** 正在占并发额度的任务数。 */
  running: number
  tasks: BoardTask[]
}

export type BoardAddBody = {
  projectRoot: string
  ui: string
  autoMerge: boolean
  /** 目标工程里已经有同名页面时是否替换（对应流水线的「替换已有产物」）。 */
  overwrite: boolean
  items: { link: string; target: string; mode: "A" | "B" | "AB" }[]
}

/** 一条「还缺语义输入」的页面。board = 看板任务（产物在它自己的工作目录里），pipeline = 流水线页直跑的运行。 */
export type PendingQueueEntry = {
  source: "board" | "pipeline"
  projectRoot: string
  target: string
  runId: string
  taskId: string
  runState: string
  /** 看板任务已经被移除，但工作目录与产物还在。 */
  orphan: boolean
  counts: { icons: number; translations: number; glossary: number }
  total: number
}

export type PendingQueue = { items: PendingQueueEntry[] }

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
  runResume: (runId: string) =>
    post<{
      ok: true
      mode: string
      resumedFrom: string
      /** 因为工程里已有这一页，续跑回到了生成 Bundle 清单的那一步重算。 */
      recomputedManifest?: boolean
      job: Job
    }>("/api/run/resume", { runId }),
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
  pendingList: () => request<{ ok: true; queue: PendingQueue }>("/api/pending/list"),
  artifacts: (projectRoot: string, target: string) =>
    request<{ ok: true; artifacts: Artifacts }>(
      "/api/artifacts?projectRoot=" + encodeURIComponent(projectRoot) + "&target=" + encodeURIComponent(target)
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
  aiGlossary: (texts: string[]) =>
    post<{ ok: true; items: { text: string; identifier: string }[] }>("/api/ai/suggest", {
      kind: "glossary",
      texts
    }),
  confirm: (body: {
    projectRoot: string
    target: string
    runId?: string
    naming?: { index: number; name: string; comment: string; fromDsl?: boolean }[]
    translations?: Record<string, string>
    glossary?: Record<string, string>
    allowEmptyLedger?: boolean
    resume?: boolean
  }) =>
    post<{
      ok: true
      written: { path: string; count: number }[]
      job: Job | null
      note?: string
      /** 续跑从哪一步开始（补进去的输入由这一步消费）。 */
      resumedFrom?: string
    }>("/api/confirm", body),
  board: () => request<{ ok: true; board: Board }>("/api/board"),
  boardAdd: (body: BoardAddBody) => post<{ ok: true; board: Board }>("/api/board/add", body),
  boardStart: (id = "") => post<{ ok: true; board: Board }>("/api/board/start", { id }),
  boardStop: (id: string) => post<{ ok: true; board: Board }>("/api/board/stop", { id }),
  boardRemove: (id: string) => post<{ ok: true; board: Board }>("/api/board/remove", { id }),
  boardMerge: (id: string) => post<{ ok: true; board: Board; task: BoardTask }>("/api/board/merge", { id }),
  boardMergeAll: (projectRoot: string) => post<{ ok: true; board: Board }>("/api/board/merge-all", { projectRoot }),
  boardClear: (states: string[]) => post<{ ok: true; board: Board }>("/api/board/clear", { states })
}
