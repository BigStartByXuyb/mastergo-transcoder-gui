import { ClampText } from "@/app/clamp-text"
import { IdentifierText } from "@/app/identifier-text"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { BoardTask, PipelineStep } from "@/lib/api"

/*
 * 停点 / 失败说明：原因原话、这一步的日志、以及契约给的「可能的原因 / 修好后怎么继续」。
 *
 * 步骤界面与任务总览都挂它 —— 同一份说明只有这一处渲染，两边的措辞与字段顺序不会分叉。
 * 两者只差一句「到左边第 N 步看」的指引：那是总览里才需要的话（在步骤界面里再说一遍是废话）。
 */

/**
 * 停点 / 失败那一行的标题：说明卡与看板任务行都用它 —— 同一句措辞只有这一处。
 * error = 真失败（分「某一步失败」与「还没进步骤就没跑起来」两种），其余是语义停点。
 */
export function failureTitle(failure: BoardTask["failure"]): string {
  if (!failure) return ""
  if (failure.kind !== "error") return "停在语义判断点，不是错误：" + (failure.title || failure.stepName)
  return failure.stepName
    ? "这一步失败了：" + (failure.title || failure.stepName)
    : "这次运行没跑起来："
}

export function FailureNote(props: {
  failure: BoardTask["failure"]
  /** 停点那一步的契约（能定位到某一步时才有）：它的 Failures / Recovery 就是插件给的修法。 */
  contractStep: PipelineStep | null
  /** 停点那一步在流水线里的序号；0 = 没有具体某一步可指（流水线还没进步骤就停下了）。 */
  stopStepNumber: number
  /**
   * 这一条还能不能「从断点继续」（判据在 ui/src/lib/task-state.ts 的 canResume）。
   * 只有总览那份（不传 inStepView 的调用方）在「没有具体某一步」那一支里读它；
   * 步骤视图不用传 —— 那边这一支不渲染（要判断也得先拿到整条任务，那是页面的事）。
   */
  resumable?: boolean
  /** 挂在步骤界面里（不再写「到左边那一步看」）。 */
  inStepView?: boolean
}) {
  const failure = props.failure
  if (!failure) return null
  const atStep = Boolean(failure.stepName)
  return (
    <Alert variant={failure.kind === "error" ? "destructive" : "default"}>
      <AlertTitle>{failureTitle(failure)}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        {failure.message && <ClampText text={failure.message} />}
        {failure.logPath && (
          <span className="text-muted-foreground text-xs">
            这一步的日志：<IdentifierText text={failure.logPath} />
          </span>
        )}
        {props.contractStep ? (
          <>
            <div>
              <div className="text-xs font-medium">可能的原因</div>
              <ul className="list-disc pl-5 text-xs">
                {props.contractStep.Failures.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs font-medium">修好后怎么继续</div>
              <ul className="list-disc pl-5 text-xs">
                {props.contractStep.Recovery.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </>
        ) : null}
        {props.inStepView ? null : (
          <span className="text-muted-foreground text-xs">
            {atStep
              ? "左边第 " + props.stopStepNumber + " 步标着「停这里」，那一步的界面里也有这份说明。"
              : props.resumable
                ? "这一条没有具体某一步可指：按上面的原话把要改的那一处改好，再点「从断点继续」。"
                : /*
                   * 没进步骤就停下＝没有断点可续：只说要改的是「原话里指出的那一处」，不替它归因 ——
                   * 入参不对（链接 / 页面名 / 工程目录）与起不来（运行时、插件）都会停在这一支
                   * （lib/run.js 起子进程失败、进步骤前退出都写成 stepName 为空）。
                   */
                  "这一条没有具体某一步可指：这次运行还没进入任何步骤就结束了，没有断点可续。"
                  + "按上面的原话把该改的那一处改好（是入参就改链接 / 页面名 / 工程目录，是起不来就看运行时与插件），"
                  + "再把这一条删掉，重新加一条（侧边栏「+ 新建任务」，或在看板「创建任务」里）。"}
          </span>
        )}
      </AlertDescription>
    </Alert>
  )
}
