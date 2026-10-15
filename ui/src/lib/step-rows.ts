import type { BoardTask, PipelineStep } from "@/lib/api"

/*
 * 步骤条的数据映射：契约（顺序与标题）+ 这一次运行的登记表（状态、耗时、补输入记录）合成一行
 * 「步骤条上的一步」。步骤条与步骤界面读的都是这一份，映射只在这里一处 ——
 * 两处各拼一遍，就会出现「条上写完成、这一步的面板写未开始」这种对不上的情况。
 */

export type StepRow = {
  id: number
  name: string
  title: string
  status: string
  seconds: number
  humanInput: boolean
  /** 这一步被 AI 补过输入（续跑时记在消费它的那一步上）。 */
  aiFill: string[]
  /** 补输入时实际停在哪一步的一句话（与上面那一步常常不是同一步）。 */
  aiFillNote: string
  note: string
}

type RegisteredStep = BoardTask["steps"][number]

/* 登记表给不出这一行时才用的默认值：没跑到的步骤就是「未开始」。 */
function fromRun(run: RegisteredStep | null) {
  return {
    status: run ? run.status : "pending",
    seconds: run ? run.seconds : 0,
    humanInput: run ? run.humanInput : false,
    aiFill: run && run.aiFill ? run.aiFill.filled : [],
    note: run ? run.note : ""
  }
}

// 补输入记在「消费它的那一步」上，当时实际停在哪一步另说：两处不同才补这句话。
function aiFillNoteOf(name: string, run: RegisteredStep | null, contract: PipelineStep[]) {
  const stoppedAt = run && run.aiFill ? run.aiFill.stoppedAt : "";
  if (!stoppedAt || stoppedAt === name) return "";
  const step = contract.find((item) => item.Name === stoppedAt);
  return "（当时停在第 " + (step ? step.Id : "?") + " 步）";
}

/* 造一行：契约那一项给序号与标题，其余字段一律从登记表那一行来（默认值在 fromRun 一处）。 */
function buildRow(item: { id: number; name: string; title: string }, run: RegisteredStep | null, contract: PipelineStep[]): StepRow {
  return Object.assign({ id: item.id, name: item.name, title: item.title }, fromRun(run), {
    aiFillNote: aiFillNoteOf(item.name, run, contract)
  });
}

/** 契约里的每一步各一行（没跑到的也列出来）。 */
export function stepRowsOf(contract: PipelineStep[], runs: RegisteredStep[]): StepRow[] {
  return contract.map(function (item) {
    const run = runs.find(function (entry) { return entry.name === item.Name; }) ?? null;
    // 这一步叫什么与后端同一口径（lib/board.js 的 titleOfStep）：没给 Title 的步骤用步骤名，不留空白。
    return buildRow({ id: item.Id, name: item.Name, title: item.Title || item.Name }, run, contract);
  });
}

/**
 * 某一步那一行：契约里有就用契约的顺序/标题；契约还没读到、或那一步不在契约里时，
 * 用登记表那一行造一条，保证点哪一步都不会变成空白。
 */
export function stepRowOf(contract: PipelineStep[], runs: RegisteredStep[], name: string): StepRow {
  const item = contract.find(function (entry) { return entry.Name === name; }) ?? null;
  const run = runs.find(function (entry) { return entry.name === name; }) ?? null;
  // 契约里没有那一步（还没读到契约 / 那一步不在契约里）：用登记表那一行造标题，合成路径仍是上面那一条。
  const fallback = { id: run ? run.id : 0, name: name, title: name };
  // 与 stepRowsOf 同一口径：没给 Title 的步骤用步骤名（后端 lib/board.js 的 titleOfStep 也是这么取的）。
  return buildRow(item ? { id: item.Id, name: item.Name, title: item.Title || item.Name } : fallback, run, contract);
}
