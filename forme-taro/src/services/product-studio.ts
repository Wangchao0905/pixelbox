import type { ImageAsset } from './image-api'

/**
 * 产品工作室：产品拍摄 + 电商主图
 * ==================================================================
 * 两个**固定工作流**共用一份编排。它们在界面上是两个入口、在代码里是
 * 同一个 `ProductStudioIntent` 联合类型 —— 这样「标题 / 技能名 / 默认比例 /
 * 提示词 / 素材顺序」只有一份定义。
 *
 * ⚠️ 为什么必须只有一份：这两件事的差别**只在提示词约束**上。
 *    如果 `product-gallery`、`create-product-shot`、`create-marketplace`
 *    各维护一份模式表和提示词，加一个模式时漏改一处 —— 不报错，
 *    只是那个模式下发出的提示词是错的，而图照样能出来。
 *
 * ⚠️ 与「灵感复刻」的**根本区别**：这里**没有视觉参考图**。
 *    产品主体只能来自用户上传的那一张图，所以
 *    `productStudioEditImages()` **永远返回 `[product]`** ——
 *    不要因为「看着差不多」就把它和 `recreateEditImages()` 合并。
 *
 * 本文件是**纯函数**：不 import Taro、不碰路由、不发请求、不读全局状态。
 * 页面只负责状态与渲染，编排全部在这里，好让
 * `scripts/test-product-studio.mjs` 能直接测。
 */

/** 产品拍摄的三个模式。顺序即界面展示顺序。 */
export const PRODUCT_SHOT_MODES = ['studio', 'lifestyle', 'with_model'] as const
export type ProductShotMode = (typeof PRODUCT_SHOT_MODES)[number]

/** 电商主图的三个镜头。顺序即界面展示顺序。 */
export const MARKETPLACE_SHOTS = ['white_background', 'color_benefit', 'detail_closeup'] as const
export type MarketplaceShot = (typeof MARKETPLACE_SHOTS)[number]

/**
 * 创作意图。`kind` 是判别字段。
 * ------------------------------------------------------------------
 * 用联合类型而不是「mode + shot 两个可选字段」：后者会出现
 * 「两个都有值」和「两个都空」这两种非法状态，而它们都不会报错。
 */
export type ProductStudioIntent =
  | { kind: 'product-shot'; mode: ProductShotMode }
  | { kind: 'marketplace'; shot: MarketplaceShot }

export type ProductStudioDraft = {
  product: ImageAsset | null
  intent: ProductStudioIntent
  note: string
}

export type ProductStudioInput = {
  product: ImageAsset
  intent: ProductStudioIntent
  note: string
}

/**
 * 补充说明的字数上限。
 * 与页面上的 `maxlength` **同源** —— 两处各写一份时，计数器显示的和
 * 真正发出去的长度会不一样，而那种错不报错。
 */
export const PRODUCT_STUDIO_NOTE_MAX = 160

const MODE_LABEL: Record<ProductShotMode, string> = {
  studio: '棚拍',
  lifestyle: '生活方式',
  with_model: '人物使用'
}

const SHOT_LABEL: Record<MarketplaceShot, string> = {
  white_background: '白底主图',
  color_benefit: '纯色卖点图',
  detail_closeup: '细节特写'
}

/**
 * 选择器上每个模式 / 镜头的一句话说明。
 * 和 `INTENT_INSTRUCTION` 是**两件事**：那边是发给模型的约束，
 * 这边是给用户看的。不要合并 —— 把提示词原文露给用户既长又难读。
 */
const MODE_COPY: Record<ProductShotMode, string> = {
  studio: '干净背景 + 专业布光',
  lifestyle: '放进真实的使用场景',
  with_model: '有人正在使用它'
}

const SHOT_COPY: Record<MarketplaceShot, string> = {
  white_background: '纯白底，适合商品列表',
  color_benefit: '纯色底，留出文案位置',
  detail_closeup: '放大材质与做工细节'
}

/**
 * 每个意图的**结果约束**（交接文件里的表，逐条落地）。
 * 写得具体是有原因的：只说「棚拍」时模型很容易自己加道具、加装饰文字，
 * 而商品图最不能容忍的恰恰是「包装上多出没写过的字」。
 */
const INTENT_INSTRUCTION: Record<ProductShotMode | MarketplaceShot, string> = {
  studio: '干净纯粹的背景、专业棚拍布光、自然可信的接触阴影；画面里不出现任何无关道具或装饰元素。',
  lifestyle: '真实的使用环境与合理的生活道具，但产品始终是画面里最清晰的主角，环境不得抢走注意力。',
  with_model:
    '人物持用、穿戴或正在使用这个产品；人物只承担辅助叙事，不能遮挡产品、不能改变产品的形态或包装比例。',
  white_background:
    '纯白或接近纯白的无缝背景，完整展示产品全部外形，不出现任何装饰文字或图形，适合直接放进商品列表。',
  color_benefit:
    '单一纯色背景，用色彩营造一个明确的卖点氛围；在产品之外留出一块干净区域，方便后续叠加商品文案。',
  detail_closeup:
    '放大产品的材质、开口、纹理或关键部件，突出做工细节；产品仍然可辨认，不虚构包装上不存在的信息。'
}

/** 电商主图的三个镜头**禁止**由模型自己生成促销文字（那是设计稿要留白的部分）。 */
const NO_PROMO_TEXT = '不要生成任何促销文字、价格、标签或水印；需要文案的位置保持干净留白。'

function intentKey(intent: ProductStudioIntent): ProductShotMode | MarketplaceShot {
  return intent.kind === 'product-shot' ? intent.mode : intent.shot
}

/** 写进资产库的**工作流标题**：产品拍摄 / 电商主图。 */
export function productStudioTitle(intent: ProductStudioIntent): string {
  return intent.kind === 'product-shot' ? '产品拍摄' : '电商主图'
}

/** 写进资产库的 `skill`：具体到模式 / 镜头，比只写工作流名有用。 */
export function productStudioSkill(intent: ProductStudioIntent): string {
  const key = intentKey(intent)
  return intent.kind === 'product-shot' ? MODE_LABEL[key as ProductShotMode] : SHOT_LABEL[key as MarketplaceShot]
}

/**
 * 默认画面比例。
 * ------------------------------------------------------------------
 * 必须是 `data/catalog.ts` 的 `ratioToSize` 的 key，否则
 * `defaultConfigForRatio()` 会**静默回落到 2:3**（见那里的注释）。
 * `scripts/test-product-studio.mjs` 会拿 `RATIO_OPTIONS` 断言这一点。
 */
export function productStudioRatio(intent: ProductStudioIntent): string {
  switch (intentKey(intent)) {
    case 'studio':
    case 'white_background':
    case 'detail_closeup':
      return '1:1'
    case 'lifestyle':
    case 'with_model':
    case 'color_benefit':
      return '4:5'
    default:
      return '1:1'
  }
}

/**
 * 选择器选项：**从常量派生**，不另写一份清单。
 * 两处各写一份的话，加一个模式时界面会漏掉它 —— 不报错，只是选不到。
 *
 * `copy` 一并带上（而不是让页面自己 `MODE_COPY[mode]` 去查）：
 * 页面里那句说明是**跟着选项走的**，分成两个数据源时，
 * 加一个模式会出现「胶囊有、说明空」的半截状态，而那种错不报错。
 */
export type ProductStudioOption<T extends string> = {
  value: T
  label: string
  /** 选项下面那句人话说明 —— 与 `INTENT_INSTRUCTION`（发给模型的约束）是两件事。 */
  copy: string
}

export const PRODUCT_SHOT_OPTIONS: readonly ProductStudioOption<ProductShotMode>[] =
  PRODUCT_SHOT_MODES.map((value) => ({ value, label: MODE_LABEL[value], copy: MODE_COPY[value] }))

export const MARKETPLACE_SHOT_OPTIONS: readonly ProductStudioOption<MarketplaceShot>[] =
  MARKETPLACE_SHOTS.map((value) => ({ value, label: SHOT_LABEL[value], copy: SHOT_COPY[value] }))

/**
 * 还差什么才能生成。`null` = 齐了。
 * 与 `canGenerateProductStudio` **同源**：判定顺序一致。
 * 页面用它显示字段级提示，而不是自己再写一遍 if 链（两套判定一定会漂）。
 */
export type ProductStudioBlocker = 'product'

export function productStudioBlocker(draft: ProductStudioDraft): ProductStudioBlocker | null {
  return draft.product ? null : 'product'
}

/** 字段级提示文案。**服务层持有**，页面不许内联写死（文案要能一处改）。 */
export const PRODUCT_STUDIO_BLOCKER_HINT: Record<ProductStudioBlocker, string> = {
  product: '添加产品图片后继续'
}

/**
 * 只有产品图是必填的 —— 这两个工作流**不需要**视觉参考图，也不需要权利确认。
 *
 * 类型谓词是刻意的：调用方 `if (!canGenerate(...)) return` 之后
 * `draft.product` 会被收窄成非空，不用再写 `!`。
 */
export function canGenerateProductStudio(
  draft: ProductStudioDraft
): draft is ProductStudioDraft & { product: ImageAsset } {
  return Boolean(draft.product)
}

/**
 * 编排提示词。
 * ------------------------------------------------------------------
 * 结构（顺序就是给模型的读图顺序）：
 *   ① 图一 = 唯一产品主体，保留轮廓 / 包装文字 / 材质 / 颜色 / 真实比例；
 *   ② 本工作流的结果约束（六选一）；
 *   ③ 电商主图额外禁止生成促销文字；
 *   ④ 用户的补充说明 —— 且**明确声明它不能覆盖 ①**。
 *
 * ⚠️ ④ 的那句「不得覆盖」不能省：用户写了「换个包装」时，没有这句话
 *    模型会照做，而「产品保真」是这个工作流存在的全部意义。
 *
 * ⚠️ `note` 为空时**整段不出现**。不许输出「补充说明：」（空值）——
 *    那会被模型当成一条真实指令（「不要有任何补充说明」）去执行。
 */
export function buildProductStudioPrompt(input: ProductStudioInput): string {
  const title = productStudioTitle(input.intent)
  const instruction = INTENT_INSTRUCTION[intentKey(input.intent)]

  const lines = [
    `以图一中的产品为本次画面**唯一的产品主体**，制作一张「${title}」成品图。`,
    '保持它的轮廓、包装比例、材质、颜色与包装上可读的文字；不要替换成别的产品，也不要改动包装上的文字。',
    '',
    `拍摄要求：${instruction}`
  ]

  if (input.intent.kind === 'marketplace') lines.push(NO_PROMO_TEXT)

  const note = input.note.trim()
  if (note) {
    lines.push(
      '',
      `补充说明：${note}`,
      '（补充说明只影响氛围与场景，**不得**改变产品本身的外形、材质、颜色或包装文字。）'
    )
  }

  return lines.join('\n')
}

/**
 * 交给 `editImages` 的素材顺序 —— **永远只有产品图一张**。
 * ------------------------------------------------------------------
 * 与灵感复刻的 `[产品, 参考]` 是两件事，**不要合并**：这里没有参考图。
 * 页面不许自己拼数组，否则「顺手把参考图也带上」会静默改变图一的含义
 * （提示词里的「图一」指的就是这个数组的第一项）。
 */
export function productStudioEditImages(input: ProductStudioInput): ImageAsset[] {
  return [input.product]
}

/**
 * 资产库 `templateId`。
 * ⚠️ 必须以 `product-` 开头：`services/create-ui.ts` 的资产分类按
 *    `templateId` 前缀判「产品」，前缀不对这条记录在「产品」筛选下**看不到**，
 *    而列表照常渲染、不报错（见那里的注释）。
 */
export function productStudioTemplateId(intent: ProductStudioIntent): string {
  return `product-studio-${intent.kind}-${intentKey(intent)}`
}

/**
 * 产品工作室顶层的两个创作意图（「精选场景」是第三个，走原有模板库，不在这里）。
 *
 * `title` / `headline` / `description` 是**页面文案的唯一真源**：
 * 产品工作室的卡片、两个 composer 页的页头都从这里读。
 * 各自再写一份的话，改文案时会漏掉一处 —— 不报错，只是同一个功能
 * 在入口处叫一个名字、进去以后叫另一个名字。
 */
export const PRODUCT_STUDIO_INTENTS: readonly {
  kind: ProductStudioIntent['kind']
  title: string
  eyebrow: string
  headline: string
  description: string
  /** 选择器那一块的标题 / 标签 / 说明 —— 两个 composer 页共用同一套版式，只有这三句不同。 */
  choiceTitle: string
  choiceLabel: string
  choiceCopy: string
  route: string
}[] = [
  {
    kind: 'product-shot',
    title: '产品拍摄',
    eyebrow: 'PRODUCT SHOT',
    headline: '把产品拍成专业成品图',
    description: '把产品变成棚拍、生活方式或人物使用图',
    choiceTitle: '怎么拍？',
    choiceLabel: '拍摄方式',
    choiceCopy: '决定产品出现在什么样的画面里。换一个模式，比例会跟着回到它的推荐值。',
    route: '/pages/create-product-shot/index'
  },
  {
    kind: 'marketplace',
    title: '电商主图',
    eyebrow: 'MARKETPLACE',
    headline: '做主图，不用重拍',
    description: '白底、纯色卖点或细节特写商品图',
    choiceTitle: '做什么主图？',
    choiceLabel: '主图类型',
    choiceCopy: '决定这张图在商品列表里的角色。换一个类型，比例会跟着回到它的推荐值。',
    route: '/pages/create-marketplace/index'
  }
]

/** 按 `kind` 取那条意图。找不到就抛错 —— 宁可构建期炸，也不要静默渲染空标题。 */
export function productStudioIntentMeta(kind: ProductStudioIntent['kind']) {
  const meta = PRODUCT_STUDIO_INTENTS.find((item) => item.kind === kind)
  if (!meta) throw new Error(`未知的产品工作室意图：${kind}`)
  return meta
}

/** 某个 `kind` 的**首个**意图（页面打开时的默认选中项）。 */
export function defaultProductStudioIntent(kind: ProductStudioIntent['kind']): ProductStudioIntent {
  return kind === 'product-shot'
    ? { kind: 'product-shot', mode: PRODUCT_SHOT_MODES[0] }
    : { kind: 'marketplace', shot: MARKETPLACE_SHOTS[0] }
}

/** 某个 `kind` 的选择器选项。**从常量派生**，不另写清单。 */
export function productStudioOptions(kind: ProductStudioIntent['kind']) {
  return kind === 'product-shot' ? PRODUCT_SHOT_OPTIONS : MARKETPLACE_SHOT_OPTIONS
}

/**
 * 从选择器的 `value` 构造意图。
 * ⚠️ 收窄必须在这里做，页面里不要写 `as ProductShotMode` —— 那种断言在
 *    加模式时不会报错，只会让一个不存在的模式静默通过。
 */
export function intentFromValue(
  kind: ProductStudioIntent['kind'],
  value: string
): ProductStudioIntent {
  if (kind === 'product-shot') {
    const mode = PRODUCT_SHOT_MODES.find((item) => item === value)
    if (!mode) throw new Error(`未知的产品拍摄模式：${value}`)
    return { kind: 'product-shot', mode }
  }
  const shot = MARKETPLACE_SHOTS.find((item) => item === value)
  if (!shot) throw new Error(`未知的电商主图镜头：${value}`)
  return { kind: 'marketplace', shot }
}

/** 意图的当前选择值（给 `OptionPills` 的 `value` 用）。 */
export function intentValue(intent: ProductStudioIntent): string {
  return intentKey(intent)
}

/**
 * 从**路由参数**构造初始意图。
 * ------------------------------------------------------------------
 * 与 `intentFromValue` 的关键差别：**这里不抛错**。
 *
 * 路由参数是外部输入 —— 手改过的链接、上一版缓存的分享链接、被截断的 URL，
 * 都可能给出一个不存在的模式。`intentFromValue` 抛错是给**内部**用的
 * （内部传错值说明代码写错了，宁可构建期炸）；这里抛错就是用户白屏。
 *
 * ⚠️ 退回默认值**不需要**额外告警：选择器会显示默认项，用户看得见自己选的那个没生效。
 *    这也是为什么必须让「选中的值」和「显示的值」同源 —— 两处各存一份的话，
 *    这里悄悄退回默认而选择器还显示用户选的那个，就变成了静默错值。
 */
export function productStudioIntentFromParam(
  kind: ProductStudioIntent['kind'],
  value: string | undefined | null
): ProductStudioIntent {
  if (!value) return defaultProductStudioIntent(kind)
  try {
    return intentFromValue(kind, value)
  } catch {
    return defaultProductStudioIntent(kind)
  }
}

/**
 * 意图的**路由参数名**。
 * ------------------------------------------------------------------
 * 产品拍摄用 `mode`、电商主图用 `shot` —— 名字不同是有意的：
 * 「棚拍」是拍摄方式、「白底主图」是主图类型，共用 `mode` 会让
 * 分享链接看起来像同一个东西，而它们不是。
 * 三处（产品工作室的卡片、两个页面读参数）必须用同一个来源，别各写一份字面量。
 */
export function productStudioParamName(kind: ProductStudioIntent['kind']): string {
  return kind === 'product-shot' ? 'mode' : 'shot'
}
