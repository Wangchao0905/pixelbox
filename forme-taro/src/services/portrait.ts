import type { ImageAsset } from './image-api'
import type { PortraitTheme } from '@/package-portrait/data/portrait-themes'

/**
 * AI 写真（UGC 人像）
 * ==================================================================
 * 用户上传 1 张自拍 + 选 1 个主题，模型把本人放进主题场景出写真。
 * 链路与模特试穿同构：`editImages([自拍], 主题 prompt)`，BATCH_SIZE=1，
 * 按张扣点。服务端零改动 —— 走的都是现成的编辑端点。
 *
 * 两个刻意的设计（抄自 services/tryon.ts）：
 *
 * ① **素材顺序是不可变约定：`[自拍]`。** 提示词里的「第一张图」
 *    就是这张，顺序由 `portraitEditImages()` 独占，页面不许自己拼数组。
 *
 * ② **主题即 prompt，页面不许改字。** 主题的完整提示词在
 *    `data/portrait-themes.ts` 里锁定，页面只传 id。
 *
 * 本文件是**纯函数**：不 import Taro、不碰路由、不发请求、不读全局状态。
 * 页面只负责状态与渲染（`package-portrait/pages/index.tsx`，分包）。
 */

export type PortraitDraft = {
  photo: ImageAsset | null
  theme: PortraitTheme | null
}

export type PortraitBlocker = 'photo' | 'theme'

export function portraitBlocker(draft: PortraitDraft): PortraitBlocker | null {
  if (!draft.photo) return 'photo'
  if (!draft.theme) return 'theme'
  return null
}

/** 字段级提示文案。**服务层持有**，页面不许内联写死。 */
export const PORTRAIT_BLOCKER_HINT: Record<PortraitBlocker, string> = {
  photo: '上传一张自拍后继续',
  theme: '选择一个写真主题后继续'
}

export function canGeneratePortrait(
  draft: PortraitDraft
): draft is PortraitDraft & { photo: ImageAsset; theme: PortraitTheme } {
  return Boolean(draft.photo && draft.theme)
}

/**
 * 交给 `editImages` 的素材 —— **不可变约定**：只有用户的自拍这一张。
 * 提示词里的「第一张图」指的就是它。
 */
export function portraitEditImages(photo: ImageAsset): ImageAsset[] {
  return [photo]
}
