import type { ImageAsset } from './image-api'

/**
 * 灵感复刻
 * ==================================================================
 * 用一张自有产品图 + 一张视觉参考图，生成一张「以你的产品为主体、
 * 借鉴所选视觉要素」的新图。
 *
 * ⚠️ 这不是泛化的图生图，也**不承诺复制参考图**：
 *    参考图**只**提供用户选中的那一个维度（构图 / 光影 / 色彩氛围），
 *    其余一切（人物、Logo、文字、商标、可识别产品）都不进入结果。
 *    这条边界写在两处，**改一处必须改另一处**：
 *      · 提示词 —— `buildReferenceRecreatePrompt()`（给模型的指令）
 *      · 界面   —— 页面上的权利确认（给用户的预期）
 *
 * 本文件是**纯函数**：不 import Taro、不碰路由、不发请求、不读全局状态。
 * 页面只负责状态与渲染（`pages/create-reference/index.tsx`），
 * 这样这套编排能被 `scripts/test-reference-recreate.mjs` 直接测。
 */

/** 复刻重点。顺序即界面上的展示顺序。 */
export const RECREATE_FOCUS = ['composition', 'lighting', 'palette'] as const
export type RecreateFocus = (typeof RECREATE_FOCUS)[number]

/**
 * 补充说明的字数上限。
 * 页面上的 `maxlength` 与这里**同源**，不许各写一份 —— 两处不一致时，
 * 计数器显示的和真正发出去的长度会不一样，而那种错不报错。
 */
export const RECREATE_NOTE_MAX = 160

export type ReferenceRecreateDraft = {
  product: ImageAsset | null
  reference: ImageAsset | null
  focus: RecreateFocus
  note: string
  rightsConfirmed: boolean
}

export type ReferenceRecreateInput = {
  product: ImageAsset
  reference: ImageAsset
  focus: RecreateFocus
  note: string
}

const FOCUS_LABEL: Record<RecreateFocus, string> = {
  composition: '构图',
  lighting: '光影',
  palette: '色彩氛围'
}

/**
 * 每个维度**只复刻这一件事**，其余重新组织。
 * 写得具体是有原因的：只说「参考构图」时模型很容易把参考图整张搬过来
 * （人物、Logo、文字一起进画面），而这正是要禁止的。
 */
const FOCUS_INSTRUCTION: Record<RecreateFocus, string> = {
  composition: '只借鉴参考图的构图：主体在画面中的位置与占比、留白与视线的走向、画面被分割的比例关系。',
  lighting: '只借鉴参考图的光影：主光的方向与角度、明暗对比的强度、高光与阴影的软硬、环境光的色温。',
  palette: '只借鉴参考图的色彩氛围：主色与辅助色的关系、饱和度与明度的区间、整体色调的倾向。'
}

/** 复刻重点 → 中文标签。也是写进资产库的 `skill`。 */
export function recreateFocusLabel(focus: RecreateFocus): string {
  return FOCUS_LABEL[focus] ?? FOCUS_LABEL.composition
}

/**
 * 选择器选项：**从 `RECREATE_FOCUS` 派生**，不另写一份清单。
 * 两处各写一份的话，加一个维度时界面会漏掉它 —— 不报错，只是选不到。
 */
export const RECREATE_FOCUS_OPTIONS: readonly { value: RecreateFocus; label: string }[] =
  RECREATE_FOCUS.map((value) => ({ value, label: FOCUS_LABEL[value] }))

/**
 * 还差什么才能生成。`null` = 齐了。
 * ------------------------------------------------------------------
 * 与 `canGenerateReferenceRecreate` **同源**：判定顺序一致。
 * 页面用它来显示字段级提示，而不是自己再写一遍 if 链 ——
 * 两套判定一定会漂，漂了之后「按钮能点但提示说缺图」这类状态就会出现。
 */
export type RecreateBlocker = 'product' | 'reference' | 'rights'

export function recreateBlocker(draft: ReferenceRecreateDraft): RecreateBlocker | null {
  if (!draft.product) return 'product'
  if (!draft.reference) return 'reference'
  if (!draft.rightsConfirmed) return 'rights'
  return null
}

/** 字段级提示文案。**服务层持有**，页面不许内联写死（文案要能一处改）。 */
export const RECREATE_BLOCKER_HINT: Record<RecreateBlocker, string> = {
  product: '添加产品图片后继续',
  reference: '添加视觉参考后继续',
  rights: '确认你拥有或获准使用这张视觉参考后继续'
}

/**
 * 两张图 + 权利确认都齐了才能生成。
 *
 * 类型谓词是刻意的：调用方 `if (!canGenerate(...)) return` 之后，
 * `draft.product` / `draft.reference` 会被收窄成非空，不用再写 `!`。
 * 这样「校验」和「使用」是同一个判据，不可能不一致。
 */
export function canGenerateReferenceRecreate(
  draft: ReferenceRecreateDraft
): draft is ReferenceRecreateDraft & {
  product: ImageAsset
  reference: ImageAsset
  rightsConfirmed: true
} {
  return Boolean(draft.product && draft.reference && draft.rightsConfirmed)
}

/**
 * 编排提示词。
 * ------------------------------------------------------------------
 * 必须明确传达四件事（顺序就是给模型的读图顺序）：
 *   ① 图一 = 唯一产品主体，保留轮廓 / 材质 / 包装比例 / 可读文字；
 *   ② 图二 = 视觉来源，**只**提供被选中的那一项；
 *   ③ 只复刻选择项，参考图里的人物 / Logo / 文字 / 商标 / 可识别产品都不许进；
 *   ④ 结合 `note`。
 *
 * ⚠️ `note` 为空时**整段不出现**。不许输出 `补充说明：undefined` 或
 *    `补充说明：`（空值）—— 那会被模型当成一条真实指令去执行
 *    （「不要有任何补充说明」），结果反而多出一条我们没想下的约束。
 */
export function buildReferenceRecreatePrompt(input: ReferenceRecreateInput): string {
  const focusLabel = recreateFocusLabel(input.focus)

  const lines = [
    '以图一中的产品为本次画面**唯一的产品主体**，创作一张新的商业视觉。',
    '保持它的轮廓、材质、包装比例与包装上可读的文字；不要把它换成别的产品，也不要改动包装上的文字。',
    '',
    '图二是视觉参考，**只**提供下面这一项被选中的视觉要素，图中的其他一切都不进入结果。',
    `复刻重点：${focusLabel}。${FOCUS_INSTRUCTION[input.focus]}`,
    '',
    '禁止：不要把参考图中的人物、Logo、文字、商标或可识别的产品复制、改写或近似还原进结果；',
    '不要逐像素照搬参考图；不要模仿任何品牌的标识或视觉识别系统。',
    `除「${focusLabel}」之外，画面的其余部分重新组织。`
  ]

  const note = input.note.trim()
  if (note) lines.push('', `补充说明：${note}`)

  return lines.join('\n')
}

/**
 * 交给 `editImages` 的素材顺序 —— **不可变约定**：`[产品, 参考]`。
 * ------------------------------------------------------------------
 * 提示词里的「图一 / 图二」就是按这个顺序写的。顺序反了，模型会把
 * 参考图当产品、把产品当参考 —— 出图看着还挺好看，只是主体不是用户的产品。
 * **这种错不会报错**，所以顺序由这个函数独占，页面不许自己拼数组。
 */
export function recreateEditImages(input: ReferenceRecreateInput): ImageAsset[] {
  return [input.product, input.reference]
}
