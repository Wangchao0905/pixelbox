import type { EditParams, GeneratedImage, GenerateParams } from './image-api'

/**
 * 生成结果的中转站
 * ------------------------------------------------------------------
 * 生成页拿到图片后要把结果交给结果页。图片是长 URL 或本地临时路径，
 * 塞进路由 query 会超长且需要转义，所以在内存里交接一次。
 * 页面被直接打开（热重载 / 分享进入）时拿不到数据，结果页会走空状态。
 */

/**
 * 「再来一张」用的完整请求快照。
 * ------------------------------------------------------------------
 * 结果页一点按钮就原样重跑一次 —— 这是离钱最近的交互（用户刚拿到满意的图、
 * 正处在最愿意再花点的时刻），所以请求参数必须在生成页当场存下来，
 * 不能事后去猜。edit 形态带 reference 素材（本地临时路径，同一会话内有效）。
 */
export type RerunRequest =
  | { kind: 'generate'; params: GenerateParams }
  | { kind: 'edit'; params: EditParams }

export type PendingResult = {
  templateId: string
  title: string
  skill: string
  images: GeneratedImage[]
  /** 没有它时结果页不渲染「再来一张」 */
  rerun?: RerunRequest
}

let pending: PendingResult | null = null

export function setPendingResult(value: PendingResult) {
  pending = value
}

export function takePendingResult(): PendingResult | null {
  return pending
}
