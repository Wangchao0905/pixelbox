#!/usr/bin/env node
/**
 * 门禁：海报方向真的打进产物了
 * ==================================================================
 * 为什么需要它 —— 铁律 #4「源码写了 ≠ 打进包了」：
 *
 * 在此之前没有任何门禁覆盖这条链路。`check:asset-filters` 是从 **TS 源码**里
 * 抽模板数据跑分类，它证明的是「源码里的方向能被筛出来」，**不证明**这些方向
 * 进了 `dist`。所以下面这种改动可以一路全绿：
 *   · 往 `posterDirections` 加了一个方向 → 页面能渲染、typecheck 过、
 *     `verify:dist` 32 项全过，但那个方向在小程序里根本不存在；
 *   · 封面图没 emit（本地 import 路径写错 / 被构建排除）→ 卡片永远空白。
 * 这两种都不会报错，只会「少一个东西」。
 *
 * 判据全部锚在**产物**上：`dist/common.js` 里有没有那个 id / skill / 名称，
 * 封面图有没有真的 emit 到 `dist/assets/`、且真的是图片字节。
 *
 * ⚠️ 三个踩过的坑（都写进判据里了）：
 *   ① 计数不能脱离集合：`id:"…",name:` 会同时匹配**产品模板与头像模板**
 *      （2026-09-23 时是 30 条），拿它断言「海报方向 = N」永远不成立。
 *      所以锚的是**具体 id 清单**，不数总数。
 *   ② 封面文件名判据必须锚到图片扩展名：早期用 `/poster-paper-field/i`，
 *      把图改名成 `poster-paper-field.jpg.hidden` 照样命中 ⇒ 缺图被放过。
 *      对抗测试 `_tools/adversarial-poster-dirs.mjs` 抓出来的。
 *   ③ **「只守了一个被守护的东西」**：名称 / skill / 提示词三项原先只硬编码了
 *      paper-field 一条。加第 12 个方向时只补了 id 和封面，那三项没人守。
 *      现在改成**遍历全部方向**，期望值从源码抽（不重抄，重抄会漂）。
 *
 * 用法：npm run check:poster-directions（需先 build 过）
 * 对抗测试：node ../_tools/adversarial-poster-dirs.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MINI = path.resolve(HERE, '..')
const COMMON = path.join(MINI, 'dist', 'common.js')
const ASSETS = path.join(MINI, 'dist', 'assets')

/**
 * 期望存在的海报方向（顺序即展示顺序）。加新方向时同步这里。
 *
 * ⚠️ 2026-09-26：`phone-candid`（手机直出）已删除，16 → **15** 个。
 *    王指出他从没要求设计过这个方向。删它要**同时**改三处：
 *      · 本清单（POSTER_IDS + LOCAL_COVERS）
 *      · forme-taro/src/data/prompt-templates.ts（含 import 与封面文件）
 *      · work/visual-studio/src/prompt-templates.ts 与 jev-probe.mjs（镜像）
 */
const POSTER_IDS = [
  'orbit-editorial', 'three-act', 'framed-focus', 'asymmetric-archive', 'specimen-grid',
  'type-as-image', 'veil-material', 'diagonal-motion', 'ink-monograph', 'nocturne-field',
  'paper-field', 'food-type', 'shallow-dof', 'overhead-flatlay',
  'anomaly-subject'
]

/**
 * 本地打包的封面：方向 id → 文件名判据。
 * 文件名可能带构建 hash，所以扩展名前允许一段 hash。
 */
const LOCAL_COVERS = {
  'paper-field': /^poster-paper-field(\.[a-z0-9]+)?\.(jpe?g|png|webp)$/i,
  'food-type': /^poster-food-type(\.[a-z0-9]+)?\.(jpe?g|png|webp)$/i,
  'shallow-dof': /^poster-shallow-dof(\.[a-z0-9]+)?\.(jpe?g|png|webp)$/i,
  'overhead-flatlay': /^poster-overhead-flatlay(\.[a-z0-9]+)?\.(jpe?g|png|webp)$/i,
  'anomaly-subject': /^poster-anomaly-subject(\.[a-z0-9]+)?\.(jpe?g|png|webp)$/i
}

/** 主包体积上限：本地封面按 640 宽压过，超了说明忘了压 */
const COVER_MAX_BYTES = 120 * 1024

let bad = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`)
  if (!ok) bad += 1
}

console.log('\n海报方向 · 产物门禁\n' + '─'.repeat(56))

if (!fs.existsSync(COMMON)) {
  console.error(`❌ 找不到 ${COMMON}\n   先 npm run build:weapp`)
  process.exit(1)
}

const code = fs.readFileSync(COMMON, 'utf8')

/**
 * 产物里中文是 `\uXXXX` 转义 —— 统一**解回来**，别去猜打包器的转义策略。
 * ⚠️ 这里错过两次，两次都是「解码器不完整」而不是「数据不对」：
 *    ① 第一版写的是 `esc(s)`：把字符串逐字符转成 `\uXXXX` 再 `includes`。
 *       错在**把 ASCII 也转了**（`制作 9:16` → `\u5236\u4f5c\u00209\u003a16`），
 *       而产物只转非 ASCII ⇒ **12 条提示词一条都匹配不上**。
 *       短的中文名（纯中文，两种写法一样）反而能过，所以它像数据问题、不像判据问题。
 *    ② 第二版改成解码 `\uXXXX`，仍然漏了 `\xNN`：`overhead-flatlay` 的提示词含
 *       `°`（U+00B0 < 0x100），esbuild 对 0x80..0xFF 用 **`\xb0`** 而不是 `\u00b0`
 *       ⇒ 那一条又匹配不上。**门禁自己报出来了，不然就是静默漏检。**
 *    ⇒ 结论：解码必须覆盖打包器**实际会用**的全部形式，而且这件事要被**自测证明**。
 *      下面 5 个样本就是这道自测 —— 解码器再缺一种形式，它会先红。
 */
const decodeJs = (s) =>
  s.replace(
    /\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(\r\n|[\s\S]))/g,
    (_m, uBrace, u4, x2, other) => {
      if (uBrace) return String.fromCodePoint(parseInt(uBrace, 16))
      if (u4) return String.fromCharCode(parseInt(u4, 16))
      if (x2) return String.fromCharCode(parseInt(x2, 16))
      return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[other] ?? other
    }
  )

const decodeSamples = [
  ['\\u5236\\u4f5c', '制作'],          // \uXXXX（中文）
  ['90\\xb0', '90°'],                  // \xNN（Latin-1 区）
  ['\\u00a5 32', '¥ 32'],              // \uXXXX 形式的 Latin-1
  ['\\u{1f388}', '\u{1f388}'],         // \u{…}（码点 > BMP）
  ['a\\nb', 'a\nb']                    // 简单转义
]
const decodeBad = decodeSamples.filter(([enc, plain]) => decodeJs(enc) !== plain)
check(`判据自测：转义解码器覆盖 \\uXXXX / \\xNN / \\u{…} / \\n（${decodeSamples.length} 个样本）`,
  decodeBad.length === 0,
  decodeBad.length
    ? decodeBad.map(([enc, plain]) => `${JSON.stringify(enc)} 应为 ${JSON.stringify(plain)} 实得 ${JSON.stringify(decodeJs(enc))}`).join(' / ')
    : '')

const decoded = decodeJs(code)
const hasText = (s) => decoded.includes(s)

const ids = [...code.matchAll(/id:"([a-z][a-z-]*)",name:/g)].map((m) => m[1])

const missing = POSTER_IDS.filter((id) => !ids.includes(id))
check(`全部 ${POSTER_IDS.length} 个海报方向的 id 都在产物里`, missing.length === 0,
  missing.length ? `缺：${missing.join(', ')}` : '')

// 顺序也要对：方向列表直接决定下拉框里的编号
const present = ids.filter((id) => POSTER_IDS.includes(id))
check('方向顺序与源码一致', JSON.stringify(present) === JSON.stringify(POSTER_IDS),
  present.length === POSTER_IDS.length ? '' : `产物里只找到 ${present.length} 个`)

/* ---------------- 名称 / skill / 提示词：**逐个查，不挑一个查** ----------------
 * ⚠️ 早期这里只硬编码了 paper-field 的「纸域微景 / ORIENTAL PAPER FIELD / 大色域」。
 *    加第 12 个方向 food-type 时，我只补了 id 和封面 —— **名称、skill、提示词
 *    三项都没人守**。这就是「别假设只有一个被守护的东西」的教科书例子：
 *    门禁看着挺严，实际只守着 12 个里的 1 个。
 *
 * ⚠️⚠️ 而且判据必须锚到**字段写法**（`name:"…"`），不能只做全文子串匹配。
 *    对抗测试 `_tools/adversarial-poster-dirs.mjs` 抓出来的：
 *    原本 `name` 的判据是 `hasText('浅景分离')`，可这个名字**同时也出现在它自己的
 *    提示词里**（「竖版浅景分离编辑海报」）⇒ 只把 `name` 字段改坏、提示词里那份还在，
 *    检查照样通过。**判据看着在守 name，其实没守。**
 *    同 `verify-dist` 里 `code.includes(title)` 那个坑（见铁律 #11）：
 *    同一个字符串在产物里出现多次时，子串匹配是最弱的判据。
 *
 * 期望值**从源码抽**，不在这里重抄一份 —— 重抄就会漂，而且改提示词时要改两处。
 * 抽出来的条数必须与 POSTER_IDS 完全对上：否则「解析器悄悄少抽了几条」
 * 会让这个检查静默变弱（校验器自己的计数不能依赖它自己）。
 * ------------------------------------------------------------------------- */
const SRC = path.join(MINI, 'src', 'data', 'prompt-templates.ts')
const srcText = fs.readFileSync(SRC, 'utf8')
const srcStart = srcText.indexOf('export const posterDirections')
if (srcStart === -1) {
  console.error('❌ 源码里找不到 posterDirections')
  process.exit(1)
}
const srcBody = srcText.slice(srcStart, srcText.indexOf('\nexport ', srcStart + 10))
const fromSrc = [...srcBody.matchAll(
  /id:\s*'([^']+)'[\s\S]*?name:\s*'([^']+)'[\s\S]*?skill:\s*'([^']+)'[\s\S]*?system:\s*'([^']+)'/g
)].map((m) => ({ id: m[1], name: m[2], skill: m[3], system: m[4] }))

check(`源码解析出的方向与清单完全一致（${POSTER_IDS.length} 条）`,
  JSON.stringify(fromSrc.map((d) => d.id)) === JSON.stringify(POSTER_IDS),
  fromSrc.length ? `源码解析到 ${fromSrc.length} 条` : '❌ 一条都解析不出 ⇒ 下面的检查会静默失效')

/** 锚到字段写法，而不是全文子串 —— 否则同名字符串出现在别处就能蒙混过关 */
const fieldHas = (key, value) => hasText(`${key}:"${value}"`)

const missingText = []
for (const { id, name, skill, system } of fromSrc) {
  if (!fieldHas('name', name)) missingText.push(`${id}·名称「${name}」`)
  if (!fieldHas('skill', skill)) missingText.push(`${id}·skill「${skill}」`)
  if (!fieldHas('system', system)) missingText.push(`${id}·提示词（${system.length} 字）`)
}
check(`全部 ${fromSrc.length} 个方向的名称 / skill / 提示词都以字段形式在产物里`,
  missingText.length === 0,
  missingText.length ? `缺：${missingText.join(' / ')}` : '')

for (const [id, pattern] of Object.entries(LOCAL_COVERS)) {
  if (!POSTER_IDS.includes(id)) {
    check(`LOCAL_COVERS 的键「${id}」是个真方向`, false, '这个 id 不在 POSTER_IDS 里 ⇒ 判据锚错了对象')
    continue
  }
  const hit = fs.existsSync(ASSETS)
    ? fs.readdirSync(ASSETS).filter((f) => pattern.test(f))
    : []
  check(`「${id}」的本地封面已 emit`, hit.length > 0, hit.join(', '))
  if (!hit.length) continue

  const p = path.join(ASSETS, hit[0])
  const size = fs.statSync(p).size
  check(`「${id}」封面体积合理（< ${COVER_MAX_BYTES / 1024}KB）`, size < COVER_MAX_BYTES,
    `${(size / 1024).toFixed(0)} KB`)

  // 防呆：确认它真是图片，不是 HTML 错误页/占位文本
  // （同 deploy/fetch-covers.mjs 的判据 —— 那边也踩过把错误页存成 jpg）
  const head = fs.readFileSync(p).subarray(0, 2)
  const isImage = (head[0] === 0xff && head[1] === 0xd8) || (head[0] === 0x89 && head[1] === 0x50)
  check(`「${id}」封面确实是图片字节`, isImage,
    isImage ? '' : `前两字节 ${head[0]?.toString(16)} ${head[1]?.toString(16)}`)
}

/* ---------------- 首页卡片 → 海报页的**路由参数名** ----------------
 * 2026-09-25 加。把海报方向并进首页卡片轮播时发现的**静默**陷阱：
 *   · create-product / create-avatar 读的是 `?id=`
 *   · **create-poster 读的是 `?direction=`**（create-poster/index.tsx 第 29 行）
 * 照抄 `?id=` **不报任何错** —— 点卡片会打开 `posterDirections[0]`（轨道圆场），
 * 用户看到一张不相干的海报，而 typecheck / verify:dist 全绿。
 * 这正是「沉默的失败」那一类：接线错了，界面照样能用。
 *
 * ⚠️ 判据锚**路由参数名**，不锚某张卡的名字：`?direction=food-type` 是运行时拼出来的，
 *    产物里不以字面量存在 —— 锚它会得到一条**永远为真**的断言（比没有更坏）。
 */
const HOME_JS = path.join(MINI, 'dist', 'pages', 'home', 'index.js')
if (!fs.existsSync(HOME_JS)) {
  check('首页产物存在（dist/pages/home/index.js）', false, '先 npm run build:weapp')
} else {
  const homeJs = decodeJs(fs.readFileSync(HOME_JS, 'utf8'))
  const wrongParam = homeJs.includes('create-poster/index?id=')
  check('首页卡片指向海报页时用 `direction=`（不是 `id=`）',
    homeJs.includes('create-poster/index?direction=') && !wrongParam,
    wrongParam
      ? '❌ 产物里出现了 `create-poster/index?id=` —— 海报页不读 id，点进去会静默打开第一个方向'
      : '')

  /*
   * 首页置顶的那个海报方向 id 必须是**真实存在**的方向（2026-09-25 加）。
   *
   * ⚠️ 拼错一个字母不会报任何错：`LEAD_CARDS` 里那个 `filter` 匹配不到任何卡
   *    ⇒ 轮播**静默少一张**（22 → 21），首页看起来完全正常、别的门禁全绿。
   *    这是「接线错了但界面照样能用」那一类，只能靠门禁钉住。
   *
   * ⚠️ 这里读**源码**而不是产物：`POSTER_PIN_ID` 的值只在源码里是个字面量，
   *    产物里它已经被展开成卡片数据了，认不出来。
   *    而 `POSTER_IDS` 本身在文件开头已被验证与源码解析结果一致 ⇒ 拿它当判据是安全的。
   */
  const HOME_SRC = path.join(MINI, 'src', 'pages', 'home', 'index.tsx')
  const pinId = /const POSTER_PIN_ID = '([^']+)'/.exec(fs.readFileSync(HOME_SRC, 'utf8'))?.[1] ?? null
  const pinOk = pinId !== null && POSTER_IDS.includes(pinId)
  check(
    '首页置顶的 id 是一个真实的海报方向',
    pinOk,
    // ⚠️ detail 是**无条件打印**的 ⇒ 通过时必须给空串，否则绿行后面跟着一句 ❌。
    pinOk
      ? ''
      : pinId === null
        ? '❌ home/index.tsx 里找不到 `const POSTER_PIN_ID = \'…\'` —— 改名或改写法了？'
        : `❌ POSTER_PIN_ID='${pinId}' 不在海报方向清单里 ⇒ 轮播会静默少一张卡（不报错）`
  )

  /*
   * 🔴 首页轮播**白名单**里的每个 id 都必须是真方向（2026-09-26 加）。
   *
   * 背景：王指出「首页轮播图中有一个手机直出的模板，我没有要求设计这个模板」。
   * 根因是 `posterCards` 曾经**全量** `posterDirections.map(...)`，靠
   * `.filter(card => !/^https?:/.test(card.cover))` 收口 —— 那条 filter 的
   * **实际效果**是「封面是本地图的方向才进轮播」⇒ 首页展示什么由**打包细节**决定。
   * 现在改成显式白名单 `CAROUSEL_POSTER_IDS`。
   *
   * ⚠️ 白名单里拼错一个字母同样是**静默失败**：`.filter(t => IDS.includes(t.id))`
   *    匹配不到任何方向 ⇒ 那张卡静默消失，首页看着完全正常、别的门禁全绿。
   *    和上面 `POSTER_PIN_ID` 那条是同一类坑。
   */
  const homeSrc = fs.readFileSync(HOME_SRC, 'utf8')
  const allowBlock = /const CAROUSEL_POSTER_IDS\s*=\s*\[([^\]]*)\]/.exec(homeSrc)?.[1] ?? null
  const allowIds = allowBlock === null ? [] : [...allowBlock.matchAll(/'([^']+)'/g)].map((m) => m[1])
  const allowBad = allowIds.filter((id) => !POSTER_IDS.includes(id))
  check(
    `首页轮播白名单里的 ${allowIds.length} 个 id 都是真方向`,
    allowBlock !== null && allowIds.length > 0 && allowBad.length === 0,
    allowBlock === null
      ? '❌ home/index.tsx 里找不到 `const CAROUSEL_POSTER_IDS = [ … ]` —— 改名或删掉了？'
      : allowIds.length === 0
        ? '❌ 白名单是空的 ⇒ 首页轮播一张海报卡都不会有（静默，不报错）'
        : allowBad.length
          ? `❌ 白名单里的 ${allowBad.join(', ')} 不在海报方向清单里 ⇒ 这几张卡会**静默消失**`
          : ''
  )

  /*
   * 🪦 这里原来还有一条「首页产物里有置顶卡 id（food-type）」。
   * 2026-09-25 删掉了 —— 它是**永远为真**的，而「留一条永远为真的断言比没有更坏」。
   *
   * 为什么它永远为真（2026-09-26 更新理由）：`home/index.tsx` 的轮播海报卡现在来自
   * **白名单** `CAROUSEL_POSTER_IDS = ['food-type']`，而 `POSTER_PIN_ID` 也是
   * `'food-type'` ⇒ 这个字面量在首页 bundle 里**无论如何**都存在，
   * 跟有没有置顶、置顶的是哪一张毫无关系。（改白名单之前，理由是「food-type
   * 本来就是 15 个方向之一」—— 结论一样，但那是另一条路径。）
   *
   * 那「谁在第一张」到底该谁守？—— **源码级**，不是产物级：
   * 顺序是运行时算出来的，产物里只有 `...LEAD_CARDS` 这个展开。
   * ⇒ 见 `scripts/test-creator-ui.mjs` 里那组（LEAD_CARDS 首项 + CARDS 展开顺序）。
   *    唯一能看到运行时 DOM 的是 `scripts/measure-page.mjs`，但它是**手写 mock**，
   *    拿它当判据等于造第二个真源。
   */
}

console.log('─'.repeat(56))
console.log(bad ? `❌ ${bad} 项不通过\n` : '✅ 通过\n')
process.exit(bad ? 1 : 0)
