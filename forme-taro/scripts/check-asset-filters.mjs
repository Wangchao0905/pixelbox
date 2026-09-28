/**
 * 门禁：资产库的分类筛选必须**真的筛得出东西**。
 * ------------------------------------------------------------------
 * 为什么需要这道门禁（2026-09-22 实测）：
 * `assetMatchesFilter` 曾经是纯关键词匹配，而真实写入资产库的
 * `title='轨道圆场' skill='CIRCULAR EDITORIAL'`、`title='草莓冰淇淋俯拍' skill='FOOD / OVERHEAD'`
 * **一个关键词都不含** ⇒ 「海报」「产品」两个筛选项永远是空列表。
 * 界面照常渲染、typecheck 全绿、构建全绿、`verify:dist` 全绿 —— 没有任何东西报警。
 *
 * 这道门禁补的就是那个盲区：拿**真实模板数据**跑一遍分类，空桶就是缺口。
 *
 * ⚠️ 两个刻意的设计：
 *   1. import 的是**真实的** `assetMatchesFilter`，不重新实现 —— 重实现等于自己测自己。
 *   2. 模板数据从 TS 源里抽，因为 `prompt-templates.ts` 里 import 了 `@/assets/*.jpg`，
 *      node 直接 import 它解析不了图片。抽的只是数据，被测的是真函数。
 *
 * 用法：npm run check:asset-filters
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { assetMatchesFilter } from '../src/services/create-ui.ts'
// 灵感复刻的 skill 就是复刻重点的中文标签。**从服务层 import**，不在门禁里重抄 ——
// 重抄一份的话，改标签时门禁会继续对着旧标签判，而它照样是绿的。
import { RECREATE_FOCUS_OPTIONS } from '../src/services/reference-recreate.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = resolve(HERE, '../src/data/prompt-templates.ts')

let failed = 0
function must(name, ok, detail) {
  if (ok) {
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}`)
    if (detail) console.log(`      ${detail}`)
  }
}

/* ---------------- 判据自测：先证明这道门禁看得见空桶 ---------------- */

console.log('判据自测：')

// 前缀判据必须能区分开
must(
  'templateId 前缀判据能区分 product 与 poster',
  assetMatchesFilter({ title: 'x', skill: 'y', templateId: 'product-gelato-overhead' }, 'product') === true &&
    assetMatchesFilter({ title: 'x', skill: 'y', templateId: 'product-gelato-overhead' }, 'poster') === false,
  '前缀判定失效了，后面的结论就不可信'
)

// 没有 templateId 时必须退回关键词兜底，而不是一律 false
must(
  '没有 templateId 时退回关键词兜底',
  assetMatchesFilter({ title: '自由生图', skill: 'Sunburst' }, 'freeform') === true,
  '老数据（只有本地缓存、没有 templateId）会全部筛不出来'
)

// 关键词兜底确实猜不准 —— 用一个真实形状的条目断言它**匹配不上**，
// 这样「不能只靠关键词」这条结论本身也被钉住了。
must(
  '关键词兜底对真实海报条目确实无效（所以必须有 templateId）',
  assetMatchesFilter({ title: '轨道圆场', skill: 'CIRCULAR EDITORIAL' }, 'poster') === false,
  '如果这里变成 true，说明关键词兜底被加强了，注释里「猜不准」的结论要重新核'
)

if (failed) {
  console.log('\n判据自测没过，后面的矩阵结论没有意义。')
  process.exit(1)
}

/* ---------------- 抽真实模板数据 ---------------- */

const text = readFileSync(SOURCE, 'utf8')

function extract(blockName) {
  const start = text.indexOf(`export const ${blockName}`)
  if (start === -1) return []
  const next = text.indexOf('\nexport ', start + 10)
  const body = text.slice(start, next === -1 ? undefined : next)
  const out = []
  const re = /id:\s*'([^']+)'[\s\S]*?name:\s*'([^']+)'[\s\S]*?skill:\s*'([^']+)'/g
  let m
  while ((m = re.exec(body))) out.push({ id: m[1], name: m[2], skill: m[3] })
  return out
}

/**
 * 各页面**真实写入资产库**的字段形状（见各 create-* 页的 `asset: {...}`）：
 *   自由生图  title='自由生图' skill=MODEL_OPTIONS 的 label（Sunburst / Flare）
 *   海报      title=direction.name  skill=direction.skill  templateId=`poster-${id}`
 *   产品      title=template.name   skill=template.skill   templateId=`product-${id}`
 *   头像      title=template.name   skill=template.skill   templateId=`avatar-${id}`
 *   灵感复刻  title='灵感复刻' skill=复刻重点的中文标签  templateId='reference-recreate'
 *
 * ⚠️ 灵感复刻那组的 `skill` **从服务层 import**（`RECREATE_FOCUS_OPTIONS`），
 *    不在这里重抄「构图 / 光影 / 色彩氛围」。重抄的后果是：服务层加一个维度时，
 *    门禁还在测旧的三项，而新维度能不能被筛出来**没人知道** —— 又是一次静默变弱。
 */
const GROUPS = [
  [
    '自由生图',
    [
      { title: '自由生图', skill: 'Sunburst', templateId: 'freeform' },
      { title: '自由生图', skill: 'Flare', templateId: 'freeform' }
    ]
  ],
  ['海报', extract('posterDirections').map((d) => ({ title: d.name, skill: d.skill, templateId: `poster-${d.id}` }))],
  [
    '产品替换',
    extract('productReplacementTemplates').map((t) => ({
      title: t.name,
      skill: t.skill,
      templateId: `product-${t.id}`
    }))
  ],
  ['头像', extract('avatarTemplates').map((t) => ({ title: t.name, skill: t.skill, templateId: `avatar-${t.id}` }))],
  [
    '灵感复刻',
    RECREATE_FOCUS_OPTIONS.map((option) => ({
      title: '灵感复刻',
      skill: option.label,
      templateId: 'reference-recreate'
    }))
  ]
]

const FILTERS = ['freeform', 'poster', 'product', 'avatar', 'reference']
const LABEL = {
  freeform: '自由生图',
  poster: '海报',
  product: '产品',
  avatar: '头像',
  reference: '灵感复刻'
}

/* ---------------- 每一组作品都必须能被某个分类命中 ---------------- */

console.log('\n分类矩阵：')
const perFilter = Object.fromEntries(FILTERS.map((f) => [f, 0]))

for (const [groupName, items] of GROUPS) {
  must(
    `${groupName} 抽到了模板（抽不到不等于通过）`,
    items.length > 0,
    `从 ${SOURCE} 里一条都没抽出来，抽取逻辑可能失效`
  )
  if (!items.length) continue

  const hit = Object.fromEntries(FILTERS.map((f) => [f, 0]))
  for (const item of items) {
    for (const f of FILTERS) {
      if (assetMatchesFilter(item, f)) {
        hit[f]++
        perFilter[f]++
      }
    }
  }
  const total = FILTERS.reduce((sum, f) => sum + hit[f], 0)
  must(
    `${groupName}（${items.length} 条）能被具体分类命中`,
    total > 0,
    '这一组没有任何一条能被筛出来，只会在「全部」里可见：' +
      FILTERS.map((f) => `${LABEL[f]}=${hit[f]}`).join(' ')
  )
}

/* ---------------- 每个筛选项都必须至少筛得出东西 ---------------- */

for (const f of FILTERS) {
  must(
    `筛选项「${LABEL[f]}」能筛出作品`,
    perFilter[f] > 0,
    '这个筛选项点下去永远是空列表（界面不会报错，用户只看到空白）'
  )
}

console.log(
  '\n各筛选项命中数：' + FILTERS.map((f) => `${LABEL[f]}=${perFilter[f]}`).join('  ')
)

if (failed) {
  console.log(`\n❌ ${failed} 项未通过`)
  process.exit(1)
}
console.log('\n✅ 通过 —— 每个筛选项都筛得出东西，每组作品都能被分类')
