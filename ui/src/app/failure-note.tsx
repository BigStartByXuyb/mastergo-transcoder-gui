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
              : "这一条没有具体某一步可指（流水线还没进入步骤就停下了，通常是链接 / 工程目录 / 插件这类入参问题）："
                + "按上面的原话改好，再点「从断点继续」。"}
          </span>
        )}
      </AlertDescription>
    </Alert>
  )
}
