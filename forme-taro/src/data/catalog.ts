import { media } from './media'

export type Category = 'poster' | 'product' | 'brand'

export type Template = {
  id: string
  category: Category
  eyebrow: string
  title: string
  description: string
  skill: string
  ratio: string
  cover: string
  accent: string
  posterDirectionId?: string
  productTemplateId?: string
}

/** 首页「选择创作类型」用到的三个入口 */
export const templates: Template[] = [
  { id: 'poster-editorial', category: 'poster', eyebrow: 'POSTER / CAMPAIGN', title: '海报大片', description: '一行 Brief，生成可发布的活动海报', skill: 'Poster Editorial', ratio: '4:5', cover: media('https://images.unsplash.com/photo-1549490349-8643362247b5?auto=format&fit=crop&w=900&q=84'), accent: '#f5f5f2' },
  { id: 'product-shot', category: 'product', eyebrow: 'PRODUCT / COMMERCE', title: '电商产品', description: '让商品拥有更有说服力的场景和光影', skill: 'Product Shot', ratio: '1:1', cover: media('https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=84'), accent: '#9bd8ff' },
  { id: 'brand-system', category: 'brand', eyebrow: 'BRAND / IDENTITY', title: '品牌视觉', description: '从品牌关键词生成完整的视觉方向', skill: 'Identity Board', ratio: '3:2', cover: media('https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=900&q=84'), accent: '#ffb86b' }
]

export const showcase = [
  { title: 'Meta 广告创意', tag: 'ADS', image: media('https://images.unsplash.com/photo-1542744094-3a31f272c490?auto=format&fit=crop&w=800&q=82') },
  { title: '极简产品主图', tag: 'PRODUCT', image: media('https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=800&q=82') },
  { title: '春季品牌企划', tag: 'BRAND', image: media('https://images.unsplash.com/photo-1556228578-8c89e6adf883?auto=format&fit=crop&w=800&q=82') },
  { title: '社交媒体封面', tag: 'SOCIAL', image: media('https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=800&q=82') }
]

/**
 * 方案的视觉元数据。
 * ------------------------------------------------------------------
 * 名称、价格、点数、时长一律以服务端 /api/catalog 为准；
 * 这里只放微标签和角标（纯展示信息），避免两边改价不一致。
 *
 * 深空仪器（2026-09-27）：套餐卡不再逐个配色 —— 全站只有一个信号青。
 *
 * key 必须与 forme-server/src/catalog.mjs 里的 planId 一一对应，
 * 对不上不会报错，只是会静默回落到品牌色。
 */
export const planVisual: Record<string, { eyebrow: string; badge?: string }> = {
  'pass-starter': { eyebrow: 'PASS / STARTER', badge: '入门推荐' },
  'pass-pro': { eyebrow: 'PASS / PRO', badge: '最受欢迎' },
  'points-15': { eyebrow: 'POINTS / TRIAL' },
  'points-100': { eyebrow: 'POINTS / MINI' },
  'points-500': { eyebrow: 'POINTS / STUDIO', badge: '适合批量创作' }
}

/** 取不到视觉元数据时回落到默认微标签，不要新造文案 */
export function planEyebrow(planId: string) {
  return planVisual[planId]?.eyebrow ?? 'POINTS'
}

/** 分 → 展示价。「¥100」而不是「¥100.00」 */
export function formatPrice(priceFen: number) {
  const yuan = priceFen / 100
  return `¥${Number.isInteger(yuan) ? yuan : yuan.toFixed(2)}`
}

/** 生成模型 —— 与原型保持一致，只暴露 Image 2.5 的两个档位 */
export const MODEL_OPTIONS = [
  { value: 'gpt-image-2.5-sunburst', label: 'Sunburst' },
  { value: 'gpt-image-2.5-flare', label: 'Flare' }
] as const

export const QUALITY_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'low', label: '标准' },
  { value: 'medium', label: '高清' },
  { value: 'high', label: '超清' }
] as const

/**
 * value → 给人看的 label。
 * ------------------------------------------------------------------
 * **UI 里一律用 label，绝不要把 value 直接渲染出来。**
 * value 是内部标识（`gpt-image-2.5-sunburst`、`medium`），label 才是展示名
 * （`Sunburst`、`高清`）。两者混用会出现「同一页面里模型选择器写 Sunburst、
 * 旁边的设置徽标写 gpt-image-2.5-sunburst」这种**同一事物两个名字**的破绽 ——
 * 2026-09-27 在自由生图页实测到过。
 * 找不到时回落到 value 本身（宁可显示丑，也不要显示空白）。
 */
export function optionLabel(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string
) {
  return options.find((item) => item.value === value)?.label ?? value
}

/**
 * 单次出图的张数
 * ------------------------------------------------------------------
 * **三个创作页共用这一个值**，不要各写一份。
 * 它决定「点一次收多少点」（生成条上是 `costForImages(BATCH_SIZE)`），
 * 三份各写的话，改一处漏一处就会出现「首页入口进去 1 张 / 0.4 点、
 * 海报入口进去 4 张 / 1.6 点」—— 不报错、不崩，只是同一件商品两个价。
 *
 * 2026-09-21 发现的正是这类问题：张数从 4 改成 1 时，结果页的文案和缩略条
 * 没跟着改（`1 DIRECTIONS GENERATED`、空 3 格的缩略条）。
 * 结果页现在**按实际拿到的张数分叉**，不再读这个常量 —— 那是刻意的：
 * 页面渲染的是「拿到了几张」，不是「本该有几张」。
 *
 * ⚠️ **这个值现在待王定**：设计真源 `work/visual-studio/src/Prototype.tsx`
 *    两处都是 `n: 4`（注释里也按 0.4 × 4 = 1.6 点/次写的），小程序是 1。
 *    产物时间线显示 4→1 发生在 2026-09-21 11:31 那次构建，看着是刻意的，
 *    但记忆、注释、文档里都没记过为什么。**以哪边为准要王定** ——
 *    定之前既不要照设计稿改回 4，也不要照小程序把设计稿改成 1。
 */
export const BATCH_SIZE = 1

/**
 * 画面比例 → 出图尺寸
 * ------------------------------------------------------------------
 * 「比例」这件事的**唯一真源**：`RATIO_OPTIONS` 从本表的 key 派生。
 * 为什么不让两份清单各写一份：一旦对不上，界面选中 16:9 会**静默**发出
 * 2:3 的尺寸 —— 不报错、不崩，只是出图不对。
 *
 * 约定：**比例是给用户选的，尺寸是发给模型的**。
 * 界面不暴露**像素尺寸**：用户想的是「竖版还是方图」，不是「1024 还是 1536」。
 * ⇒ 界面上任何地方都**不许把 `1024x1536` 这样的字符串渲染给用户**
 *    （`create-poster` 曾经在「已锁定」那行印了「· 输出 {size}」，2026-09-21 去掉）。
 *
 * ⚠️ 别再引入叫「分辨率」的行。画质档位（自动 / 标准 / 高清 / 超清）一律叫**清晰度**
 *    —— 2026-09-21 统一过：自由生图原来叫「分辨率」、海报页叫「清晰度」，
 *    同一个控件两个名字，而「分辨率」又正好是用户最容易理解成「画布多大」的那个词。
 *    画布大小只由 `ratioToSize` 的比例决定。
 *
 * ⚠️ 改动本表时必须同步设计真源 `work/visual-studio/src/Prototype.tsx` 的同名表
 *    （设计稿是 Vite/React，小程序是 Taro，没法共享模块，那一份是刻意的重复）。
 *
 * ⚠️ 服务端只判「形状 + 单边 64–2048」，**不认识比例**（forme-server/src/sizes.mjs）。
 *    所以比例只能在客户端映射，把 `1:1` 直接发出去会得到 400 `invalid_size`。
 *    本表算出来的每个尺寸都由服务端那个**同一个判定函数**在部署前过一遍
 *    （forme-server/scripts/preflight.mjs 的 9.5）—— 不另抄一份清单。
 */
export const ratioToSize: Record<string, string> = {
  '1:1': '1024x1024',
  '2:3': '1024x1536',
  '3:2': '1536x1024',
  '4:5': '1024x1280',
  '9:16': '1024x1792',
  '16:9': '1536x864'
}

/** 比例清单从映射表派生，不另写一份（见上） */
export const RATIO_OPTIONS = Object.keys(ratioToSize)

export type GenerationModel = (typeof MODEL_OPTIONS)[number]['value']
export type GenerationQuality = (typeof QUALITY_OPTIONS)[number]['value']

export type GenerationConfig = {
  model: GenerationModel
  quality: GenerationQuality
  size: string
}

export function defaultConfigForRatio(ratio: string): GenerationConfig {
  return {
    model: 'gpt-image-2.5-sunburst',
    quality: 'auto',
    size: ratioToSize[ratio] ?? '1024x1536'
  }
}
