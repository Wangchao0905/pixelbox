#!/usr/bin/env node
/**
 * 门禁：提示词模板的两份镜像必须一致
 * ------------------------------------------------------------------
 * `forme-taro/src/data/prompt-templates.ts` 和
 * `work/visual-studio/src/prompt-templates.ts` 是**刻意的重复** ——
 * 小程序是 Taro、设计真源是 Vite/React，两个工程没法共享模块。
 *
 * 为什么值得单独立一道门禁：这两份文件里装着 28 个模板的提示词，其中
 * 「胶囊眼睛头像」那一份有 2130 个字。改一边忘一边，产物照构建、类型检查全过、
 * 门禁全绿 —— 只是小程序和设计稿对同一个模板用了不同的提示词。
 * 而提示词错了，出图就是错的，**没有任何东西会报警**。
 *
 * ⚠️ 判据的边界（别把它当成比实际更强）：
 *    · 只比**非 cover 字段**（name / description / skill / ratio / inputMode /
 *      prompt / system / negative，以及 2026-09-26 加的 8 个产品页文案字段
 *      pageHeadline / pageHeadlineAccent / pageCopy / uploadEyebrow /
 *      uploadTitle / uploadLabel / uploadHint / uploadError）。
 *    · 这 8 个文案字段必须保持**扁平的可选字符串** —— 嵌套对象会让解析器
 *      静默丢字段，自测里有一条特征测试钉着这个边界。
 *    · **cover 不比**：两个工程打包图片的方式本来就不同 —— 小程序用
 *      `import x from '@/assets/…jpg'`（走打包），设计真源用 `"/assets/…png"`（走 public）。
 *      同一个模板两边写法不同是**正常的**，拿来当判据只会得到清不掉的报警，
 *      而清不掉的报警会让整道门禁失去可信度。
 *    · 已知的一处真差异不在判据内：`coastal-sun`（海岸日光）的 cover 两边是
 *      **两张不同的 Unsplash 图**（photo-1515238152791… vs photo-1507529955149…）。
 *      那是历史遗留，要王定哪张对，不属于本门禁能自动判的范围。
 *
 * ⚠️ 2026-09-26 修掉一个盲区：`STR` 只抓带引号的字面量，而两个文件里各有
 *    **36 处** `negative: productNegative` 这种**裸标识符**写法（带引号的只有 2 处）
 *    ⇒ `negative` 这个字段实际只覆盖 2/38，其余改一边忘一边**不会报**。
 *    现在 `parse()` 会按同文件的 `const` 表还原裸标识符。加字段时如果它也是裸标识符，
 *    别忘了在自测里成对补「抽得到 / 不同要报」两条。
 *
 * ⚠️ 为什么 `inputMode` 必须进来（2026-09-23 加）：它不是文案开关 ——
 *    `'photo'` 走 `editImages()`、`'text'` 走 `generateImages()`，**两个接口**。
 *    两边不一致时，小程序会在某个模板上把空的 `images` 发给 `editImages`，
 *    而 mock 模式下**照常出图、不报错**。
 *    ⚠️ 加字段时必须同时加一条「解析器真的抽得到它」的自测：`inputMode` 是字符串，
 *       现成的 STR 正则抓得到；哪天有人把它写成不带引号的布尔量，STR 就抓不到了，
 *       于是两边都读到 `undefined`、**判据静默失效**，而「不同要报」那条
 *       反而会通过（它比的是 undefined vs undefined）。下面两条自测成对存在，别删任一条。
 *
 * 自测（铁律 #3：每条门禁都要能证明自己真的会拦）：
 *   先断言「在已知有差异的样本上会报」，再断言「在已知一致的样本上不报」。
 *   两条都不成立就说明判据瞎了，直接退出 —— 不做成「看着在检查」。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MINI = join(HERE, '..', 'src', 'data', 'prompt-templates.ts')
const DESIGN = resolve(HERE, '..', '..', 'work', 'visual-studio', 'src', 'prompt-templates.ts')

/** 要比的字段。cover 刻意排除 —— 理由见文件头。 */
const FIELDS = [
  'name', 'description', 'skill', 'ratio', 'inputMode', 'prompt', 'system', 'negative',
  /**
   * 2026-09-26 加：产品替换页的**逐模板文案覆盖**（只有 receipt-collage 填）。
   * 它是「页面文案按模板切」的载体 —— 改一边忘一边，小程序和设计稿会对同一个
   * 模板显示不同的文案，而编译 / typecheck / 其它门禁**全绿**。
   * ⚠️ 这 8 个字段必须是**扁平的可选字符串**，不能做成嵌套对象：
   *    下面的 `OBJ` 是 lazy 的、会停在**第一个** `}`，嵌套对象会把 body 截断，
   *    排在它后面的字段（例如 `negative`）会被静默读成 `undefined`，
   *    两边都 undefined 就「一致」了 —— 判据静默失效。
   *    自测里那条「嵌套对象会让后面的字段静默丢失」就是钉这个边界的。
   */
  'pageHeadline', 'pageHeadlineAccent', 'pageCopy',
  'uploadEyebrow', 'uploadTitle', 'uploadLabel', 'uploadHint', 'uploadError'
]

const OBJ = /\{\s*id:\s*["']([^"']+)["']([\s\S]*?)\n?\s*\}/g
const STR = /([\w$]+)\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g
const TICK = /prompt:\s*`([\s\S]*?)`/

/**
 * 抽出一个文件里的 `const NAME = '…'` 常量表。
 *
 * ⚠️ 为什么必须有它（2026-09-26 修）：`STR` 只抓**带引号的字面量**，
 *    而两个文件里各有 **36 处** `negative: productNegative` 这种**裸标识符**写法，
 *    带引号的只有 2 处 ⇒ `FIELDS` 里的 `negative` 实际只覆盖了 2/38，
 *    其余 36 条的 negative **改一边忘一边也不会报**。
 *    这正是本门禁存在的理由（「改一边忘一边，门禁全绿」），
 *    结果它自己在 negative 这个字段上就是瞎的。
 */
function constsOf(src) {
  const out = new Map()
  const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*\r?\n?\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g
  let m
  while ((m = re.exec(src))) out.set(m[1], m[2] !== undefined ? m[2] : m[3])
  return out
}

/** 解析出一个文件里的 { id: { field: value } } */
function parse(src) {
  const out = new Map()
  const consts = constsOf(src)
  for (const m of src.matchAll(OBJ)) {
    const id = m[1]
    const body = m[2]
    const fields = {}
    for (const s of body.matchAll(STR)) {
      fields[s[1]] = s[2] !== undefined ? s[2] : s[3]
    }
    // prompt 用的是模板字符串（里面有换行），上面的 STR 抓不到
    const tick = TICK.exec(body)
    if (tick) fields.prompt = tick[1]
    // 裸标识符字段（`negative: productNegative`）—— STR 抓不到，按同文件的常量表还原。
    // ⚠️ 前瞻必须写成 `[,}]|$`：`OBJ` 已经把结尾的 `}` **吃掉**了，
    //    所以 body 末尾没有 `}` 可匹配 —— 只写 `[,}]` 会一条都抓不到
    //    （这个错被上面那条自测当场抓住，别去掉它）。
    // ⚠️ 只认「这个标识符在**同一个文件里**有 const 定义」的，避免把 URL、
    //    英文提示词里的 `xxx: yyy` 误当成字段。
    for (const b of body.matchAll(/([\w$]+)\s*:\s*([A-Za-z_$][\w$]*)\s*(?=[,}]|$)/g)) {
      if (fields[b[1]] === undefined && consts.has(b[2])) fields[b[1]] = consts.get(b[2])
    }
    if (!out.has(id)) out.set(id, fields)
  }
  return out
}

const norm = (v) => (v === undefined ? undefined : String(v).replace(/\r\n/g, '\n').trim())

/** 返回不一致的清单（空数组 = 一致） */
function diff(aSrc, bSrc) {
  const a = parse(aSrc)
  const b = parse(bSrc)
  const problems = []

  for (const id of a.keys()) {
    if (!b.has(id)) problems.push({ id, field: '(整个模板)', detail: '只在小程序侧存在' })
  }
  for (const id of b.keys()) {
    if (!a.has(id)) problems.push({ id, field: '(整个模板)', detail: '只在设计真源侧存在' })
  }

  for (const id of a.keys()) {
    if (!b.has(id)) continue
    for (const field of FIELDS) {
      const va = norm(a.get(id)[field])
      const vb = norm(b.get(id)[field])
      if (va === vb) continue
      if (va === undefined || vb === undefined) {
        problems.push({
          id,
          field,
          detail: `${va === undefined ? '小程序侧' : '设计真源侧'}缺这个字段`
        })
        continue
      }
      // 只在开头就不同时给短摘录，避免把 2130 字全打出来
      const at = [...va].findIndex((ch, i) => ch !== vb[i])
      problems.push({
        id,
        field,
        detail: `第 ${at + 1} 个字符起不同：${va.slice(at, at + 24)}… ≠ ${vb.slice(at, at + 24)}…`
      })
    }
  }
  return problems
}

/* ---------------- 自测 ---------------- */
const SAME = 'export const t = [{ id: "x", name: "同名", ratio: "1:1", prompt: `第一行\n第二行` }]'
const DIFF_NAME = 'export const t = [{ id: "x", name: "另一个名", ratio: "1:1", prompt: `第一行\n第二行` }]'
const DIFF_PROMPT = 'export const t = [{ id: "x", name: "同名", ratio: "1:1", prompt: `第一行\n改了` }]'
const MISSING = 'export const t = [{ id: "y", name: "同名", ratio: "1:1", prompt: `第一行\n第二行` }]'
const MODE_PHOTO = 'export const t = [{ id: "x", name: "同名", ratio: "1:1", inputMode: "photo", prompt: `第一行\n第二行` }]'
const MODE_TEXT = 'export const t = [{ id: "x", name: "同名", ratio: "1:1", inputMode: "text", prompt: `第一行\n第二行` }]'
const BARE_SAME = 'const NEG = "同一个"\nexport const t = [{ id: "x", name: "同名", negative: NEG }]'
const BARE_DIFF = 'const NEG = "改过了"\nexport const t = [{ id: "x", name: "同名", negative: NEG }]'
const COPY_SAME = 'const NEG = "同一个"\nexport const t = [{ id: "x", name: "同名", negative: NEG, pageCopy: "同一段" }]'
const COPY_DIFF = 'const NEG = "同一个"\nexport const t = [{ id: "x", name: "同名", negative: NEG, pageCopy: "改过了" }]'
/** 嵌套对象 + 后面还跟着 negative —— 用来钉住 `OBJ` 的已知边界 */
const NESTED = 'const NEG = "同一个"\nexport const t = [{ id: "x", name: "同名", copy: { a: "1" }, negative: NEG }]'

const selfTests = [
  ['一致的样本不报', diff(SAME, SAME).length === 0],
  ['name 不同要报', diff(SAME, DIFF_NAME).length > 0],
  ['prompt 换行后不同要报', diff(SAME, DIFF_PROMPT).length > 0],
  ['模板 id 对不上要报', diff(SAME, MISSING).length > 0],
  /**
   * ⚠️ 下面两条是**一组**，删任一条都会让 inputMode 这道判据变成假门禁：
   *    · 只留「不同要报」：解析器抓不到 inputMode 时两边都是 undefined，
   *      「不同」也就变成了「相同」—— 那条反而**会通过**。
   *    · 只留「抽得到」：证明了解析器能读，但没证明差异真的会被报出来。
   */
  ['解析器真的抽得到 inputMode', parse(MODE_PHOTO).get('x')?.inputMode === 'photo'],
  ['inputMode 不同要报', diff(MODE_PHOTO, MODE_TEXT).length > 0],
  ['inputMode 相同不报', diff(MODE_PHOTO, MODE_PHOTO).length === 0],
  /**
   * ⚠️ 下面两条是**一组**，删任一条都会让「裸标识符 negative」这道判据变成假门禁：
   *    · 只留「不同要报」：解析器还原不出常量时两边都是 undefined，
   *      于是「不同」变成「相同」—— 那条反而**会通过**。
   *    · 只留「抽得到」：证明了解析器能还原，但没证明差异真会被报出来。
   *    修之前 36/38 条 negative 就是栽在这个盲区里（见 constsOf 的注释）。
   */
  ['解析器真的还原得出裸标识符 negative', parse(BARE_SAME).get('x')?.negative === '同一个'],
  ['裸标识符 negative 不同要报', diff(BARE_SAME, BARE_DIFF).length > 0],
  ['裸标识符 negative 相同不报', diff(BARE_SAME, BARE_SAME).length === 0],
  /**
   * ⚠️ 下面两条是**一组**，删任一条都会让「页面文案覆盖」这道判据变成假门禁
   *    （理由同 inputMode 那组：只留「不同要报」，解析器抓不到时两边都是
   *    undefined，「不同」就变成了「相同」，那条反而会通过）。
   */
  ['解析器真的抽得到 pageCopy', parse(COPY_SAME).get('x')?.pageCopy === '同一段'],
  ['pageCopy 不同要报', diff(COPY_SAME, COPY_DIFF).length > 0],
  ['pageCopy 相同不报', diff(COPY_SAME, COPY_SAME).length === 0],
  /**
   * ⚠️ 这条是**特征测试**，记录一条**已知边界**，不是「期望的行为」：
   *    条目里若出现**嵌套对象**，`OBJ` 是 lazy 的、会停在第一个 `}`，
   *    body 就在那里被截断 —— 排在嵌套对象**后面**的字段（这里是 `negative`）
   *    会被静默读成 `undefined`，两边都 undefined 就「一致」了。
   *    所以嵌套写法下这道门禁**静默失效** —— 这正是上面那 8 个字段必须是
   *    **扁平字符串**的原因。
   *    哪天有人把 `OBJ` 改成花括号配平（真修掉这个边界），这条会失败 ——
   *    那时把它换成「嵌套也不该丢字段」的正向断言即可，不是回归。
   */
  ['嵌套对象会让后面的字段静默丢失（已知边界，修了 OBJ 就改这条）', parse(NESTED).get('x')?.negative === undefined]
]
const failed = selfTests.filter(([, ok]) => !ok)
if (failed.length) {
  console.error('\n❌ 判据瞎了，门禁作废：')
  for (const [name] of failed) console.error(`   ${name} —— 没做到`)
  process.exit(1)
}

/* ---------------- 扫真文件 ---------------- */
const line = '─'.repeat(56)
console.log(`\n提示词模板镜像门禁\n${line}`)
console.log(`  ✓ 判据自测通过（${selfTests.length} 个样本）`)

if (!existsSync(DESIGN)) {
  console.log(`  ⚠️  设计真源不在：${DESIGN}`)
  console.log('      这道门禁**这次没有运行**，不要把它当成通过。')
  console.log('      （只 checkout 了小程序、没有 work/visual-studio 时会走到这里）')
  console.log(`\n⚠️  门禁未运行\n`)
  process.exit(0)
}

const problems = diff(readFileSync(MINI, 'utf8'), readFileSync(DESIGN, 'utf8'))
const total = parse(readFileSync(MINI, 'utf8')).size

if (!problems.length) {
  console.log(`  ✓ ${total} 个模板的非 cover 字段（${FIELDS.join(' / ')}）两边完全一致`)
  console.log('\n✅ 通过\n')
  process.exit(0)
}

console.log(`  ❌ ${problems.length} 处不一致（共 ${total} 个模板）：`)
for (const p of problems) console.log(`     ${p.id} · ${p.field}：${p.detail}`)
console.log('\n  改法：两个文件同时改。别只改一边 —— 改错的那一边不会报错，')
console.log('  只会让小程序和设计稿对同一个模板用上不同的提示词。')
console.log('\n❌ 不一致，修掉后重跑。\n')
process.exit(1)
