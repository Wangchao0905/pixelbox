export const toggleSettings = (expanded: boolean) => !expanded

export type AssetFilter = 'all' | 'poster' | 'product' | 'avatar' | 'freeform' | 'reference'

/**
 * 分类判定：**先看 `templateId` 前缀，没有才退回关键词**。
 * ------------------------------------------------------------------
 * 为什么不能只按关键词判（2026-09-22 实测，`_diag/filter-matrix.mjs`）：
 * 真实写入资产库的是 `title='轨道圆场' skill='CIRCULAR EDITORIAL'`、
 * `title='草莓冰淇淋俯拍' skill='FOOD / OVERHEAD'` —— **一个关键词都不含**。
 * 只按关键词判的话，「海报」「产品」两个筛选项**永远是空列表**，
 * 而界面照常渲染、不报错、门禁全绿，用户点下去只看到空白。
 * 根因是 `templateId` 在 `services/assets.ts` 的 `normalizeAsset` 里被白名单式重建丢掉了。
 *
 * 关键词兜底只服务「修复之前只写进本地缓存、没有 templateId 的老记录」。
 * **不要拿它当主判据** —— 它猜不准，而且猜错不报错。
 */
const TEMPLATE_ID_PREFIX: Record<Exclude<AssetFilter, 'all'>, string> = {
  poster: 'poster-',
  product: 'product-',
  avatar: 'avatar-',
  freeform: 'freeform',
  reference: 'reference-'
}

const KEYWORD_FALLBACK: Record<Exclude<AssetFilter, 'all'>, string[]> = {
  poster: ['poster', '海报'],
  product: ['product', '产品'],
  avatar: ['avatar', '头像'],
  freeform: ['freeform', 'image maker', '自由生图'],
  reference: ['reference', '灵感复刻']
}

export function assetMatchesFilter(
  item: { title: string; skill: string; templateId?: string },
  filter: AssetFilter
): boolean {
  if (filter === 'all') return true
  const templateId = item.templateId ?? ''
  if (templateId) return templateId.startsWith(TEMPLATE_ID_PREFIX[filter])
  const text = `${item.title} ${item.skill}`.toLowerCase()
  return KEYWORD_FALLBACK[filter].some((word) => text.includes(word))
}
