/* 后端接口的类型与调用封装。接口形状以 server.js / lib/routes.js 为准。 */

import { parseAgentStreamLine, type AgentStreamEvent } from "@/lib/agent-stream"

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

export type LogSlice = { from: number; next: number; truncated: boolean; text: string }

export type ProviderPreset = { id: string; label: string; baseUrl: string; model: string }

export type Settings = {
  providers: ProviderPreset[]
  ai: { provider: string; baseUrl: string; model: string; hasKey: boolean }
  automation: "off" | "assist" | "auto"
  /** 对话/自动模式的写盘开关：关着时 Codex 只读，开着才允许它直接改工程文件。 */
  agent: { allowWrite: boolean }
  /**
   * MasterGo token：hasToken 是「本机存过没有」，source/sourceLabel 是「现在实际生效的是哪一份」。
   * 两者可以不一致 —— 命令行或环境变量会盖住本机保存的那份，界面必须能把这个差别说出来。
   */
  mastergo: { hasToken: boolean; source: string; sourceLabel: string }
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
  /** 命名表里插件当前不认的下标条数（换了设计稿/图层沿用同一 Target 时的旧条目）。 */
  stale: number
  staleIndexes: number[]
  /** 资源名撞在一起的组：同一页里 name 必须唯一，重名会被第 7 步的台账直接拒绝。 */
  duplicates: { name: string; indexes: number[] }[]
  naming: { index: number; name: string; comment: string }[]
  needsNaming: boolean
  /** 命名表要重写才符合台账口径：留着插件当前不认的旧下标，或资源名有重复。 */
  needsRepair: boolean
  /** 这一节要处理多少条：缺名字 + 旧下标 + 重名组。 */
  waiting: number
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
  /** 这一节要处理多少条：待译 + 待补术语。 */
  waiting: number
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

export type BoardMergeConflict = {
  path: string
  reason: string
  /** false = 这一处不能由人拍板（本任务那份产物不合格、缺 Layout 注册入口等），只能先修好。 */
  resolvable: boolean
}

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
    /** 插件 -StopAfter：跑到这一步停下（先出待命名清单，再回来跑后半段）。 */
    stopAfter: string
    overwrite: boolean
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
  /** 冲突处已做的选择（相对路径 → mine / main），合并成功后清空。 */
  resolutions: Record<string, "mine" | "main">
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
  /** 插件 -StopAfter：一次任务统一的停点，空串表示跑到底。 */
  stopAfter: string
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
  /** 两节的待办条数，与看板 / 流水线详情同一份口径（图标一节、文案一节）。 */
  counts: { icons: number; translations: number }
  total: number
}

export type PendingQueue = { items: PendingQueueEntry[] }

/** 模板族的匹配键（真值源：映射表各族自己的 match 字段）。 */
export type MappingMatch = {
  property?: string
  componentSet?: boolean
  componentName?: boolean
  structural?: { variant?: string; signature?: { minHeaderTexts?: number } }
}

export type MappingFamily = {
  key: string
  match: MappingMatch | null
  variants: { name: string; fields: Record<string, unknown> }[]
}

export type MappingView = {
  pluginVersion: string
  /** 本路线写入规则（extends 指向共享类型表）。 */
  routePath: string
  sharedPath: string
  families: MappingFamily[]
  layoutRules: {
    bottomBar?: {
      match?: MappingMatch
      residentGroupPattern?: string
      fKeyPattern?: string
      decorativeNamePattern?: string
      menuItemAlwaysWrittenAttrs?: string[]
      iconSizeAttrs?: string[]
      variants?: Record<string, { topLeftContent?: string }>
      menuItemFlags?: Record<string, { attr?: string }>
    }
  } | null
  requiredAttrs: Record<string, string[]> | null
  ruleKeys: { key: string; entries: number }[]
  /** 映射表里形状不合预期的条目（后端跳过并记下来，界面照实显示，不静默吞）。 */
  warnings: string[]
}

/** 项目登记表里的页面条目：区域前缀的权威来源之一（插件取值链的第 2/3 级）。 */
export type ProjectPage = {
  target: string
  ui: string
  derivation: string
  fileId: string
  layerId: string
  designPageName: string
}

export type ProjectPages = {
  exists: boolean
  registryPath: string
  pages: ProjectPage[]
  problem: string
}

/** 页面身份候选：区域来自项目既有约定，语义名来自设计页名的机械转换或模型。 */
export type IdentityCandidate = {
  target: string
  ui: string
  semanticName: string
  basis: string
  needsSemanticName: boolean
  confidence?: number | null
  reason?: string
  /** 这一页在登记表里已经登记过：自动沿用走的就是这条。 */
  registered?: boolean
  /** 登记表里的页名与设计稿现在的页名不一致：改名要人确认一次。 */
  rename?: boolean
  /** 登记表里记的设计页名：沿用这条写回时要带上，否则下次改名就没人提示。 */
  designPageName?: string
}

export type IdentityCandidates = {
  uiCandidates: { ui: string; count: number; basis: string }[]
  candidates: IdentityCandidate[]
  ai: { used: boolean; items: IdentityCandidate[] }
  /** 不能自动采用时的整句原因（含人要做什么）；空串＝可以自动采用第一条。 */
  blocked: string
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

export type UpdateFailure = { code: string; message: string; hint: string }

export type UpdateTask = {
  phase: "idle" | "downloading" | "materializing" | "done" | "error"
  done: number
  total: number
  downloaded: number
  error: UpdateFailure | null
}

export type UpdateAvailable = {
  version: string
  /** 这一版改了什么；来自发布清单（同一份 changelog.json），断网也能看到上次检查的结果。 */
  notes: string[]
  releasedAt: string
  minClientVersion: string
  /** 这版要求新开一次运行（跨版本续跑过不了身份校验）。 */
  freshRunRequired: boolean
  changed: number
  removed: number
  total: number
  /** 外壳太旧时的原因：有值就表示这版现在切不过去。 */
  blocked: UpdateFailure | null
  checkedAt: string
}

export type UpdateStatus = {
  state: "up_to_date" | "update_available" | "download_ready" | "error"
  current: string
  /** 现在这一版能做什么。 */
  currentNotes: string[]
  /** 这一份运行树自带的版本历史：按版本号找「改了什么」。 */
  history: { version: string; date: string; notes: string[] }[]
  root: string
  pointer: { version?: string; previous?: string; switchedAt?: string } | null
  /** 有任务在跑时是不能切版本的，这里放原因（空串表示空闲）。 */
  busy: string
  staged: { version: string; current: boolean; ready: boolean }[]
  ready: string
  rollback: string
  available: UpdateAvailable | null
  error: UpdateFailure | null
  task: UpdateTask
  repo: string
}

export type CodexState = "verified" | "untested" | "broken"

/** 侧边栏一条对话：只有标题与来源，正文在 get 里取。 */
export type ChatSummary = {
  id: string
  title: string
  agent: string
  projectRoot: string
  createdAt: string
  updatedAt: string
  turnCount: number
}

export type ChatLine = { stream: string; line: string }

/** 一轮 = 一次提问。lines 是引擎原始输出，解析只有前端那一份（buildTurns）。 */
export type ChatTurn = {
  at: string
  prompt: string
  exitCode: number | null
  finished: boolean
  lines: ChatLine[]
}

export type ChatConversation = {
  id: string
  title: string
  agent: string
  projectRoot: string
  createdAt: string
  updatedAt: string
  turns: ChatTurn[]
}

export type CodexEngine = {
  version: string
  source: "managed" | "system"
  path: string
  state: CodexState
}

export type CodexVersion = {
  version: string
  path: string
  state: CodexState
  note: string
  active: boolean
  ready: boolean
}

export type CodexStatus = {
  /** 我们钉死的那一版；本机没有别的版本时就用它。 */
  pinned: string
  engine: CodexEngine | null
  versions: CodexVersion[]
  /** 本机自己装的 Codex：只检测，不动它。 */
  system: { version: string; path: string; active: boolean }[]
  isolated: { codexHome: string; exists: boolean; keyEnv: string }
  /** 切版本留下的指针：previous 有值就说明还能回退一次。 */
  pointer: { version?: string; previous?: string; switchedAt?: string } | null
  release: { version: string; tag: string; checkedAt: string; missing: string[]; newer: boolean } | null
  busy: string
  error: UpdateFailure | null
  task: UpdateTask
}

/** 能下载的两个运行时；claude 只检测，不进下载入口。 */
export type RuntimeId = "node" | "pwsh"

export type RuntimeTool = {
  id: RuntimeId | "claude"
  label: string
  /** 钉死的那一版；claude 不钉，恒为空串。 */
  pinned: string
  path: string
  /** 自带那份解压好且存在。claude 恒为 false。 */
  installed: boolean
  /** bundled = 用客户端自带那份 / system = 用系统上那份 / "" = 没有可用的。 */
  source: "bundled" | "system" | ""
  version: string
  ready: boolean
  /** 恒为 false：这两份在关键路径上，不提供版本切换。 */
  switchable: boolean
  note: string
}

export type RuntimeTask = {
  /** 下载 → 解压 → 自检；下载那一段按 received/size 给界面出进度。 */
  phase: "idle" | "downloading" | "extracting" | "verifying" | "done" | "error"
  tool: string
  /** 已收字节；解压、自检阶段不再增长。 */
  received: number
  /** 总字节；服务器没给 Content-Length 时恒为 0，界面据此退回不确定态。 */
  size: number
  error: UpdateFailure | null
  version: string
  startedAt: string
}

export type RuntimeStatus = {
  root: string
  tools: RuntimeTool[]
  /** 有任务在跑时是不能换运行时的，这里放原因（空串表示空闲）。 */
  busy: string
  error: UpdateFailure | null
  task: RuntimeTask
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
  /** 续跑认看板任务 id：jobId 每次续跑都会被换掉，当钥匙就会「找不到这次运行」。 */
  runResume: (taskId: string) =>
    post<{
      ok: true
      mode: string
      resumedFrom: string
      /** 因为工程里已有这一页，续跑回到了生成 Bundle 清单的那一步重算。 */
      recomputedManifest?: boolean
      /** 续跑前把命名表修回台账口径：裁掉旧下标、改掉重名，各自的条数在这里。 */
      reconciled?: { removed: number; renamed: number; kept: number; note?: string } | null
      job: Job
    }>("/api/run/resume", { taskId }),
  runStop: (runId: string) => post<{ ok: true; job: Job }>("/api/run/stop", { runId }),
  runStatus: (runId = "") =>
    request<{ ok: true; job: Job | null; steps: RunRegistryStep[] }>(
      "/api/run/status?runId=" + encodeURIComponent(runId)
    ),
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
  mapping: () => request<{ ok: true; mapping: MappingView }>("/api/mapping"),
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
    /** 看板任务 id：运行管理器里那次运行没了，也按任务把续跑重建出来。 */
    taskId?: string
    /** 来源运行 id：没有 taskId 的条目（流水线直跑、任务已移除）靠它续跑。 */
    runId?: string
    naming?: { index: number; name: string; comment: string; fromDsl?: boolean }[]
    translations?: Record<string, string>
    glossary?: Record<string, string>
    allowEmptyLedger?: boolean
    /** 顺手把命名表里当前不认的旧下标裁掉。 */
    pruneNaming?: boolean
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
  projectPages: (projectRoot: string) =>
    request<{ ok: true; pages: ProjectPages }>(
      "/api/project/pages?projectRoot=" + encodeURIComponent(projectRoot)
    ),
  /** Target → 区域前缀的预览：规则在后端，界面上只显示结论。 */
  identityPrefix: (target: string) =>
    request<{ ok: true; previewUi: string }>("/api/identity/prefix?target=" + encodeURIComponent(target)),
  /** 从链接取设计页名（中文原名，如「停止调整」）：Target 由它翻译 + 区域前缀得到。 */
  designPageName: (link: string) =>
    post<{ ok: true; pageName: string; rootId: string }>("/api/design/page-name", { link }),
  identityCandidates: (body: { projectRoot: string; pageName: string; useAi?: boolean; ui?: string; link?: string }) =>
    post<{ ok: true } & IdentityCandidates>("/api/identity/candidates", body),
  identityApply: (body: {
    projectRoot: string
    target: string
    ui: string
    fileId?: string
    layerId?: string
    link?: string
    designPageName?: string
  }) => post<{ ok: true; registryPath: string; replaced: boolean }>("/api/identity/apply", body),
  boardAdd: (body: BoardAddBody) => post<{ ok: true; board: Board; created: string[] }>("/api/board/add", body),
  boardStart: (id = "") => post<{ ok: true; board: Board }>("/api/board/start", { id }),
  boardStop: (id: string) => post<{ ok: true; board: Board }>("/api/board/stop", { id }),
  boardRemove: (id: string) => post<{ ok: true; board: Board }>("/api/board/remove", { id }),
  boardMerge: (id: string) => post<{ ok: true; board: Board; task: BoardTask }>("/api/board/merge", { id }),
  /** 冲突逐文件裁决；pick：mine 以本任务为准 / main 保留主工程 / clear 撤销选择。 */
  boardResolve: (id: string, path: string, pick: "mine" | "main" | "clear") =>
    post<{ ok: true; board: Board; task: BoardTask }>("/api/board/resolve", { id, path, pick }),
  boardMergeAll: (projectRoot: string) => post<{ ok: true; board: Board }>("/api/board/merge-all", { projectRoot }),
  boardClear: (states: string[]) => post<{ ok: true; board: Board }>("/api/board/clear", { states }),
  /** 清空一个「工程 + 区域」下的任务（侧边栏区域行的动作）；有任务在跑时后端会拒绝。 */
  boardClearArea: (projectRoot: string, ui: string) =>
    post<{ ok: true; board: Board }>("/api/board/clear-area", { projectRoot, ui }),
  updateStatus: () => request<{ ok: true; status: UpdateStatus }>("/api/update/status"),
  /** 拉远端清单：失败也回 200，原因在 status.error 里。 */
  updateCheck: () => post<{ ok: true; status: UpdateStatus }>("/api/update/check", {}),
  updateDownload: () => post<{ ok: true; started: boolean; version: string; note: string; status: UpdateStatus }>(
    "/api/update/download",
    {}
  ),
  updateApply: (version = "") =>
    post<{ ok: true; version: string; previous: string; restartRequired: boolean; status: UpdateStatus }>(
      "/api/update/apply",
      { version }
    ),
  updateRollback: () =>
    post<{ ok: true; version: string; restartRequired: boolean; status: UpdateStatus }>("/api/update/rollback", {}),
  codexStatus: () => request<{ ok: true; status: CodexStatus }>("/api/codex/status"),
  /** 拉远端发行版描述：失败也回 200，原因在 status.error 里。 */
  codexCheck: () => post<{ ok: true; status: CodexStatus }>("/api/codex/check", {}),
  codexDownload: () =>
    post<{ ok: true; started: boolean; version: string; note: string; status: CodexStatus }>("/api/codex/download", {}),
  /** 版本号为空串 = 用本机检测到的那个。 */
  codexSwitch: (version = "") =>
    post<{ ok: true; version: string; previous: string; status: CodexStatus }>("/api/codex/switch", { version }),
  codexRollback: () => post<{ ok: true; version: string; status: CodexStatus }>("/api/codex/rollback", {}),
  runtimeStatus: () => request<{ ok: true; status: RuntimeStatus }>("/api/runtime/status"),
  /** 缺哪份下哪份；上一次没结束或在跑流水线时 started 为 false，原因在 note。 */
  runtimeDownload: (tool: RuntimeId) =>
    post<{ ok: true; started: boolean; tool: string; note: string; status: RuntimeStatus }>("/api/runtime/download", {
      tool
    }),
  chatList: () => request<{ ok: true; conversations: ChatSummary[] }>("/api/agent/threads"),
  chatGet: (id: string) =>
    request<{ ok: true; conversation: ChatConversation }>("/api/agent/threads/get?id=" + encodeURIComponent(id)),
  chatNew: (body: { title?: string; projectRoot?: string } = {}) =>
    post<{ ok: true; conversation: ChatConversation; conversations: ChatSummary[] }>("/api/agent/threads/new", body),
  chatRemove: (id: string) => post<{ ok: true; conversations: ChatSummary[] }>("/api/agent/threads/remove", { id })
}

/*
 * 对话：一次提问就是一次 codex exec，后端把进程输出按行写成 NDJSON。
 * 这里逐行读、逐行回调 —— request() 是按整包 JSON 解析的，读不了这条流。
 */
export async function agentChatStream(
  body: {
    prompt: string
    /** 续跑认 thread id；新建的那条对话由后端在首轮里记下。 */
    resume?: string
    /** 落进哪条对话；空串＝后端现开一条并把它的 id 发回来。 */
    conversationId?: string
    projectRoot?: string
    write?: boolean
    writeConfirm?: string
  },
  onEvent: (event: AgentStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  let response: Response
  try {
    response = await fetch("/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal
    })
  } catch (error) {
    throw new ApiFailure("OFFLINE", "连不上本地服务", String(error instanceof Error ? error.message : error))
  }

  if (!response.ok) {
    const text = await response.text()
    let failure: { code?: string; message?: string; hint?: string } | null = null
    try {
      failure = (JSON.parse(text) as { error?: { code?: string; message?: string; hint?: string } }).error ?? null
    } catch {
      failure = null
    }
    throw new ApiFailure(failure?.code ?? "HTTP_" + response.status, failure?.message ?? "这次对话没起来", failure?.hint ?? "")
  }

  const reader = response.body?.getReader()
  if (!reader) throw new ApiFailure("NO_STREAM", "这次响应没有可读的流", "")
  const decoder = new TextDecoder()
  let buffer = ""
  const drain = () => {
    let at = buffer.indexOf("\n")
    while (at >= 0) {
      const event = parseAgentStreamLine(buffer.slice(0, at))
      if (event) onEvent(event)
      buffer = buffer.slice(at + 1)
      at = buffer.indexOf("\n")
    }
  }
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    drain()
  }
  buffer += decoder.decode()
  drain()
  const tail = parseAgentStreamLine(buffer)
  if (tail) onEvent(tail)
}
