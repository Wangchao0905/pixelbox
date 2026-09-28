/**
 * 门禁：界面不许把**像素尺寸**渲染给用户
 * ------------------------------------------------------------------
 * 规则出自 `data/catalog.ts` 的约定：**比例是给用户选的，尺寸是发给模型的。**
 * 用户想的是「竖版还是方图」，不是「1024 还是 1536」。
 *
 * 为什么值得单独立一道门禁：这条规则 2026-09-21 一天之内被违反过两次 ——
 *   ① `create-freeform` 的「尺寸」行直接让用户选 `1024 × 1024`（王提出后改成「画面比例」）；
 *   ② `create-poster` 在「已锁定」那行印了「· 输出 {size}」，界面上出现 `1024x1280`。
 * 两次都不报错、不崩溃、类型检查全过 —— 只是把用户不该看的数字印在了屏幕上。
 *
 * ⚠️ 这是**文本级**判据，不是数据流分析：它抓的是「JSX 文本节点里插值了 size」这种写法。
 *    覆盖不到 `{config.size}` 之类的间接引用。够用是因为这个项目的写法就长这样，
 *    而且它便宜到可以每次都跑；判据的边界写在这里，不装作更强。
 *
 * 自测（铁律 #3：每条门禁都要能证明自己真的会拦）：
 *   先断言「在已知有问题的样本上会报」，再断言「在已知干净的样本上不报」。
 *   两条都不成立就说明判据瞎了，直接退出 —— 不做成「看着在检查」。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const SRC = join(ROOT, 'src')

/** JSX 文本节点里插值了 size / ratioToSize ⇒ 用户会在界面上看到像素 */
const JUDGE = /<[A-Za-z][^>]*>[^<>{]*\{[^}]*\b(?:size|ratioToSize)\b[^}]*\}/

/**
 * 收集所有 .tsx（只扫页面与组件 —— 数据层里 `size` 是正当的）。
 * @returns {{file: string, line: number, text: string}[]}
 */
function scan(dir) {
  const hits = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      hits.push(...scan(full))
      continue
    }
    if (!entry.endsWith('.tsx')) continue
    const lines = readFileSync(full, 'utf8').split('\n')
    lines.forEach((line, index) => {
      // 注释行不算：注释里写「输出 {size}」是在解释历史，不是渲染
      const trimmed = line.trim()
      if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return
      if (JUDGE.test(line)) hits.push({ file: relative(ROOT, full).split(sep).join('/'), line: index + 1, text: trimmed.slice(0, 120) })
    })
  }
  return hits
}

/* ---------- 自测：判据必须先证明自己会拦、且不误报 ---------- */
const MUST_CATCH = [
  "<Text>构图与负面提示词已锁定 · 输出 {size}</Text>",
  "<Text className='lock'>输出 {size}</Text>",
  "<View><Text>当前尺寸 {ratioToSize[ratio]}</Text></View>"
]
const MUST_PASS = [
  "<Text>构图与负面提示词已锁定</Text>",
  // 发请求时带 size 是**正当的**（尺寸就是要发给模型）
  'const request = { prompt, model, quality, size: defaultConfigForRatio(ratio).size, n }',
  "<Text className='eyebrow'>{variants.length} DIRECTIONS GENERATED</Text>",
  '<OptionPills label=\'清晰度\' value={quality} options={QUALITY_OPTIONS} onChange={setQuality} />',
  " * 这里原来跟着印了 `· 输出 {size}`（例如「输出 1024x1536」）",
  '// size 只在请求体里出现'
]
const missed = MUST_CATCH.filter((sample) => !JUDGE.test(sample))
const falseAlarm = MUST_PASS.filter((sample) => JUDGE.test(sample))
if (missed.length || falseAlarm.length) {
  console.error('\n❌ 判据瞎了，门禁作废：')
  for (const s of missed) console.error(`   该拦没拦：${s}`)
  for (const s of falseAlarm) console.error(`   误报：${s}`)
  process.exit(1)
}

/* ---------- 扫真源码 ---------- */
const hits = scan(SRC)
console.log('界面像素门禁（比例是给用户选的，尺寸是发给模型的）')
console.log('────────────────────────────────────────────────────────')
console.log(`  ✓ 判据自测通过（${MUST_CATCH.length} 个样本必拦、${MUST_PASS.length} 个样本必放行）`)
if (!hits.length) {
  console.log('  ✓ 页面 / 组件里没有任何 JSX 文本插值 size 或 ratioToSize')
  console.log('\n✅ 通过')
  process.exit(0)
}
console.log(`  ❌ ${hits.length} 处把像素渲染给了用户：`)
for (const hit of hits) console.log(`     ${hit.file}:${hit.line}  ${hit.text}`)
console.log('\n  改法：把那一行换成**比例**（`{ratio}`），或者干脆不提尺寸。')
console.log('  像素只应该出现在请求体里 —— 见 data/catalog.ts 的约定。')
process.exit(1)
