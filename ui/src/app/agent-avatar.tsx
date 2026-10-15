import { PixelMascot } from "@/app/pixel-mascot"

/*
 * 对话里的身份头像框：左右两侧同尺寸，一眼分得出谁在说。
 * 它那侧是像素小狐狸（设计转码这家伙的门面），你这侧是「你」。
 */

export function AgentAvatar(props: { name: string }) {
  return (
    <span
      aria-label={props.name}
      title={props.name}
      className="bg-card flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border"
    >
      <PixelMascot cell={1.5} />
    </span>
  )
}

export function UserAvatar() {
  return (
    <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg text-xs">
      你
    </span>
  )
}
