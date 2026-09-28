#!/usr/bin/env node
/**
 * 上传前产物校验
 * ------------------------------------------------------------------
 * 构建通过 ≠ 可以上传。
 *
 * 这个脚本把「打包后必须成立的不变量」钉死，分两类：
 *
 *   阻断项 —— 产物本身有问题，修了才能传。
 *     有些是合规要求（AIGC 标识链路必须真的进了包），
 *     有些直接关系到钱（演示模式没关 = 用户付费后拿到占位图）。
 *
 *   提醒项 —— 还没做的事，上线前必须做，但不算产物的错。
 *     典型是域名占位符还没换。
 *
 * 为什么在**产物**上查，而不是在源码上查：
 *   1. 这些能力分散在多个模块，靠 import 关系才会进包。源码里「写了」
 *      不等于「被打进去了」——tree-shaking、条件编译都可能把它摇掉。
 *   2. 配置类问题（域名、演示模式）是构建时才定形的，源码里看不出结果。
 *      本项目就踩过：`process.env[key]` 动态取值编译不报错，产物里却是
 *      undefined。
 *
 * 用法：npm run build:weapp && npm run verify:dist
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
/** 接口地址与公共模块都编译进这个分块，不在 app.js */
const BUNDLE = join(DIST, 'common.js')
const ASSETS_PAGE = join(DIST, 'pages/assets/index.js')
/** 自有域名从这里读，避免脚本里再抄一份 */
const ENV_PROD = '.env.production'

/**
 * 从 .env.production 读一个键。
 * 读的是构建时的真实来源 —— 脚本里硬编码一份「自有域名」迟早会和
 * .env.production 漂移，那种漂移是静默的。
 *
 * ⚠️ 分隔符只能用 `[ \t]`，**不能用 `\s`**：`\s` 包含换行符，
 * 遇到 `KEY=`（空值）时，贪婪的 `\s*` 会直接跨到下一行去，
 * 把下一行的内容当成这个键的值。实测 `TARO_APP_MEDIA_BASE=` 读出来是
 * `"TARO_APP_FONT_BASE="` —— 于是「mediaBase 已配置」误判为真，
 * 检查静默通过。**一个不报警的门禁比没有门禁更糟：它给你安全感。**
 */
function readEnvProdAll(key) {
  if (!existsSync(ENV_PROD)) return []
  const pattern = new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*(.*)$`, 'gm')
  return [...readFileSync(ENV_PROD, 'utf8').matchAll(pattern)].map((m) =>
    m[1].trim().replace(/^["']|["']$/g, '')
  )
}

/**
 * 取值。**同键出现多次时取最后一个** —— 必须和 Taro 的 dotenv 一致。
 *
 * 如果两边的取值规则不同，门禁就会对着一个「实际不会被使用的值」下判断，
 * 而这种分歧是**静默的**：门禁显示绿色，线上用的是另一个值。
 * 本项目已经被同类问题咬过一次 —— 8 条生产拦截读 `process.env.NODE_ENV`，
 * 而运维把 `NODE_ENV=production` 写进了 `.env.local`，两边不同源，
 * 拦截全部失效且不报错。**判据和被守护的东西必须同源。**
 */
function readEnvProd(key) {
  const all = readEnvProdAll(key)
  return all.length ? all[all.length - 1] : ''
}

/** `.env.production` 里重复定义的键。重复定义 = 有一个值永远不会生效，且没人知道是哪个。 */
function duplicateEnvKeys() {
  if (!existsSync(ENV_PROD)) return []
  const counts = new Map()
  for (const line of readFileSync(ENV_PROD, 'utf8').split(/\r?\n/)) {
    const matched = line.match(/^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/)
    if (matched) counts.set(matched[1], (counts.get(matched[1]) ?? 0) + 1)
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key)
}

/** 取 hostname；不是合法 URL 时返回空串（占位域名由上面那条检查负责报） */
function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** dist 里全部 .js（含子目录）。共享 chunk 的判定要扫全部，不能只看某一个包。 */
function allJsFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name.endsWith('.js')) out.push(p)
    }
  }
  if (existsSync(DIST)) walk(DIST)
  return out
}

/**
 * 找出「导出某张静态资源」的 webpack 模块 id。
 * ------------------------------------------------------------------
 * Taro/Webpack 把 `import x from '.../a.jpg'` 编译成一个模块：
 *     <id>:function(e,n,t){e.exports=t.p+"assets/a.jpg"}
 *
 * 🔴 **为什么必须锚模块 id，不能锚资源路径**（2026-09-27 实测）：
 *    图片落在哪个 chunk，取决于**有几个页面 import 它**。
 *    `cover-inspiration-recreate.jpg` 原来只有首页 import ⇒ 模块在
 *    `pages/home/index.js` 里，路径字符串也在那儿 ⇒ 「首页真的引用了它」
 *    可以用 `homeCode.includes('assets/…')` 判。
 *    但灵感复刻页的页头缩略图也用同一张图之后，模块被提到**共享 chunk**
 *    （`common.js`），首页分块里只剩 `m=a(2888)` 这个**模块 id 引用**，
 *    路径字符串整个消失了 ⇒ 那条判据变成**假红**。
 *
 *    ⚠️ 换成「扫全部 dist 的 .js」（`anyJsMentions`）也能消掉假红，但那会让
 *       这条判据**退化成永远为真** —— 只要还有**别的**页面用这张图，它就绿，
 *       首页的封面被删掉也不会红（铁律 #27：判据范围过宽 = 假门禁）。
 *       ⇒ 锚模块 id：既不受分块影响，又只有「首页真的 require 了它」才绿。
 */
function assetModuleId(file) {
  const needle = `t.p+"assets/${file}"`
  for (const js of allJsFiles()) {
    const text = readFileSync(js, 'utf8')
    const at = text.indexOf(needle)
    if (at === -1) continue
    const m = /(\d+):function\([^)]*\)\{[^}]*$/.exec(text.slice(Math.max(0, at - 160), at))
    if (m) return m[1]
  }
  return null
}

if (!existsSync(BUNDLE)) {
  console.error(`❌ 找不到 ${BUNDLE}`)
  console.error('   先跑 npm run build:weapp，再跑这个脚本。')
  process.exit(1)
}

const bundle = readFileSync(BUNDLE, 'utf8')
const assetsPage = existsSync(ASSETS_PAGE) ? readFileSync(ASSETS_PAGE, 'utf8') : ''

const blockers = []
const reminders = []
/** 已声明的检查项总数，自动累计 —— 别手写常数，加一条检查就会漂 */
let declared = 0

/** 产物有问题，必须修 */
function must(name, ok, hint) {
  declared += 1
  if (!ok) blockers.push({ name, hint })
}

/** 还没做的事：上线前必须处理，但不拦这次校验 */
function should(name, ok, hint) {
  declared += 1
  if (!ok) reminders.push({ name, hint })
}

/* ---------------- 资金安全 ---------------- */

must(
  '演示模式已关闭',
  /useMockGeneration:!1/.test(bundle),
  '产物里是 useMockGeneration:!0。生产构建本应强制关闭（见 src/config/index.ts），' +
    '出现 !0 说明该保护被改掉了。为 1 时用户付费后拿到的是本地占位图。'
)

must(
  '出图单价兜底值存在',
  /costPerImage:\s*\.?\d/.test(bundle),
  '找不到 costPerImage。演示模式与离线兜底会算不出消耗。'
)

// 幂等键的复用逻辑。服务端的幂等只在「同一个 requestId」下成立，
// 客户端每次调用都发新 id 的话，用户网络超时后点一次「重试」就会被多扣一次钱。
// 复用规则本身由 `npm run check:request-key` 测（13 项，跑的是真实模块）；
// 这里只确认它真的被打进包了，否则会被 tree-shaking 摇掉。
//
// 判据只用 ASCII 且不会被压缩器改写的字面量：属性名 `requestId` 是发出去的
// JSON 字段，压缩器不会重命名它。**不要**去匹配控制字符或 `\uXXXX` ——
// 压缩器会自行选择转义形式（实测把 `\u0000` 改写成了 `\0`），
// 按字面量找必然失效。
must(
  '幂等键随生成请求发出',
  bundle.includes('requestId'),
  '产物里找不到 requestId。生成请求没带幂等键的话，' +
    '网络超时后重试会重复扣费（服务端只在同一个 requestId 下才幂等）。'
)

must(
  '幂等键生成器存在',
  bundle.includes('toString(36)'),
  '找不到幂等键生成逻辑，生成请求可能没有带 requestId。'
)

/* ---------------- AIGC 合规 ---------------- */

// 《人工智能生成合成内容标识办法》第四条末段：下载/导出时必须带显式标识。
// 这条链路少任何一环，导出的图就没有可见标识，所以逐个环节都要在包里。
const AIGC_CHAIN = [
  ['离屏画布', 'createOffscreenCanvas', '拿不到画布就没法合成标识'],
  ['下载原图', 'downloadFile', '网络图需要先落到本地才能画'],
  ['圆角胶囊', 'arcTo', '标识背景的画法'],
  ['写入文案', 'fillText', '标识正文'],
  ['导出文件', 'canvasToTempFilePath', '合成结果要能落成文件'],
  ['失败回退日志', '[aigc]', '合成失败必须留痕，否则线上静默失效无从发现']
]

for (const [label, needle, why] of AIGC_CHAIN) {
  must(`导出标识链路：${label}`, bundle.includes(needle), `${why}（缺 ${needle}）`)
}

must(
  'AIGC 文案兜底存在',
  bundle.includes('aigcLabel:"AI'),
  '拿不到 /api/catalog 时需要兜底文案，否则标识会渲染成空。'
)

// 资产页的预览必须走「已合成标识的副本」。
// 微信 previewImage 自带长按菜单「保存图片 / 发送给朋友」，是一条绕过标识的
// 下载路径。直接调 Taro.previewImage 就意味着这条路径没被收口。
must(
  '资产页预览已收口',
  Boolean(assetsPage) && !assetsPage.includes('previewImage'),
  '资产页仍在直接调用 previewImage：其长按菜单保存出来的图不带显式标识。' +
    '应改用 services/export-image 的 previewLabeledImages。'
)

/* ---------------- 隐私合规 ---------------- */

must(
  '隐私同意按钮存在',
  bundle.includes('agreePrivacyAuthorization'),
  'chooseMedia / saveImageToPhotosAlbum 是隐私接口。' +
    '同意按钮必须是原生 Button open-type="agreePrivacyAuthorization"，' +
    '缺了它用户无法授权，接口会一直失败。'
)

/* ---------------- 全屏（自定义导航栏） ---------------- */

// navigationStyle: 'custom' 换来全屏（app 背景铺到屏幕最上沿，盖住状态栏 / 灵动岛），
// 代价是**微信不再提供导航栏，也不再提供返回箭头** —— 返回按钮完全由
// components/AppHeader 提供。所以每个非首页页面都必须渲染它：
// 漏一个 = 那个页面用户进去就出不来。这是「用户出不去」，不是样式问题。
const APP_JSON = join(DIST, 'app.json')

function readAppJson() {
  if (!existsSync(APP_JSON)) return {}
  try {
    return JSON.parse(readFileSync(APP_JSON, 'utf8'))
  } catch {
    return {}
  }
}

must(
  '全屏模式已开启',
  readAppJson().window?.navigationStyle === 'custom',
  'app.json 的 window.navigationStyle 不是 custom。默认模式下微信会在顶部画一条\n' +
    '      原生导航栏，页面只能从它下面开始 —— 上方留白、盖不住状态栏 / 灵动岛。'
)

/**
 * 每个非首页页面「有返回入口」的锚点。
 * ------------------------------------------------------------------
 * 用各页传给 AppHeader 的标题做锚点，而不是找组件代码：AppHeader 是共享模块，
 * webpack 会把它提到 common.js，页面分块里只剩下**调用点**。
 * 标题是调用点的字面量，一定留在那个页面自己的分块里。
 *
 * ⚠️ 中文在产物里可能是 \uXXXX 转义，两种形态都要认（别只按字面量找）。
 *
 * ⚠️ **加新页面必须同时加进这张表**，否则那个页面就是「没人守」的 ——
 *    门禁只会遍历这张表，表外的页面漏了 AppHeader 也照样全绿。
 *    标题要和页面里 `<AppHeader title='...' />` 的字面量**完全一致**。
 */
const HEADER_PAGES = [
  ['pages/assets/index', '资产库'],
  ['pages/avatar-gallery/index', '头像模板'],
  ['pages/create-avatar/index', '头像生成'],
  ['pages/create-freeform/index', '自由生图'],
  ['pages/create-marketplace/index', '电商主图'],
  ['package-portrait/pages/index', 'AI写真'],
  ['pages/create-poster/index', '字段式海报'],
  ['pages/create-product/index', '产品替换'],
  ['pages/create-product-shot/index', '产品拍摄'],
  ['pages/create-reference/index', '灵感复刻'],
  ['pages/product-gallery/index', '产品工作室'],
  ['pages/profile/index', '我的'],
  ['pages/result/index', '生成结果'],
  ['pages/recharge/index', '充值中心']
]

/** 转义成 \uXXXX 的形态（压缩器可能这么输出） */
function escapeUnicode(text) {
  return [...text]
    .map((ch) => (ch.charCodeAt(0) > 127 ? `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}` : ch))
    .join('')
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

for (const [page, title] of HEADER_PAGES) {
  const pageBundle = join(DIST, `${page}.js`)
  const code = existsSync(pageBundle) ? readFileSync(pageBundle, 'utf8') : ''

  /**
   * ⚠️ 判据必须锚定到 `title:"…"` 这个**属性写法**，不能只判 `code.includes(title)`。
   * ------------------------------------------------------------------
   * 实测（2026-09-22）：页面配置里的 `navigationBarTitleText` 会被内联进**同一个** chunk，
   * 于是同一个标题字符串在产物里出现两次：
   *     {title:"头像模板"}                    ← AppHeader 的调用点，这才是我们要的
   *     {navigationBarTitleText:"头像模板"}    ← 页面配置，custom 模式下根本不生效
   * 只判 `includes` 的话，把 `<AppHeader>` 删掉、留着 `index.config.ts` 的标题，
   * 门禁照样全绿 —— 而那个页面在 custom 模式下**没有返回箭头**，用户进去出不来。
   * `title:"` 不会出现在 `navigationBarTitleText:"` 里，所以能把两者分开。
   */
  const asHeaderCall = new RegExp(`title\\s*:\\s*"${escapeRegExp(title)}"`)
  const asHeaderCallEscaped = new RegExp(`title\\s*:\\s*"${escapeRegExp(escapeUnicode(title))}"`)

  must(
    `${page} 有返回入口`,
    asHeaderCall.test(code) || asHeaderCallEscaped.test(code),
    `dist/${page}.js 里找不到 <AppHeader title="${title}" /> 的调用点。\n` +
      '      custom 模式下微信不提供返回箭头，这个页面会没有出口。\n' +
      '      注意：页面配置里的 navigationBarTitleText 不算数 —— 那个字段在 custom\n' +
      '      模式下不生效，它只是同一个字符串的另一处出现。'
  )
}

/**
 * 顶栏必须给微信胶囊让位（--capsule-r）
 * ------------------------------------------------------------------
 * 背景：`navigationStyle: 'custom'` 只是**不画原生导航栏**，微信**照样画胶囊**
 * （「···」+「⊙」）。实测 393 宽屏上胶囊占 x306..384 / y58..81，
 * 正好落在顶栏那一行里。
 *
 * ⚠️ 判据**不能**写成「每个页面分块里都有 --capsule-r」。
 * 实测（2026-09-22，构建后 grep dist）：AppHeader 是**共享组件**，
 * 它的实现被打进 `common.js`，页面分块里只有 `{title:"资产库"}` 这样的调用点。
 * 按页面分块断言会让 10 个页面全红 —— 而接线是对的。**假失败**。
 * （页面级的「AppHeader 有没有被调用」由上面 HEADER_PAGES 那条守，各管各的。）
 *
 * ⚠️ 也不能只写「common.js 里有 --capsule-r」就完事：哪天 AppHeader 被挪出
 * 这个分块，那条会**静默退化成空断言** —— common.js 还在、检查还绿，
 * 但要守的东西已经不在这个文件里了。所以先断言锚点 `app-header`
 * 确实在这个分块里：**锚点丢了就报错，而不是安静地通过。**
 */
must(
  '顶栏实现仍在共享分块里（锚点自检）',
  bundle.includes('app-header'),
  `dist/common.js 里找不到 app-header —— AppHeader 的实现可能被挪到了别的分块，\n` +
    '      下面那条「顶栏已给胶囊让位」会因此变成永远为真的空门禁。\n' +
    '      请把这两条断言一起挪到 AppHeader 实际所在的分块。'
)

must(
  '顶栏已给胶囊让位',
  bundle.includes('--capsule-r'),
  'dist/common.js 里找不到 --capsule-r —— AppHeader 没有注入胶囊让位。\n' +
    '      结果：.header-title 的 max-width 退回兜底值（只减 104px，不减胶囊），\n' +
    '      长标题会滑到微信胶囊底下 —— 既看不清也点不到，且只在真机上复现。'
)

// 首页没有顶栏（原型里首页就是品牌行贴顶），但同样要让状态栏让位，
// 否则品牌行会和左上角的系统时钟叠在一起。锚点是内联注入的变量名。
const homeBundle = join(DIST, 'pages', 'home', 'index.js')
must(
  '首页已给状态栏让位',
  existsSync(homeBundle) && readFileSync(homeBundle, 'utf8').includes('--safe-t'),
  'dist/pages/home/index.js 里找不到 --safe-t。首页会顶到屏幕最上沿，\n' +
    '      品牌行与系统时钟重叠。'
)

/**
 * 首页的头像和顶栏不一样，它是**贴右的实心内容**，所以必须真的把空间让出去。
 * 首页不经过 AppHeader（自己有 .hd-topline），所以这条要单独查首页分块 ——
 * 上面那条查的是 common.js，两条各守各的载体，别合并。
 */
must(
  '首页已给胶囊让位',
  existsSync(homeBundle) && readFileSync(homeBundle, 'utf8').includes('--capsule-r'),
  'dist/pages/home/index.js 里找不到 --capsule-r。\n' +
    '      .hd-topline 的 padding-right 是 calc(20px + var(--capsule-r))。\n' +
    '      ⚠️ 令牌块里 --capsule-r 有 0px 兜底，所以这条声明**不会失效**，\n' +
    '      它只是让位变成 0 —— 头像被胶囊压住（2026-09-22 实测：只露出 13px 一条边）。\n' +
    '      这种「不报错、只是坏了」正是最该由门禁兜住的一类。'
)

/**
 * ⚠️ 调试探针不许进产物 —— 这条现在是**回归守卫**（2026-09-23 改写）。
 *
 * 来历：2026-09-22 为量真机胶囊几何，在首页临时加过一个 `__CAPSULE_PROBE__` 打点块，
 * 2026-09-23 已按约定删除。这条检查**留着不删** —— 它守的从「这一块探针」
 * 变成了「任何一块探针」：临时调试代码很容易加进去就忘了删，
 * 而它**不影响功能、只往用户手机打日志**，靠 review 是发现不了的。
 *
 * 为什么是 `should`（提醒）而不是 `must`（阻断）：探针不影响功能，
 * 只是会在**用户手机**上打日志 —— 对「产物对不对」它不是错，
 * 对「交付/上线」它是脏东西。两种性质不该混在一个档里，否则阻断项会失去威慑力。
 *
 * 锚点用 ASCII 的 `__CAPSULE_PROBE__`：中文会被 Taro 编译成 `\uXXXX` 转义，
 * 拿中文去 grep 产物**永远 0 命中**（本项目踩过，见 SKILL/记忆里的「沉默的失败」）。
 * 所以探针里特意留了一个 ASCII 标记专门给门禁用。
 * ⇒ **以后再加探针，照样留一个 ASCII 标记**，这条就能继续守。
 */
should(
  '产物里没有调试探针',
  !existsSync(homeBundle) || !readFileSync(homeBundle, 'utf8').includes('__CAPSULE_PROBE__'),
  'dist/pages/home/index.js 里出现了 __CAPSULE_PROBE__ —— 这是为量真机胶囊几何\n' +
    '      加过的临时探针（2026-09-23 已删）。它会在**用户手机上**打日志。\n' +
    '      查法：src/pages/home/index.tsx 里搜 __CAPSULE_PROBE__，删掉整块（含 useRef/useReady 打点）\n' +
    '      以及 import 里因此多出来的 useRef / useReady，然后重新 build。'
)

/* ---------------- 首页轮播封面（首卡 = 灵感复刻） ----------------
 *
 * 首页轮播卡 `.hd-card` 是 236x354（2:3）。首卡「灵感复刻」的封面必须是**同一比例**。
 *
 * 为什么这条值钱：<Image> 用 aspectFill —— **容器比例 ≠ 图片比例时不报错，只是裁掉**。
 * 2026-09-25 之前首卡用的是那张 530x662（4:5）的展示图，塞进 2:3 的卡会
 * **左右各裁 8.36%**；而「参考照片」的包围盒横向从 **0.5%** 就开始
 * （`_tools/measure-ref-photo.py` 实测 x 0.5%..55.1% / y 10.9%..71.3%）
 * ⇒ 它的**左边缘会被切掉 42px（照片宽度的 14.5%）**。
 * 那个矩形边界是「借一张参考图重做」这个概念**唯一的视觉锚点** ——
 * 切掉之后图会退化成「产品图」，而编译、typecheck、其它检查**全是绿的**。
 *
 * 现在用的是左对齐裁出来的 `cover-inspiration-recreate.jpg`（640x960）。
 *   证据图：`_diag/crop-inspiration-card-size.png`（三种裁法按卡片真实尺寸对比）
 *   生成脚本：`_tools/make-cover-inspiration.py`（它自己会断言包围盒在裁切窗口内）
 *
 * ⚠️ 本门禁的**已知边界**：它只锁「比例一致」，锁不住「构图对不对」。
 *    也就是说，换一张别的 2:3 图进来它照样绿 —— 那种只能靠看图
 *    （`_diag/cover-inspiration-preview.py` 的思路：按卡片真实尺寸铺出来看）。
 *    这里不装作能覆盖。
 *
 * ⚠️ 判据钉在**产物**上（dist/assets + dist/app.wxss + dist/pages/home/index.js），
 *    不读源码 —— 源码写了不等于打进了包。
 * ⚠️ 尺寸自己解图片头，不引第三方依赖：依赖越少，别人机器上跑不起来的概率越低。
 */
const emittedAssets = existsSync(join(DIST, 'assets')) ? readdirSync(join(DIST, 'assets')) : []
const COVER_FILE_RE = /^cover-inspiration-recreate(\.[a-z0-9]+)?\.(jpe?g|png|webp)$/i
const coverFile = emittedAssets.find((file) => COVER_FILE_RE.test(file)) ?? null

/** 读 JPEG / PNG 的像素尺寸；解析不出来返回 null（**不猜**） */
function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    if (buf.length < 24) return null // PNG：IHDR 尺寸固定在 16..24 字节
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  }
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null // 不是 JPEG
  let i = 2
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = buf[i + 1]
    // SOF0..SOF15 才带尺寸；C4(DHT) / C8(JPG) / CC(DAC) 不是 SOF，必须跳过
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const segLen = buf.readUInt16BE(i + 2)
    if (segLen < 2) return null
    i += 2 + segLen
  }
  return null
}

/**
 * 取某个类名在产物 CSS 里**全部**规则的声明串（下面还有 .generate-cta 用它）。
 *
 * ⚠️ 必须**遍历所有提到这个类的规则**，不能取「第一个匹配」。
 * 实测（2026-09-23）：压缩器会把选择器**合并**成组，于是
 *   `.composer-section-note,.home-feature-kicker,.inspiration-tag,…{display:block}`
 * 成了 `.home-feature-kicker` 的**第一次**出现 —— 而 `font-size` 在**后面**那条规则里。
 * 按「第一个匹配」取，`font-size` 就是 null，门禁会报「算不出来」而不是报真问题。
 * ⇒ 判据要锚它真正约束的那个表达式：同一个选择器在产物里有**多处**。
 */
function declsFor(cssText, cls) {
  const out = []
  const rule = /([^{}]+)\{([^{}]*)\}/g
  const sel = new RegExp(`\\.${cls}(?![-\\w])`)
  let m
  while ((m = rule.exec(cssText)) !== null) {
    if (sel.test(m[1])) out.push(m[2])
  }
  return out.join(';')
}

/** 取最后一个匹配（CSS 级联：后写的赢）。 */
function pickLast(re, text) {
  if (!re || !text) return null
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g'
  const all = [...text.matchAll(new RegExp(re.source, flags))]
  return all.length ? Number(all[all.length - 1][1]) : null
}

/**
 * 在产物 JS 里找**一个完整的类名字面量** —— 前后必须落在引号 / 空白 / 反引号上。
 *
 * 🔴 绝不能用 `text.includes('composer-block')`（2026-09-27 实测踩到）：
 *    灵感复刻这一页里同时存在 `composer-block-note` 与 `composer-blocker`，
 *    两者**都包含** `composer-block` ⇒ 「旧结构已消失」这条判据**假红**，
 *    而页面其实是对的。同铁律 #11④（墓碑注释会命中自己的门禁）是一类东西：
 *    **判据要锚条目形态，绝不锚裸子串。**
 *    模板字符串里的类（`` `composer-block ${x}` ``）编译成 `"composer-block "`，
 *    后面是空格 ⇒ 同样被这条判据接受。
 */
function hasClassLiteral(text, cls) {
  const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[\\s"'\`])${escaped}(?=[\\s"'\`])`).test(text)
}

const appWxss = existsSync(join(DIST, 'app.wxss')) ? readFileSync(join(DIST, 'app.wxss'), 'utf8') : ''
const homeCode = existsSync(homeBundle) ? readFileSync(homeBundle, 'utf8') : ''

const coverBuf = coverFile ? readFileSync(join(DIST, 'assets', coverFile)) : null
const coverSize = coverBuf ? imageSize(coverBuf) : null

must(
  '轮播封面已 emit 且是真实图片（灵感复刻）',
  Boolean(coverBuf) && coverSize !== null && coverBuf.length > 20 * 1024,
  coverFile === null
    ? 'dist/assets 里找不到 cover-inspiration-recreate.* —— 首页轮播首卡会是一张空白卡。\n' +
      '      查：src/pages/home/index.tsx 的 REFERENCE_CARD 有没有 import 它。\n' +
      '      重做封面：python _tools/make-cover-inspiration.py'
    : coverSize === null
      ? `${coverFile} 的图片头解析不出来 —— 扩展名像图片，内容不是。`
      : `图只有 ${(coverBuf.length / 1024).toFixed(1)} KB，小得不像封面。`
)

/**
 * 光「图在 dist/assets 里」还不够 —— 那只证明它被 import 了。
 * 卡片 JSX 被删掉时，import 若还留着，图**照样会被 emit**，
 * 于是上面那条通过、比例也对、体积也合理，而首卡**根本不存在**。
 *
 * 🔴 2026-09-27 改写（原来的判据是 `homeCode.includes('assets/' + coverFile)`）。
 *    灵感复刻页的页头缩略图也用同一张封面之后，这个模块被提到共享 chunk，
 *    首页分块里不再有路径字符串 ⇒ 原判据**假红**（实测：dist/common.js 里才有）。
 *    ⇒ 改成锚**模块 id**（见 `assetModuleId` 的注释）：
 *       首页分块里必须有 `a(<id>)` 这个 require，或者路径字符串直接在里面。
 *       前者覆盖「模块被提走」，后者覆盖「模块还在首页分块里」。
 *    ⚠️ 不要退化成「扫全部 dist 的 .js」—— 那会因为**别的页面**用了这张图而
 *       永远为真，首页封面被删也不红。
 *
 * ⚠️ 边界：这条只证明**首页 require 了这张图**，不证明它被用在轮播首卡上。
 *    「REFERENCE_CARD 的 cover 指向它」由源码级门禁守着
 *    （test-creator-ui.mjs：`cover: coverInspirationRecreate`）。
 *    两条合起来才完整，各自都不装作能覆盖对方。
 */
const coverModuleId = coverFile ? assetModuleId(coverFile) : null
const homeRequiresCover =
  Boolean(coverFile) &&
  (homeCode.includes(`assets/${coverFile}`) ||
    (coverModuleId !== null && new RegExp(`\\w\\(${coverModuleId}\\)`).test(homeCode)))

must(
  '首页真的引用了轮播封面',
  homeRequiresCover,
  coverFile
    ? `dist/pages/home/index.js 里既没有 assets/${coverFile} 的路径，也没有指向它的模块引用。\n` +
      `      （导出这张图的 webpack 模块 id：${coverModuleId ?? '找不到'}）\n` +
      '      常见成因：REFERENCE_CARD 的 cover 被删了、或 import 名改了却没改用法。\n' +
      '      ⚠️ 若模块 id 是「找不到」而页面其实是好的，多半是 Webpack 的模块\n' +
      '        包装格式变了 —— 修 `assetModuleId()`，不要直接删这条。'
    : '没有可核对的封面文件名（上一条已报）。'
)

must(
  '轮播封面体积合理（< 400KB）',
  Boolean(coverBuf) && coverBuf.length < 400 * 1024,
  `封面有 ${coverBuf ? (coverBuf.length / 1024).toFixed(0) : '?'} KB。\n` +
    '      主包上限 2MB，一张封面不该吃掉超过 1/5。\n' +
    '      改图请重跑 _tools/make-cover-inspiration.py，别手工替换。'
)

/**
 * 封面纵横比必须等于卡片纵横比。
 * 卡片尺寸从**产物 CSS** 读（`.hd-card` 的 width/height），不读源码。
 * 单位可能是 px 也可能是 rpx（pxtransform 会换算）—— 但**同比例缩放**，
 * 所以直接相除即可，与单位无关。
 */
const hdDecls = declsFor(appWxss, 'hd-card')
const hdW = pickLast(/width:([0-9.]+)(?:rpx|px)/, hdDecls)
const hdH = pickLast(/height:([0-9.]+)(?:rpx|px)/, hdDecls)
const hdCardAR = hdW && hdH ? hdW / hdH : null
const coverAR = coverSize ? coverSize.w / coverSize.h : null

must(
  '轮播封面纵横比 = 轮播卡纵横比',
  coverAR !== null && hdCardAR !== null && Math.abs(coverAR - hdCardAR) / hdCardAR < 0.005,
  coverAR === null
    ? '没有可核对的封面尺寸（上面几条已报）。'
    : hdCardAR === null
      ? '产物 CSS 里读不出 .hd-card 的 width/height —— 卡片尺寸没被定下来。\n' +
        `      declsFor 取到：${JSON.stringify(hdDecls).slice(0, 200)}\n` +
        '      查：src/styles/forme.scss 里 .hd-card。'
      : `封面 ar=${coverAR.toFixed(4)}，卡片 ar=${hdCardAR.toFixed(4)}` +
        `（${hdW}x${hdH}）—— 差得超过 0.5%。\n` +
        '      <Image> 是 aspectFill：**比例不一致时不报错，只会裁掉**。\n' +
        '      ⇒ 4:5 的图塞进 2:3 的卡会左右各裁 8.36%，正好切掉「参考照片」的左边缘，\n' +
        '        而那个矩形边界是「借一张参考图重做」这个概念唯一的视觉锚点。\n' +
        '      改法：重跑 python _tools/make-cover-inspiration.py（它按 .hd-card 的比例裁）。'
)

/* ---------------- 产品模板封面：新增的「收据拼贴」 ----------------
 *
 * 2026-09-26：王给的「社论收据拼贴」走产品链，替换掉原「石材工作室」，
 * 排在产品组第一张（= 首页轮播第 8 张）。
 *
 * 为什么它的**比例**要单独锁一次：它和兄弟模板故意不一样。
 *   兄弟的产品封面是 640x853（3:4），塞进 2:3 的轮播卡会裁掉约 11%；
 *   这张刻意做成 640x960（正好 2:3），在轮播里**零裁切**。
 *   这是设计决定，不是巧合 —— 所以它得被断言，
 *   不能被下一个人「顺手统一成 3:4」。
 *
 * ⚠️ 判据钉在**产物**上（dist/assets + dist 里的 .js），不读源码 ——
 *    源码写了不等于打进了包。
 * ⚠️ 引用它的模块是 `prompt-templates`（home 与 product-gallery 共用），
 *    Taro 会把它放进**共享 chunk**，不保证落在 pages/home/index.js 里。
 *    所以这里**扫全部 dist 的 .js**。只查 home 那个包的话，
 *    某次分包调整后这条会变成假红 —— 而假红会让人把门禁删掉。
 */
const RECEIPT_COVER_RE = /^product-receipt-collage-reference(\.[a-z0-9]+)?\.(jpe?g|png|webp)$/i
const receiptCoverFile = emittedAssets.find((file) => RECEIPT_COVER_RE.test(file)) ?? null
const receiptBuf = receiptCoverFile ? readFileSync(join(DIST, 'assets', receiptCoverFile)) : null
const receiptSize = receiptBuf ? imageSize(receiptBuf) : null

must(
  '「收据拼贴」封面已 emit 且是真实图片',
  Boolean(receiptBuf) && receiptSize !== null && receiptBuf.length > 20 * 1024,
  receiptCoverFile === null
    ? 'dist/assets 里找不到 product-receipt-collage-reference.* —— ' +
      '这个模板卡会是一张空白卡。\n' +
      '      查：src/data/prompt-templates.ts 里 receipt-collage 的 cover 有没有 import。'
    : receiptSize === null
      ? `${receiptCoverFile} 的图片头解析不出来 —— 扩展名像图片，内容不是。`
      : `图只有 ${(receiptBuf.length / 1024).toFixed(1)} KB，小得不像封面。`
)

/** 扫全部 dist 的 .js，返回提到过 needle 的文件（用来证明图**真的被用到**） */
function anyJsMentions(needle) {
  return allJsFiles().filter((p) => readFileSync(p, 'utf8').includes(needle))
}

const receiptRefs = receiptCoverFile ? anyJsMentions(`assets/${receiptCoverFile}`) : []

must(
  '「收据拼贴」封面真的被代码引用',
  receiptRefs.length > 0,
  receiptCoverFile
    ? `dist 的所有 .js 里都没有 assets/${receiptCoverFile} 的引用 —— ` +
      '图在包里有，但没有任何地方用它。\n' +
      '      常见成因：receipt-collage 的 cover 被删了、或 import 名改了却没改用法。'
    : '没有可核对的封面文件名（上一条已报）。'
)

must(
  '「收据拼贴」封面体积合理（< 400KB）',
  Boolean(receiptBuf) && receiptBuf.length < 400 * 1024,
  `封面有 ${receiptBuf ? (receiptBuf.length / 1024).toFixed(0) : '?'} KB。\n` +
    '      主包上限 2MB，一张封面不该吃掉超过 1/5。\n' +
    '      改图请重跑 _tools/make-receipt-collage-cover.py，别手工替换。'
)

const receiptAR = receiptSize ? receiptSize.w / receiptSize.h : null

must(
  '「收据拼贴」封面纵横比 = 轮播卡纵横比',
  receiptAR !== null && hdCardAR !== null && Math.abs(receiptAR - hdCardAR) / hdCardAR < 0.005,
  receiptAR === null
    ? '没有可核对的封面尺寸（上面几条已报）。'
    : hdCardAR === null
      ? '产物 CSS 里读不出 .hd-card 的 width/height（上面那条已报）。'
      : `封面 ar=${receiptAR.toFixed(4)}，卡片 ar=${hdCardAR.toFixed(4)}（${hdW}x${hdH}）` +
        '—— 差得超过 0.5%。\n' +
        '      这张封面**刻意**做成 2:3 就是为了在轮播里零裁切，' +
        '别把它「统一」成兄弟模板的 3:4。\n' +
        '      改法：重跑 python _tools/make-receipt-collage-cover.py。'
)


/* ---------------- 首页「快速创作」的参考图入口（2026-09-26） ----------------
 *
 * 王的原话：「在快速创作哪里左下角增加一个+号，点击上传单靠图，
 *           不要下下一步添加，开始按钮改成生成按钮」
 *
 * 源码级断言在 scripts/test-creator-ui.mjs（入口、交棒、隐私弹窗、× 不冒泡）。
 * 这里补的是**产物级**那一段 —— 源码对了、产物没带上，功能一样不存在，
 * 而构建**不报错**（本项目已经踩过「源码绿、产物丢」）。
 */

/** 新类名必须真的落进产物 CSS，否则 + 号是个**没有样式**的裸 View。 */
const refAddDecls = declsFor(appWxss, 'composer-ref-add')
const refThumbDecls = declsFor(appWxss, 'composer-ref-thumb')

/** 从 declsFor 拼起来的声明串里取某个属性的值（取**最后**一个：CSS 级联后写的赢）。 */
function declValue(decls, prop) {
  const all = [...decls.matchAll(new RegExp(`(?:^|;)${prop}:([^;]+)`, 'g'))]
  return all.length ? all[all.length - 1][1].trim() : null
}
const boxOf = (decls) => [declValue(decls, 'width'), declValue(decls, 'height')]
const addBox = boxOf(refAddDecls)
const thumbBox = boxOf(refThumbDecls)

/**
 * 判据锚**会坏的那个不变量**，不锚某个魔法数字。
 * ⚠️ 别写成 `/min-width/` —— 源码里是 `width: 42px; height: 42px`，
 *    压缩后是 `width:80.15267rpx;height:80.15267rpx`（42px 的 rpx 换算），
 *    根本没有 `min-*`。（第一版就是这么写错的，被这条门禁自己拦下来了。）
 * ⚠️ 也别把 80.15267rpx 写死：那是设计宽度换算出来的，改 Taro designWidth 就变。
 */
must(
  '首页参考图入口两态同尺寸且是方形（+ 号 / 缩略图）',
  Boolean(addBox[0]) &&
    Boolean(thumbBox[0]) &&
    addBox[0] === addBox[1] &&
    thumbBox[0] === thumbBox[1] &&
    addBox[0] === thumbBox[0] &&
    addBox[1] === thumbBox[1],
  `dist/app.wxss 里 .composer-ref-add=${JSON.stringify(addBox)}、` +
    `.composer-ref-thumb=${JSON.stringify(thumbBox)}。\n` +
    '      要的是「两态同宽同高、都是方形」。不等高的后果是**选中/删除那一瞬间\n' +
    '      整张卡片会跳一下**，而且不报错；某一态量不出尺寸，说明它的规则没进产物，\n' +
    '      卡片左下角会塌成一行裸文字。\n' +
    '      查：src/styles/forme.scss 里 .composer-ref-add,.composer-ref-thumb 那条共享规则。'
)

/**
 * 两个状态都必须在**编译后的 JSX** 里 —— 三元被压成单分支时，
 * 源码断言照样绿（源码里两分支都在），但用户永远看不到缩略图。
 */
const addBranch = homeCode.includes('className:"composer-ref-add"')
const thumbBranch = homeCode.includes('className:"composer-ref-thumb"')
must(
  '首页参考图的两个状态都编进了产物',
  addBranch && thumbBranch,
  `dist/pages/home/index.js 里 + 号分支=${addBranch}、缩略图分支=${thumbBranch}。\n` +
    '      两个都在才对：没选图显示 + 号，选了图显示可删可换的缩略图。\n' +
    '      只留一个的话，用户看到的是「加了图没反应」或「删不掉」。'
)

/**
 * ⚠️ 这里**刻意不做**「产物里不许出现『开始』」的负向断言。
 *    实测：首页还有 3 处**合法**的「开始」——
 *    「从一个想法开始」「按你的任务开始」「一句描述开始」。
 *    裸判 `!homeCode.includes(escapeUnicode('开始'))` 会**永远红**，
 *    逼下一个人把门禁删掉。精确的那条在 test-creator-ui.mjs（`<Text>开始</Text>`）。
 */

/** 废弃的「参考图留到下一步」提示：王明确要求删掉，别再回来。 */
const deadHint = '可在下一步添加参考图'
const deadHintInHome =
  homeCode.includes(deadHint) || homeCode.includes(escapeUnicode(deadHint))
must(
  '首页不再提示「参考图留到下一步」',
  !deadHintInHome,
  `dist/pages/home/index.js 里又出现了「${deadHint}」。\n` +
    '      这句现在是**错的**：参考图就在快速创作卡上选，没有「下一步添加」这一步。\n' +
    '      王 2026-09-26 原话：「不要下下一步添加」。'
)

/** 死类卫生：删掉提示后 .composer-card-tip / .composer-card-meta 就没人用了。 */
const deadTipCss = /\.composer-card-tip(?![\w-])/.test(appWxss)
const deadMetaCss = /\.composer-card-meta(?![\w-])/.test(appWxss)
const deadTipJs = homeCode.includes('composer-card-tip')
const deadMetaJs = homeCode.includes('composer-card-meta')
should(
  '首页「快速创作」的废弃类名保持清除（CSS 与 JS 都无）',
  !deadTipCss && !deadMetaCss && !deadTipJs && !deadMetaJs,
  `产物里又出现废弃类名（CSS: tip=${deadTipCss} meta=${deadMetaCss} / ` +
    `JS: tip=${deadTipJs} meta=${deadMetaJs}）。\n` +
    '      .composer-card-tip 是「参考图留到下一步」那行提示的样式，\n' +
    '      .composer-card-meta 是右上角「生成 1 张」的样式 —— 两者 2026-09-26 都已删。\n' +
    '      真要用回来，把这条和 test-creator-ui.mjs 的负向断言一起改。'
)

/**
 * 隐私弹窗的**结构代理**。
 * ------------------------------------------------------------------
 * ⚠️ 为什么不能直接判 `homeCode.includes('PrivacyGate')`：
 *    PrivacyGate 的模板编译进 **common.js**（实测 common.js 里 `privacy` 命中 11 次，
 *    home bundle 里 0 次），标识符本身也被压缩器改掉。
 *    ⇒ 在 home bundle 里找它**永远找不到**，那样写是一条**假门禁**（永远红）。
 *
 * 判据改成结构：**渲染序列的最后一个元素**必须是
 * 「同一个模块导出、且**不接任何 props**」的组件 —— 这正是 `<PrivacyGate />`。
 * 编译后实测形状（2026-09-27）：
 *   …(0,N.jsx)(h.EY,{className:"workflow-hint",…})]},e.label)})})]}),(0,N.jsx)(u.CU,{})]})}
 *                                                                    ↑ 序列最后一个 = PrivacyGate
 * 删掉 `<PrivacyGate />` ⇒ 这个形状立刻消失。
 *
 * ⚠️ **2026-09-27 重新锚过一次。** 原判据用「紧挨着 BottomNav（`{active:"create"}`）的
 *    前一个元素」来定位序列末尾。首页按王的决定撤掉底导后，
 *    `active:` 在首页 bundle 里出现 **0 次** ⇒ 那条判据会**永远红**。
 *    （而永远红的假门禁比没有更坏 —— 下一个人会直接把它删掉。）
 *    定位器换成「文件里最后一个 `jsx)(`」：Page 注册代码排在它之后且不含 jsx 调用，
 *    所以「最后一个」就是渲染序列的末尾。实测位置 6938 / 总长 7257，其后 70 字符是
 *    `jsx)(u.CU,{})]})}var A={navigationBarTitleText:"Pixel Box"…`。
 *
 * 这条是**代理**，不是证明：它拦得住「整块被删」，拦不住「挂到别处去了」。
 * 源码级那条（test-creator-ui.mjs 的 `/<PrivacyGate\s*\/>/`）才是主判据。
 */
const lastJsxAt = homeCode.lastIndexOf('jsx)(')
const homeSeqTail = lastJsxAt < 0 ? '' : homeCode.slice(lastJsxAt)
const privacyProxy = /^jsx\)\([\w$]+\.[\w$]+,\{\}\)/.test(homeSeqTail)
must(
  '首页渲染序列的末尾挂着隐私弹窗（wx.chooseMedia 是隐私接口）',
  privacyProxy,
  'dist/pages/home/index.js 的渲染序列里，最后一个元素不再是「无 props 的同模块组件」。\n' +
    '      最可能的成因：`<PrivacyGate />` 被删了，或有人在它后面又加了一个元素。\n' +
    '      取到的序列末尾：' +
    JSON.stringify(homeSeqTail.slice(0, 80)) +
    '\n' +
    '      后果是**静默的**：`wx.chooseMedia` 在未同意隐私协议时会被系统拦下，\n' +
    '      自定义弹窗永远不弹（ensurePrivacyAuthorized 在没有订阅者时直接放行），\n' +
    '      用户点 + 号像是「点了没反应」。'
)


/* ---------------- 首页轮播的海报卡白名单 + 「手机直出」已删除（2026-09-26） ----------------
 *
 * 王的原话：「首页轮播图中有一个手机直出的模板，我没有要求设计这个模板」
 *
 * 查证：轮播 18 张里只有「灵感复刻」「食感成字」是他要求过的；另外 5 张
 * （纸域微景 / 浅景分离 / 俯拍平铺 / 手机直出 / 异变主体）查不到任何要求记录。
 *
 * 🔴 根因：`posterCards` 曾经是 `posterDirections.map(...)` 全量并入，
 *    靠 `CARDS` 末尾 `.filter(card => !/^https?:/.test(card.cover))` 收口 ——
 *    那条 filter 的实际效果是「**封面是本地图的海报方向才进轮播**」。
 *    16 个方向里恰好 6 个用本地图 ⇒ 这 6 个自动上了首页。
 *    **首页展示什么，被「封面图存在哪儿」这个打包细节决定了。**
 */

/**
 * 判据锚**编译后的形状**，不锚某张卡的名字。
 * 实测产物（minify 后）：
 *   g=["food-type"],k=p.W1.filter(function(e){return g.includes(e.id)}).map(function(e){…})
 *                    ↑ 白名单数组              ↑ 经 includes 过滤后才 map
 *
 * ⚠️ 别锚 `p.W1` / `g` / `k` 这些标识符 —— 它们是压缩器产物，改个版本就变。
 *    锚的是「先 filter(includes(id)) 再 map」这个**结构**。
 */
const carouselAllowlistFilter = /\.filter\(function\(\w+\)\{return \w+\.includes\(\w+\.id\)\}\)\.map\(/.test(
  homeCode
)
const carouselAllowlistLiteral = /\[["']food-type["']\]/.test(homeCode)
must(
  '首页轮播的海报卡经「白名单过滤」而非「全量并入」',
  carouselAllowlistFilter && carouselAllowlistLiteral,
  `dist/pages/home/index.js 里：白名单过滤形状=${carouselAllowlistFilter}、` +
    `白名单字面量 ["food-type"]=${carouselAllowlistLiteral}。\n` +
    '      退回 `posterDirections.map(...)` 全量并入的话，**任何新增的海报方向都会\n' +
    '      自己冒到首页上**，而且不报错 —— 这正是王 2026-09-26 指出的问题。\n' +
    '      查：src/pages/home/index.tsx 的 `CAROUSEL_POSTER_IDS`。'
)

/**
 * 「手机直出」必须从**整个产物**里消失（id、名称、封面都算）。
 * ⚠️ 扫全 dist 而不是只扫首页 bundle：这个方向是从模板表里整个删掉的，
 *    任何角落残留都说明删得不干净（模板表编译进 `common.js`）。
 */
const phoneCandidLeftovers = []
const distFiles = []
const collectDist = (dir) => {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) collectDist(p)
    else if (/\.(js|wxss|json|wxml)$/.test(entry.name)) distFiles.push(p)
  }
}
collectDist(DIST)
for (const p of distFiles) {
  const t = readFileSync(p, 'utf8')
  if (t.includes('phone-candid') || t.includes(escapeUnicode('手机直出'))) {
    phoneCandidLeftovers.push(p.slice(DIST.length + 1))
  }
}
must(
  '「手机直出」已从整个产物里清除',
  phoneCandidLeftovers.length === 0,
  `这些产物文件里还有「手机直出」的痕迹：${phoneCandidLeftovers.join(', ')}\n` +
    '      该方向（`phone-candid`）2026-09-26 已整个删除（16 → 15 个海报方向）。\n' +
    '      删干净要**同时**改：\n' +
    '        · forme-taro/src/data/prompt-templates.ts（条目 + import + 封面文件）\n' +
    '        · work/visual-studio/src/prompt-templates.ts（镜像）\n' +
    '        · forme-server/scripts/jev-probe.mjs（镜像）\n' +
    '        · scripts/check-poster-directions.mjs（POSTER_IDS + LOCAL_COVERS）'
)

/** 封面文件也不该再被打包（否则白删，白占 112 KB）。 */
const candidCoverFiles = emittedAssets.filter((f) => /^poster-phone-candid\b/.test(f))
must(
  '「手机直出」的封面不再打包进主包',
  candidCoverFiles.length === 0,
  `dist/assets 里还有 ${candidCoverFiles.join(', ')} —— 那张图 112.3 KB。\n` +
    '      成因：`prompt-templates.ts` 里还留着它的 `import`（只要 import 在，图就会被 emit，\n' +
    '      哪怕没人用）。删 import 才能真的省下这 112 KB。'
)


/* ---------------- 「新功能」那块确实没了 ---------------- */

/**
 * 2026-09-25 王要求把首页下方的「新功能」三个模板整块删掉。
 * 这是一条**负向**断言，作用只有一个：**它要是被加回来，你得知道**。
 *
 * ⚠️ 用 should（提醒）而不是 must（阻断）：加回来本身不会让 App 崩，
 *    而且真加回来时该改的是这条 + `scripts/test-creator-ui.mjs` 里那组负向断言，
 *    不是绕开它。留着 must 只会逼人把门禁删掉。
 *
 * ⚠️ 判据锚**选择器/属性写法**，不数裸子串 ——
 *    `forme.scss` 与 `home/index.tsx` 里都留了**墓碑注释**，
 *    注释里特意写了 `.home-features` / `.home-feature-rail` 这些名字。
 *    裸 `includes('home-features')` 会被自己的注释命中而**假红**。
 */
const railCssBack = /\.home-features\s*\{/.test(appWxss)
const railJsxBack = /["']home-features["']/.test(homeCode)
should(
  /* ⚠️ 断言名写**期望的状态**（和本文件其它 should 一致），
     失败时那行会以 ⚠️ 开头 —— 所以名字不能写成「没有…」，
     否则读起来像「警告：它不见了」。 */
  '首页「新功能」块保持删除（2026-09-25 王确认）',
  !railCssBack && !railJsxBack,
  `产物里又出现了「新功能」集中展示（CSS=${railCssBack} JS=${railJsxBack}）——\n` +
    '      那块 2026-09-25 被王要求删掉了（原话：「删除页面下方的新功能三个模板，\n' +
    '      只把灵感复刻放在首页最上方里」）。\n' +
    '      如果是故意加回来的，把这条和 scripts/test-creator-ui.mjs 里那组负向断言一起改掉。'
)


/* ---------------- 主包体积 ----------------
 *
 * 微信小程序**主包上限 2MB**；本项目没有分包配置 ⇒ `dist/` 整个就是主包。
 * 2026-09-23 实测 **1,801,746 B = 1.718 MB，只剩 288.5 KB 余量** —— 这不是理论风险：
 * 封面与参考图全是**本地打包**的（单张 10~115 KB），再加几张就顶到上限，
 * 而**超限时 `taro build` 照样成功**（本地不校验包大小），要到微信后台上传那一刻
 * 才失败 —— 又是一次「沉默的失败」。
 *
 * ⚠️ 分两档、不直接卡 2.00 MB：卡在上限时你**已经没有腾挪空间**了。
 *    1.90 MB 起提醒（该去压图），1.95 MB 起阻断。两档之间大约还能塞一张 115KB 的封面。
 *
 * ⚠️ 别把这条改回「只在构建时由 Taro 检查」—— Taro 根本不查包体积。
 */
const mainPackageBytes = (() => {
  let total = 0
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.isFile()) total += statSync(p).size
    }
  }
  if (existsSync(DIST)) walk(DIST)
  return total
})()

const asMb = (bytes) => `${(bytes / 1024 / 1024).toFixed(3)} MB`

should(
  `主包体积仍留有余量（${asMb(mainPackageBytes)} < 1.90 MB）`,
  mainPackageBytes < 1.9 * 1024 * 1024,
  `dist 已经 ${asMb(mainPackageBytes)}，距微信 2MB 主包上限只剩 ` +
    `${((2 * 1024 * 1024 - mainPackageBytes) / 1024).toFixed(0)} KB。\n` +
    '      再加一两张本地封面就会超限。压图走生成脚本' +
    '（_tools/make-*.py 已把小程序侧压到 640 宽 / q80），别手工塞大图进来。'
)

must(
  '主包体积未超限（< 1.95 MB）',
  mainPackageBytes < 1.95 * 1024 * 1024,
  `dist 已经 ${asMb(mainPackageBytes)}，微信主包上限是 2MB。\n` +
    '      ⚠️ 超限时 `taro build` **不会报错** —— 要到微信后台上传那一刻才失败。\n' +
    '      先看谁最大：find dist -type f -printf "%s\\t%p\\n" | sort -rn | head\n' +
    '      修法：把最大的那几张 assets 重新压小，或把功能挪进分包。'
)

/* ---------------- （已删除）展示卡「下沿遮罩」够不够黑 ----------------
 *
 * 这里原来有一条门禁：`.home-feature-veil` 的渐变在文字块上沿处必须 ≥ 0.50 黑，
 * 因为白字压在浅色图上读不出来。2026-09-25「新功能」整块删除时，它随主体一起删了。
 * （declsFor / pickLast 两个辅助函数**留了下来** —— 下面 .generate-cta 那条还在用。）
 *
 * ✅ **2026-09-26 已修**（王批准）：`.hd-card-veil` 加了中段停靠点
 *    `rgba(0,0,0,0.72) → rgba(0,0,0,0.55) 30% → rgba(0,0,0,0)`，
 *    文字墨迹上沿（距底 27px，t=0.28125）处 alpha = **0.5606 ≥ 0.533**。
 *
 *    ⚠️ 修之前的状态（留档，别再退回去）：两点渐变 `0.62 → 0`，
 *       该处 alpha 只有 **0.426**，实测 **18 张轮播卡里 7 张**的白字名字
 *       过不了 AA 4.5:1：
 *         poster-overhead-flatlay   36.3% 的墨迹像素低于 4.5:1
 *         poster-phone-candid       28.7%   ← 2026-09-26 该方向已删除，此行是当时快照
 *         avatar-capsule-eye        18.4%
 *         product-receipt-collage   16.3%
 *         poster-paper-field        14.8%
 *         product-tennis-bag         6.9%
 *         avatar-soft-ip-mascot      5.2%
 *       修之后 **18/18 全部过 AA**，最低 5.38:1。
 *
 *    ⚠️ 复算用 `_diag/name-ink-contrast.py`（**按真实墨迹像素**）。
 *       别用 `_diag/contrast-carousel-cards.py` 的旧版口径 —— 它把「行高盒」
 *       （距底 12..48px、高 36px）当成文字区，而 15px 的字墨迹只占 12..27px，
 *       上方那 20 多 px 是空的、又正好是渐变最淡处 ⇒ **数字被系统性夸大**
 *       （同一张新封面：行高盒口径 65.6%，墨迹口径 16.3%）。
 *       它还有一个更早的漏洞：正则只匹配 `^(cover|poster)-`，
 *       **把全部 product- / avatar- 封面漏掉了**（18 张里有 11 张）。
 *       两个坑都已在脚本里注明并修好。

/* ---------------- 轮播卡白字可读性：veil 渐变必须够黑 ----------------
 *
 * 这是一条**从真实缺陷里长出来的**判据（2026-09-26）。
 *
 * 背景：`.hd-card-veil` 原来是两点渐变（rgba(0,0,0,0.62) → 0，高 96px）。
 * 卡片名字是白字 15px / bottom 12px，墨迹上沿距底 27px ⇒ t = 27/96 = 0.28125，
 * 该处 alpha 只有 0.426。纯白底的封面下，白字基本读不出来 ——
 * 实测 18 张轮播卡里 **7 张**过不了 AA 4.5:1。
 * 而编译、typecheck、其它判据**全是绿的**：这是典型「沉默的失败」。
 *
 * 判据怎么算（不猜，从产物 CSS 现读）：
 *   1. 从 `.hd-card-veil` 的产物声明里解出渐变的方向与全部颜色停靠点
 *   2. 从 `.hd-card-name` 解出 bottom 与 font-size（都是 rpx，比例与单位无关）
 *   3. 算 t = (bottom + font-size) / veilHeight 处的 alpha
 *   4. 断言 alpha ≥ 0.533
 *
 * 0.533 的来历：纯白（L=1）上要过 AA 4.5:1 ⇒ 合成后亮度 L_c ≤ 1.05/4.5 - 0.05
 * = 0.18333 ⇒ sRGB 灰度 ≤ 119 ⇒ 255*(1-alpha) ≤ 119 ⇒ alpha ≥ 0.533。
 *
 * ⚠️ 这是**保守**口径：它按「最亮可能底色 = 纯白」算，对任何封面都成立。
 *    真正的逐图测量在 `_diag/name-ink-contrast.py` —— 但那个需要 numpy/Pillow，
 *    门禁不能依赖它们，所以这里只锁「渐变形状」这个充分条件。
 * ⚠️ 它锁不住「构图好不好看」，也不保证每张图都过 AA —— 只保证
 *    「浅底封面上白字不会被渐变本身害死」。这个边界别装作看不见。
 */
function gradientStops(decls) {
  const at = decls.lastIndexOf('linear-gradient(')
  if (at === -1) return null
  const head = 'linear-gradient('.length
  let i = at + head
  let depth = 1
  while (i < decls.length && depth > 0) {
    if (decls[i] === '(') depth += 1
    else if (decls[i] === ')') depth -= 1
    i += 1
  }
  const arg = decls.slice(at + head, i - 1)
  // 方向可省略（默认 to bottom），可能是 "to top" 也可能是 "0deg"
  let body = arg.trim()
  const dirM = /^(?:to\s+(?:top|bottom)|-?[0-9.]+deg)\s*,/i.exec(body)
  if (dirM) body = body.slice(dirM[0].length)
  const stops = []
  // 只在「不处于括号内」的逗号处切分
  for (const part of body.split(/,(?![^(]*\))/)) {
    const m = /rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)/.exec(part)
    if (!m) continue
    const pm = /([0-9.]+)%\s*$/.exec(part.trim())
    stops.push({ a: m[4] === undefined ? 1 : Number(m[4]), p: pm ? Number(pm[1]) / 100 : null })
  }
  if (!stops.length) return null
  // 未写位置的停靠点按 CSS 规则均匀分布
  const n = stops.length
  stops.forEach((s, k) => {
    if (s.p === null) s.p = n === 1 ? 0 : k / (n - 1)
  })
  return stops
}

function alphaAt(stops, t) {
  const st = [...stops].sort((x, y) => x.p - y.p)
  if (t <= st[0].p) return st[0].a
  for (let k = 1; k < st.length; k += 1) {
    const [a0, p0] = [st[k - 1].a, st[k - 1].p]
    const [a1, p1] = [st[k].a, st[k].p]
    if (t <= p1) return p1 === p0 ? a1 : a0 + ((a1 - a0) * (t - p0)) / (p1 - p0)
  }
  return st[st.length - 1].a
}

const veilDecls = declsFor(appWxss, 'hd-card-veil')
const nameDecls = declsFor(appWxss, 'hd-card-name')
const veilH = pickLast(/height:([0-9.]+)rpx/, veilDecls)
const nameBottom = pickLast(/bottom:([0-9.]+)rpx/, nameDecls)
const nameSize = pickLast(/font-size:([0-9.]+)rpx/, nameDecls)
const veilStops = gradientStops(veilDecls)
const inkTop = nameBottom !== null && nameSize !== null ? nameBottom + nameSize : null
const inkT = inkTop !== null && veilH ? inkTop / veilH : null
const inkAlpha = veilStops && inkT !== null ? alphaAt(veilStops, inkT) : null
const AA_ALPHA = 0.533

must(
  '轮播卡白字在文字上沿处足够黑（alpha ≥ 0.533）',
  inkAlpha !== null && inkAlpha >= AA_ALPHA,
  inkAlpha === null
    ? '算不出 .hd-card-veil 的渐变 alpha —— 判据没跑起来，别当成通过。\n' +
      `      veilDecls = ${JSON.stringify(veilDecls).slice(0, 200)}\n` +
      `      nameDecls = ${JSON.stringify(nameDecls).slice(0, 200)}\n` +
      `      解析出的停靠点 = ${JSON.stringify(veilStops)}`
    : `文字墨迹上沿 t=${inkT.toFixed(4)}（距底 ${inkTop}rpx / veil 高 ${veilH}rpx）` +
      `处 alpha = ${inkAlpha.toFixed(4)}，低于 ${AA_ALPHA}。\n` +
      '      纯白底的封面上，白字名字会读不出来 —— 而编译和别的判据全是绿的。\n' +
      '      2026-09-26 修之前就是这样：两点渐变 0.62→0，该处 alpha 只有 0.426，\n' +
      '      18 张轮播卡里 7 张过不了 AA 4.5:1。\n' +
      '      改法：给 .hd-card-veil 留一个非零中段停靠点，例如\n' +
      '        linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0.55) 30%, rgba(0,0,0,0))\n' +
      '      改完复算：python _diag/name-ink-contrast.py'
)

/* ---------------- 浅底上的浅色文字 ---------------- */

/**
 * 「深色皮肤」里最危险的一类静默 bug：**浅底配浅字**。
 * 它不报任何错，页面上那块字**就是看不见**，而 typecheck / 构建 / 其它检查全绿。
 *
 * 2026-09-23 实测抓到一例：`.primary-cta` 的第二条规则写死 `color:#ffffff`，
 * 而它自己 `background: var(--accent)` = `#f5f5f2`（近白）⇒ **1.09:1**，
 * 也就是「生成」按钮（每个创作页的主按钮）的字基本看不见。
 * 全项目其它 5 处 `background: var(--accent)` 都配了 `var(--on-accent)`，只有这一处漏了。
 *
 * 判据（**按复合选择器推理**，不是按单个类名）：
 *   ① 从产物 CSS 找出「主体声明了浅底（相对亮度 > .5）的**复合选择器**」
 *      （`.plan-card.is-selected .plan-radio` 的主体是 `.plan-radio`，
 *       浅底在它身上，`plan-card` 只是祖先）；
 *   ② 任何规则只要**颜色是浅的**，且 主体组合有浅底、或 祖先里有类与浅底类**同元素**
 *      ⇒ 阻断。
 *
 * ⚠️ 第一版按「选择器里出现的所有类」收集浅底类，跑了 **5 条假警报**
 *    （`.plan-card`、`.nav-item.is-active`、`.pill.is-selected` …）——
 *    根因是把 `is-active` / `is-selected` 这类**通用状态类**当成了元素身份，
 *    而它们几乎出现在所有组件上。**假警报会把真问题淹掉**，必须修干净。
 * ⚠️ 已知盲区：跨层级（A 元素包着 B 元素、类名不同）推不出来，只能靠同元素的 className 串。
 */
const pageTokens = (() => {
  const out = {}
  const re = /(?:^|[};])page\{([^{}]*)\}/g
  let m
  while ((m = re.exec(appWxss)) !== null) {
    for (const decl of m[1].split(';')) {
      const i = decl.indexOf(':')
      if (i < 0) continue
      const key = decl.slice(0, i).trim()
      if (key.startsWith('--')) out[key] = decl.slice(i + 1).trim()
    }
  }
  return out
})()

function hexToRgb(value) {
  const s = String(value ?? '').trim()
  let m = /^#([0-9a-f]{3})$/i.exec(s)
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16))
  m = /^#([0-9a-f]{6})$/i.exec(s)
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
  return null
}

function resolveColor(value) {
  const s = String(value ?? '').trim()
  const v = /^var\(\s*(--[\w-]+)\s*\)$/.exec(s)
  return hexToRgb(v ? pageTokens[v[1]] : s)
}

function relLum([r, g, b]) {
  const f = (c) => {
    const x = c / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

const cssRules = [...appWxss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  sel: m[1],
  body: m[2]
}))

/**
 * 把选择器拆成「复合选择器」列表，并给出**主体**（最后一个复合选择器）。
 *
 * 🔴 必须按复合选择器（compound）而不是按单个类名来推理 —— 第一版按「选择器里出现的
 * 所有类」收集浅底类，结果：
 *   · `.plan-card.is-selected .plan-radio{background:var(--lime)}` 把 `plan-card`
 *     和 `is-selected` 也算成浅底 ⇒ `.plan-card{color:#dce2da}` 被误报；
 *   · `is-active` / `is-selected` 这种**通用状态类**被算成浅底后，
 *     `.nav-item.is-active` / `.pill.is-selected` 全被误报（一共 5 条假警报）。
 * CSS 语义：`A B { background }` 里背景在 **B** 上，A 只是祖先。
 * 而 `.a.is-active` 的浅底属于**这个组合**，不属于单独的 `is-active`。
 */
const compoundsOf = (selector) =>
  selector
    .trim()
    .split(/\s*[>+~]\s*|\s+/)
    .filter(Boolean)

const classesIn = (compound) => [...compound.matchAll(/\.([\w-]+)/g)].map((m) => m[1])

const keyOf = (classes) => [...classes].sort().join('|')

// ① 声明了浅底的**复合选择器**（按主体算）
const lightCompounds = new Set()
const lightClasses = new Set()
for (const { sel, body } of cssRules) {
  const bg = /(?:^|;)(?:background|background-color):\s*([^;]+)/.exec(body)
  if (!bg) continue
  const rgb = resolveColor(bg[1])
  if (!rgb || relLum(rgb) <= 0.5) continue
  const parts = compoundsOf(sel)
  const subject = classesIn(parts[parts.length - 1] ?? '')
  if (subject.length === 0) continue
  lightCompounds.add(keyOf(subject))
  for (const c of subject) lightClasses.add(c)
}

// ② 同元素的伙伴关系（从 tsx 的 className 串推）：哪些类会与浅底类出现在同一元素上
const srcDir = 'src'
const tsxFiles = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => join(srcDir, f))

const coOccursWithLight = new Set(lightClasses)
let scannedClassStrings = 0
/**
 * ⚠️ `\{?` 不能省：`className={`primary-cta generate-cta ${…}`}` 这种**模板字面量**写法，
 * `=` 后面先跟 `{` 再跟反引号。第一版正则写成 `=\s*['"`]` ⇒ 这一类**一条都匹配不到**，
 * 于是 `generate-cta` 从没进过伙伴集合，`.generate-cta .cta-cost` 那条分支
 * **静默失效** —— 门禁照样报通过（对抗测试用例 7f 把它抓了出来）。
 * ⇒ 判据自己也会静默降级，所以下面配了一条**扫描自检**。
 */
for (const file of tsxFiles) {
  const code = readFileSync(file, 'utf8')
  for (const m of code.matchAll(/className\s*=\s*\{?\s*['"`]([^'"`]*)['"`]/g)) {
    scannedClassStrings += 1
    const tokens = m[1].split(/\s+/).filter(Boolean)
    if (tokens.some((t) => lightClasses.has(t))) for (const t of tokens) coOccursWithLight.add(t)
  }
}

// 扫描自检：确认「同元素伙伴」这条能力真的在工作，而不是悄悄退化成空集
const partnersBeyondLight = [...coOccursWithLight].filter((c) => !lightClasses.has(c))
must(
  '浅底判据的 className 扫描有效（自检）',
  scannedClassStrings >= 30 && partnersBeyondLight.length > 0,
  `扫描到 ${scannedClassStrings} 条 className、推出 ${partnersBeyondLight.length} 个伙伴类。\n` +
    '      低于预期 ⇒ 扫描正则可能被 JSX 写法（`className={…}` 模板字面量）绕过了，\n' +
    '      那样「祖先类与浅底类同元素」这条分支会**静默失效**（不报错、只是不再拦）。\n' +
    '      检查 scripts/verify-dist.mjs 里那条 className 正则。'
)

// ③ 找浅底上的浅字
const lightOnLight = []
for (const { sel, body } of cssRules) {
  const cm = /(?:^|;)color:\s*([^;]+)/.exec(body)
  if (!cm) continue
  const fg = resolveColor(cm[1])
  if (!fg || relLum(fg) <= 0.5) continue // 深字不管

  const parts = compoundsOf(sel)
  const subject = classesIn(parts[parts.length - 1] ?? '')

  // (a) 主体这个**组合**本身有浅底（如 .asset-filter.is-active）
  if (lightCompounds.has(keyOf(subject))) {
    lightOnLight.push(`${sel.trim()} { color: ${cm[1].trim()} }`)
    continue
  }
  // (b) 祖先里有类与浅底类**同元素**（如 `.generate-cta .cta-cost`：
  //     .generate-cta 与 .primary-cta 在同一元素上 ⇒ .cta-cost 压在浅底上）
  const ancestors = parts.slice(0, -1).flatMap(classesIn)
  if (ancestors.some((c) => coOccursWithLight.has(c))) {
    lightOnLight.push(`${sel.trim()} { color: ${cm[1].trim()} }`)
  }
}

must(
  '浅底上没有浅色文字',
  lightOnLight.length === 0,
  lightOnLight.length === 0
    ? ''
    : `这些规则在浅色底上又用了浅色文字 ⇒ 字会看不见（不报错）：\n` +
      lightOnLight.map((r) => `      · ${r}`).join('\n') +
      '\n      实测过的样子：`.primary-cta` 写死 `color:#ffffff` 压 `--accent`(#f5f5f2)' +
      ' ⇒ **1.09:1**，\n      「生成」按钮（每个创作页的主按钮）的字基本看不见。\n' +
      '      改法：浅底上的文字一律用 `var(--on-accent)` —— 项目里其它 5 处 ' +
      '`background: var(--accent)`\n      都是这么配的，照着改。'
)

/* ---------------- 生成按钮必须是胶囊（2026-09-24 真机验收） ---------------- */

/**
 * 🔴 这条门禁是被一次**真实的静默失效**逼出来的，不是预防性加的。
 *   2026-09-24 王在真机上要求「生成按钮做成苹果风胶囊」。源码里 `.generate-cta`
 *   写了 `border-radius: 999px`，源码级断言（`test:creator-ui`）也绿了 ——
 *   但**胶囊根本没生效**：第 13 节还有一条 `.primary-cta { border-radius: 8px }`，
 *   在文件里更靠后、特异性相同 ⇒ 它赢。产物里 `.generate-cta` 生效的圆角是 **8px**。
 *
 *   抓到它的是 `scripts/measure-page.mjs`（量产物 CSS 的计算值），不是源码断言 ——
 *   因为**源码级断言看不见级联**：它只能证明「文件里出现过 999px」。
 *   ⇒ 所以判据必须钉在**产物**上，而且要取**最后一条** border-radius（后写的赢），
 *     这正是上面 `pickLast()` 存在的理由（同一个选择器在产物里有多处）。
 *
 * 判据：圆角 ≥ 半高就是胶囊（与具体数值无关 —— 999px 换成 200px 也该过）。
 * 已知盲区：只比 `.generate-cta` 自己声明的 min-height。若将来按钮高度改由
 * `padding` 撑起，这里的比值会偏保守（偏严，不会漏报），改的时候一起看。
 */
{
  const ctaDecls = declsFor(appWxss, 'generate-cta')
  const ctaRadius = pickLast(/border-radius:([0-9.]+)rpx/, ctaDecls)
  const ctaHeight = pickLast(/min-height:([0-9.]+)rpx/, ctaDecls)
  must(
    '生成按钮是胶囊（生效的圆角 ≥ 半高）',
    ctaRadius !== null && ctaHeight !== null && ctaRadius >= ctaHeight / 2,
    ctaRadius === null || ctaHeight === null
      ? `算不出来：radius=${ctaRadius} min-height=${ctaHeight}。\n` +
        '      查产物里 `.generate-cta` 的 border-radius / min-height 是不是被删了。'
      : `生效的圆角只有 ${ctaRadius.toFixed(1)}rpx，而按钮高 ${ctaHeight.toFixed(1)}rpx ⇒ ` +
        `圆角要 ≥ ${(ctaHeight / 2).toFixed(1)}rpx 才是胶囊。\n` +
        '      ⚠️ 这多半是**被别的规则盖掉了**，不是没写：\n' +
        '      文件里 `.primary-cta` 声明了两次，第 13 节那条带 `border-radius: 8px` 且更靠后，\n' +
        '      特异性相同 ⇒ 它赢。形状的唯一真源要放在文件末尾那条 `.generate-cta` 里。\n' +
        '      量法：node scripts/measure-page.mjs create-poster（打印计算后的圆角）。'
  )
}

/* ---------------- 环境配置 ---------------- */

must(
  '产物里没有本机地址',
  !/127\.0\.0\.1|localhost/.test(bundle),
  '打包进了本机地址，真机上所有请求都会失败。检查是否误用了 .env.local。'
)

should(
  'API 域名已替换',
  !/YOUR_API_DOMAIN/.test(bundle),
  '.env.production 里还是占位域名。换成已备案的真实域名后重新构建，' +
    '并把四个服务器域名加进小程序后台白名单。'
)

/* ---------------- 远程图片域名 ---------------- */

const duplicatedEnvKeys = duplicateEnvKeys()
should(
  '.env.production 没有重复定义',
  duplicatedEnvKeys.length === 0,
  `这些键定义了不止一次：${duplicatedEnvKeys.join('、')}。\n` +
    '      dotenv 取最后一个，前面那个值永远不会生效 —— 而没人知道是哪个。\n' +
    '      删掉多余的行。这也保证本脚本和构建读到的是同一个值。'
)

/**
 * 已确认加进小程序后台「downloadFile 合法域名」的外部图片域名。
 * ------------------------------------------------------------------
 * 留空表示「不许有外部图片域名」—— 走自有域名（TARO_APP_MEDIA_BASE）
 * 的路线就不需要填这里：自有域名本来就要进四个白名单，白拿。
 *
 * 如果你决定继续用 Unsplash 这类外部图床，把域名填进来，并**确认**
 * 它已加进后台的 downloadFile 合法域名。填进来 = 你为这件事负责了。
 */
const ALLOWLISTED_MEDIA_HOSTS = []

/**
 * 只挑「会被当图片加载」的 URL。
 * ------------------------------------------------------------------
 * 不能简单扫所有域名：产物里还有 taro.com / reactjs.org，那是框架报错
 * 提示里的链接，永远不会被请求。把它们报出来是纯噪音，噪音多了
 * 真问题就被淹没 —— 门禁的可信度就是这么丢掉的。
 */
const IMAGE_URL = /https?:\/\/[a-z0-9.-]+\/[^"'\s)]*?(?:photo-|\.jpe?g|\.png|\.webp|\.avif|\.gif)/gi

const imageHosts = [
  ...new Set(
    [...bundle.matchAll(IMAGE_URL)].map((m) => m[0].replace(/^https?:\/\//, '').split('/')[0].toLowerCase())
  )
]

/**
 * 配了 mediaBase 就等于收口了，哪怕产物里还留着原始 URL 字面量。
 * ------------------------------------------------------------------
 * 这是我第一版的假阳性：`media('https://images.unsplash.com/photo-xxx')`
 * 里的 URL 是**实参字面量**，会被打进包 —— 但 media() 在运行时只取
 * 文件名，拼到 mediaBase 上，那个 URL 永远不会被请求。
 * 只按字面量判断，就会对着一个已经收口好的产物一直报警。
 * 报警永远清不掉 = 噪音 = 门禁失去可信度。
 */
const mediaBase = readEnvProd('TARO_APP_MEDIA_BASE')
const apiHost = hostOf(readEnvProd('TARO_APP_API_BASE'))

const foreignHosts = imageHosts.filter(
  (host) => host !== apiHost && !ALLOWLISTED_MEDIA_HOSTS.includes(host)
)

should(
  '远程图片域名已收口',
  Boolean(mediaBase) || foreignHosts.length === 0,
  `产物会从这些外部域名加载图片：${foreignHosts.join('、')}。\n` +
    '      真机上「downloadFile 合法域名」里没有它们时，封面和预览是**空白** ——\n' +
    '      而开发者工具勾了「不校验合法域名」照样正常显示，看起来像样式 bug。\n' +
    '      两条路选一条：① 配 TARO_APP_MEDIA_BASE 把图片收到自有域名下（推荐）；\n' +
    '      ② 把域名加进后台白名单，然后填进本脚本的 ALLOWLISTED_MEDIA_HOSTS。'
)

/** 从任意 env 文件读一个键，语义与 readEnvProdAll 一致（取最后一个） */
function readEnvFile(file, key) {
  if (!existsSync(file)) return ''
  const pattern = new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*(.*)$`, 'gm')
  const all = [...readFileSync(file, 'utf8').matchAll(pattern)].map((m) =>
    m[1].trim().replace(/^["']|["']$/g, '')
  )
  return all.length ? all[all.length - 1] : ''
}

/* ---------------- mediaBase：env 与产物必须一致 ---------------- */

/**
 * 判据必须和被守护的东西**同源**。
 * ------------------------------------------------------------------
 * 上面那条读的是 `.env.production` 这个**文件**；而运行时用的是**编译进
 * 产物**的值（DefinePlugin 在构建时把 `process.env.TARO_APP_MEDIA_BASE`
 * 换成字面量）。这是两个来源，中间那条缝能藏住一整类坏状态：
 *
 *   · `.env.production` 里键名敲错一个字母（`TARO_APP_MEDIABASE`）
 *   · 代码里写成 `process.env[key]` —— 本项目踩过：编译不报错，产物里是 undefined
 *   · 构建时没读到这份 env（cwd 不对、构建在另一个目录跑的）
 *
 * 这三种情况下产物里 `mediaBase` 都是空串：`media()` 直接返回原型里的
 * Unsplash 地址，真机封面全白 —— 而「远程图片域名已收口」**照样通过**，
 * 因为 env 文件里确实配了。那就是「一个不报警的门禁」。
 *
 * 所以补这一条：**env 声明了什么，产物里就必须是什么。**
 * 反过来也查（env 空但产物有值）= 产物是拿旧配置构建的，同样是坏的。
 */
const ARTIFACT_MEDIA_BASE = (() => {
  // 用 JSON 字符串字面量做锚点：配置字段名是稳定的 ASCII（压缩器不改名），
  // 而中文之类的非 ASCII 在产物里会被转义成 \uXXXX，不适合当锚点。
  const matched = /mediaBase:("(?:[^"\\]|\\.)*")/.exec(bundle)
  if (!matched) return null
  try {
    return JSON.parse(matched[1])
  } catch {
    return null
  }
})()

// Taro 的 dotenv 里 `.env.production.local` 覆盖同名键，两个文件都要看 ——
// 只看 `.env.production` 会对「用 .local 覆盖」的正当用法误报。
const declaredMediaBases = [
  readEnvProd('TARO_APP_MEDIA_BASE'),
  readEnvFile('.env.production.local', 'TARO_APP_MEDIA_BASE')
].filter(Boolean)

must(
  '封面域名与产物一致',
  ARTIFACT_MEDIA_BASE !== null &&
    (declaredMediaBases.length
      ? declaredMediaBases.includes(ARTIFACT_MEDIA_BASE)
      : ARTIFACT_MEDIA_BASE === ''),
  ARTIFACT_MEDIA_BASE === null
    ? '产物里找不到 mediaBase 字段 —— 这个检查是瞎的，别把它当成通过。\n' +
      '      可能是 src/config/index.ts 里改了字段名，或整个配置对象被摇掉了。'
    : declaredMediaBases.length
      ? `env 声明了 ${declaredMediaBases.join(' / ')}，但产物里编译进去的是 ` +
        `"${ARTIFACT_MEDIA_BASE}"。\n` +
        '      运行时用的是**产物里**的值：空的话 `media()` 会直接返回原型里的 Unsplash 地址，\n' +
        '      真机封面全白 —— 而「远程图片域名已收口」只看 env 文件，照样是绿的。\n' +
        '      常见成因：键名敲错、代码里写成 `process.env[key]`（动态取值编译不报错）、\n' +
        '      构建时没读到这份 .env.production。重新构建后重跑本脚本。'
      : `env 里没有 TARO_APP_MEDIA_BASE，产物里却是 "${ARTIFACT_MEDIA_BASE}"。\n` +
        '      产物是拿**旧配置**构建的（env 改了但没重新 build）。重跑 npm run build:weapp。'
)

/* ---------------- 入场动效不得夺走固定定位的包含块（2026-09-27 实测） ----------------
 *
 * 踩的坑：`.page-enter` 挂在**页面根** `.app-screen` 上，而 `.bottom-nav` /
 * `.generate-dock` / `.privacy-mask` 都是 `position: fixed` 且是它的后代。
 *
 * CSS Transforms 规范：祖先的 transform 只要不是 `none`，就成为 fixed 后代的
 * **包含块**。原写法 `animation: pageEnter 200ms … both` 的 `to` 关键帧是
 * `transform: translateY(0)`，`fill-mode: both` 把它**永久**留在根节点上
 * （实测计算值 `matrix(1, 0, 0, 1, 0, 0)`），于是底导与生成条被钉在**内容底部**
 * 而不是屏幕底部 —— 实测滚 0 时 `.bottom-nav` 在视口 y=1279（视口仅 844），
 * 首屏完全看不见，而**当时 60 条产物门禁全绿**。
 *
 * ⇒ 这里把「入场关键帧不许含 transform」钉死，并顺手证明三个固定元素还在。
 *
 * ⚠️ 判据只针对 `pageEnter`，**绝不能写成「所有关键帧都不许有 transform」**：
 *    `spin` 就是靠 transform 转的（它挂在 `.spinner` 这种小元素上，不构成包含块）。
 *    写成通用规则会变成假红，而假红会让人把门禁删掉。
 */

/** 取关键帧体（按花括号配平，不依赖「后面紧跟着什么」—— 压缩器换序也不会失准）。 */
function keyframesBody(css, name) {
  const start = css.search(new RegExp(`@keyframes\\s+${name}\\s*\\{`))
  if (start < 0) return null
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  return null
}

const pageEnterBody = keyframesBody(appWxss, 'pageEnter')
must(
  '入场关键帧 pageEnter 不含 transform',
  pageEnterBody !== null && !/transform/.test(pageEnterBody),
  pageEnterBody === null
    ? '产物 app.wxss 里找不到 `@keyframes pageEnter` —— 入场动效整个丢了，或关键帧被改名。\n' +
      '      查：src/styles/forme.scss 第 0 节。'
    : '`@keyframes pageEnter` 里出现了 transform。\n' +
      `      取到的关键帧体：${pageEnterBody.slice(0, 160)}\n` +
      '      `.page-enter` 挂在页面根 `.app-screen` 上；根节点一旦带 transform，\n' +
      '      `position: fixed` 的后代（.bottom-nav / .generate-dock / .privacy-mask）\n' +
      '      就**失去视口包含块**，被钉到内容底部 ⇒ 首屏看不见底导与生成按钮，\n' +
      '      而其余门禁照样全绿（2026-09-27 实际发生过）。\n' +
      '      改法：入场只做 opacity；上浮放到内层内容包装元素上。'
)

/* 上一条的结论依赖「这三个元素仍是 fixed、仍是 .app-screen 的后代」。
   哪天它们改成 sticky/absolute，包含块的前提就换了 —— 这条会先红，逼人重看。 */
const FIXED_IN_VIEWPORT = ['bottom-nav', 'generate-dock', 'privacy-mask']
const noLongerFixed = FIXED_IN_VIEWPORT.filter(
  (cls) => !/position:\s*fixed/.test(declsFor(appWxss, cls))
)
must(
  '三个固定定位元素仍是 position:fixed',
  noLongerFixed.length === 0,
  `产物里这几个类不再是 position:fixed：${noLongerFixed.join(' / ')}。\n` +
    '      不一定是错，但「入场关键帧不许带 transform」这条断言的前提变了 ——\n' +
    '      重新确认固定元素与 .app-screen 的祖先关系，再更新这里的清单。'
)

/* 动效的**存在性**：这次「动效零门禁」是问题的另一半 ——
   删光了也没有任何一条断言会红。 */
const MOTION_KEYFRAMES = ['pageEnter', 'pulse', 'spin']
const missingKf = MOTION_KEYFRAMES.filter((name) => keyframesBody(appWxss, name) === null)
must(
  '入场 / 骨架 / 加载三个关键帧都在产物里',
  missingKf.length === 0,
  `产物 app.wxss 里缺关键帧：${missingKf.join(' / ')}。\n` +
    '      查：src/styles/forme.scss 第 0 节。'
)

must(
  'prefers-reduced-motion 降级仍在产物里',
  /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/.test(appWxss),
  '产物 app.wxss 里找不到 prefers-reduced-motion 媒体查询 ——\n' +
    '      系统开了「减弱动态效果」的用户会继续看到动画。'
)

/* 骨架屏「真被用上」（2026-09-27，P1-2）。
 *
 * 上面那条 `MOTION_KEYFRAMES` 只保证 `@keyframes pulse` **存在** —— 存在 ≠ 被用。
 * 实测：`.skeleton-pulse` 定义了、关键帧也在产物里，但**0 个页面引用它**，
 * 动画永远不跑，而所有门禁照样全绿。这条把「存在」升级成「被页面引用」。
 *
 * ⚠️ 类名字符串要查**页面 bundle**（`dist/pages/assets/index.js`）——
 *    `app.wxss` 里只有样式规则，从它看不出「谁在用它」。
 *    这和 §「组件编译进 common.js」是同一类陷阱的两个方向。 */
must(
  '骨架屏 skeleton-pulse 被资产库页面真的引用',
  assetsPage.includes('skeleton-pulse') && declsFor(appWxss, 'skeleton-pulse').length > 0,
  assetsPage.includes('skeleton-pulse')
    ? 'app.wxss 里找不到 `.skeleton-pulse` 的样式规则 ——\n' +
      '      占位块会是静止的灰块（不报错，只是没有呼吸感）。'
    : 'dist/pages/assets/index.js 里找不到 skeleton-pulse。\n' +
      '      `@keyframes pulse` 还在产物里（上一条只查存在性），但没有任何页面用它 ⇒\n' +
      '      动画永远不跑，而所有门禁照样全绿。\n' +
      '      查：src/pages/assets/index.tsx 的骨架屏分支。'
)

must(
  '旧的文字加载态 asset-loading 已从产物消失',
  !appWxss.includes('asset-loading') && !assetsPage.includes('asset-loading'),
  '产物里还有 asset-loading（资产库应已改用骨架屏）。\n' +
    '      注意 TSX 与 SCSS 两处都要清 —— 只清一处时另一处会静默留着。'
)

/* ---------------- 灵感复刻：三层卡结构（2026-09-27，P1-1） ----------------
 *
 * 源码级门禁（`test-creator-ui.mjs`）守着「同构」「法务声明在两张卡之外」
 * 「两个上传槽的文案逐项不同」。这里守的是**产物里真的这么长** ——
 * 源码写了不等于打进了包。
 *
 * ⚠️ 判据锚**类名字面量**，不锚裸子串：这一页的 TSX 注释里故意写着
 *    `composer-block` / `form-heading` 说明历史（铁律 #11④）。
 *    Taro 编译会去掉注释，所以产物里不会命中注释 —— 但仍锚「本页自己写的类名」。
 * ⚠️ 组件编译进 common.js（铁律 #11②）：`UploadSlot` / `OptionPills` /
 *    `PromptField` 这些在页面分块里找不到，所以只查本页独有的类。
 */
const REFERENCE_PAGE = join(DIST, 'pages/create-reference/index.js')
const referencePage = existsSync(REFERENCE_PAGE) ? readFileSync(REFERENCE_PAGE, 'utf8') : ''

must(
  '灵感复刻的页头缩略图进了产物（复用首页那张封面）',
  hasClassLiteral(referencePage, 'composer-page-thumb-img') &&
    coverModuleId !== null &&
    new RegExp(`\\w\\(${coverModuleId}\\)`).test(referencePage),
  hasClassLiteral(referencePage, 'composer-page-thumb-img')
    ? `dist/pages/create-reference/index.js 里没有引用导出 ${coverFile} 的模块` +
      `（id ${coverModuleId ?? '找不到'}）。\n` +
      '      页头缩略图会是一张空图 —— 不报错，只是空白。'
    : 'dist/pages/create-reference/index.js 里找不到 composer-page-thumb-img。\n' +
      '      页头缩略图（96×96 小方图 + 标题那一支）没了。'
)

must(
  '灵感复刻的旧平铺块结构已从产物消失',
  !hasClassLiteral(referencePage, 'composer-block') && !hasClassLiteral(referencePage, 'form-heading'),
  'dist/pages/create-reference/index.js 里还有 composer-block / form-heading。\n' +
    '      这一页 2026-09-27 已改成三层卡结构（input-card + settings-card）。\n' +
    '      ⚠️ 别改回去：`.composer-block` 的 25px `.h2` 标题和页头 27px 标题\n' +
    '      视觉上同级，正是「两套标题系统」的来源。\n' +
    '      ⚠️ 判据用 `hasClassLiteral` —— `composer-block-note` / `composer-blocker`\n' +
    '      都包含 `composer-block`，裸子串匹配会假红。'
)

must(
  '灵感复刻的三层结构在产物里都在',
  ['input-card', 'settings-card', 'upload-grid', 'settings-note', 'recreate-rights'].every((cls) =>
    hasClassLiteral(referencePage, cls)
  ),
  'dist/pages/create-reference/index.js 里缺三层结构的一部分：\n' +
    ['input-card', 'settings-card', 'upload-grid', 'settings-note', 'recreate-rights']
      .map((cls) => `      ${cls}=${hasClassLiteral(referencePage, cls)}`)
      .join('\n')
)

must(
  '灵感复刻的法务声明与勾选控件都在产物里',
  hasClassLiteral(referencePage, 'recreate-rights-label') &&
    hasClassLiteral(referencePage, 'recreate-rights-box') &&
    declsFor(appWxss, 'recreate-rights').length > 0 &&
    declsFor(appWxss, 'recreate-rights-box').length > 0,
  '产物里缺法务声明的一部分：\n' +
    '      `recreate-rights-label`（可见文字标签 —— 读屏用户靠它知道在确认什么）/ ' +
    '`recreate-rights-box`（勾选框），\n' +
    '      或它们在 app.wxss 里的样式。'
)

/* ---------------- 输出 ---------------- */

const line = '─'.repeat(56)
console.log(`\n上传前产物校验\n${line}`)

if (reminders.length) {
  for (const item of reminders) {
    console.log(`  ⚠️  ${item.name}`)
    console.log(`      ${item.hint}`)
  }
}

if (blockers.length) {
  for (const item of blockers) {
    console.log(`  ❌ ${item.name}`)
    console.log(`      ${item.hint}`)
  }
}

/**
 * ⚠️ 这里必须把**提醒项也减掉**（2026-09-22 修）。
 * 原来写的是 `declared - blockers.length` —— 于是「33 项通过 · 1 项提醒」里的
 * 那 1 项提醒被**同时算进了「通过」**（提醒的定义就是「这一项没通过，但不拦你」）。
 * 数字虚高一项，而且虚高的正是最该被看见的那一类。
 * 门禁的报数一旦不准，后面所有「全绿」的判断都建立在一个假数上。
 */
const passed = declared - blockers.length - reminders.length
console.log(line)
console.log(`  ${passed} 项通过 · ${reminders.length} 项提醒 · ${blockers.length} 项阻断\n`)

if (blockers.length) {
  console.log('❌ 产物有问题，不要上传。修掉上面的「阻断」项后重跑。\n')
  process.exit(1)
}

if (reminders.length) {
  console.log('⚠️  产物本身没问题，但上线前还有未完成的配置项（见上）。\n')
  process.exit(0)
}

console.log('✅ 产物校验全部通过，可以上传。\n')
