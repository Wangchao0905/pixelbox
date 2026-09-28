import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { APP_NAV_ITEMS } from '../src/data/app-nav.ts'
import { assetMatchesFilter, toggleSettings } from '../src/services/create-ui.ts'
import { setReferenceDraft, takeReferenceDraft } from '../src/services/reference-images.ts'

assert.deepEqual(
  APP_NAV_ITEMS.map((item) => item.key),
  ['create', 'assets'],
  'primary navigation only contains implemented destinations'
)

assert.equal(toggleSettings(false), true, 'advanced settings can open from their default collapsed state')
assert.equal(toggleSettings(true), false, 'advanced settings can close again')

/**
 * 生成按钮（2026-09-24 真机验收后改）
 * ------------------------------------------------------------------
 * 王在真机上提的第一条：**苹果风胶囊、缩短长度、按钮上只显示「生成」、字体居中**。
 * 原来按钮里塞了三样东西 —— `✦` + `生成 N 张` + `✦ N` —— 而这三样在按钮上方
 * 那一行（`.dock-meta`）已经各有一份。这里守的是那个「只」：
 *   ① 按钮里**只有一处文本**。多塞一个 `<Text>` 不报错、不崩、typecheck 全过，
 *      截图上只是「字变小了」—— 所以只能靠门禁钉住；
 *   ② 文案只有「生成」与加载态的「生成中…」两种（「为什么不能点」由 `hint` 承担，
 *      不往按钮里塞状态文案）；
 *   ③ 单价 / 张数不许回来（`cta-cost` 类名已删，`count` prop 已删）。
 * `generationButtonLabel()` 随之从 `services/create-ui.ts` 删掉 —— 它唯一的
 * 消费者就是那句文案；留着就是一个没人用的导出。
 */
const dockComponent = readFileSync(new URL('../src/components/GenerateDock.tsx', import.meta.url), 'utf8')
const cta = dockComponent.match(/className=\{`primary-cta generate-cta[\s\S]*?<\/View>/)?.[0] ?? ''
assert.ok(cta, 'the dock must render the primary CTA')
assert.equal((cta.match(/<Text/g) ?? []).length, 1, '生成按钮里只该有一处文本（图标/张数/单价都在按钮上方那行）')
assert.match(
  cta,
  /<Text>\{loading \? '生成中…' : '生成'\}<\/Text>/,
  '按钮文案只能是「生成」，加载时是「生成中…」'
)
assert.doesNotMatch(cta, /cta-cost/, '按钮里不许再印单价')
assert.doesNotMatch(dockComponent, /^\s*count\??:/m, 'count prop 已删：张数不再由按钮表达')

const styles = readFileSync(new URL('../src/styles/forme.scss', import.meta.url), 'utf8')

/**
 * 断言必须打在**生效的 CSS** 上，不能打在注释文本上。
 * 踩过一次：§15 的墓碑注释里为了说明历史，写了
 * `@media (prefers-color-scheme: light)` 这个字面量，
 * 于是「不许再有主题媒体查询」这条断言被**注释**触发 —— 假阳性。
 * （反过来也危险：注释里出现 #f5f7f4 会让「旧色不许回来」假阳性。）
 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const css = stripComments(styles)

/**
 * ⚠️ 这条断言的历史，别把它改回去（除非你真的重新加了浅色变体）：
 *   ① 最初写成 `page { ... --accent-soft: #e6f3df ... background: #f5f7f4 ... }`，
 *      用 `[\s\S]*?` 跨块匹配 —— 它守的不是「同一个块里有这三个值」，
 *      而是「文件里先后出现过这三个值」，**因为错误的原因而通过**。
 *   ② 后来锚定到媒体查询块内部，判据才和意图一致。
 *   ③ 2026-09-22 21:2x 王定「深色无条件默认」⇒ 浅色变体整段删除，
 *      于是这条断言**反过来**：要守的是「浅色变体不许再出现」。
 *      留着它，是为了挡住「哪天有人把浅色块粘回来」——
 *      粘回来会连带状态栏白字压浅底那个 bug（见 forme.scss §15 的墓碑注释）。
 */
assert.doesNotMatch(
  css,
  /@media\s*\(prefers-color-scheme/,
  'no theme media query may exist: dark is unconditional, not system-following'
)
assert.doesNotMatch(
  css,
  /#f5f7f4|#173024|#e6f3df|#245b43/,
  'the old cream/green palette must not come back as a token value'
)

// 深色基准必须是**默认**且**唯一**的一套 token
// 2026-09-27：「深空仪器」方向底色从纯黑 #050505 换成冷调深空 #08090B，王已看过效果图确认。断言跟进新值，意图不变。
assert.match(
  css,
  /^page\s*\{[\s\S]*?--bg:\s*#08090B;/m,
  'the dark canvas is the unconditional default token block'
)

const system = readFileSync(new URL('../src/services/system.ts', import.meta.url), 'utf8')
/**
 * ⚠️ 这两条在 2026-09-22 改过一次，因为**断言自己坏了**，不是代码坏了：
 * 原来写的是 /Taro\.getSystemInfoSync\(\)\.statusBarHeight/ —— 锁死了「链式取值」的写法。
 * 后来为了同时拿到 screenWidth（胶囊让位要算 width - rect.left），改成了
 *   `const info = Taro.getSystemInfoSync()` + `info.statusBarHeight`
 * 链式写法消失 ⇒ 这条红了，而代码是对的。
 * 现在只钉「用了这个 API」+「statusBarHeight 确实从它身上取」，
 * 不锁链式还是解构 —— 判据要打在意图上，不是打在某种写法上。
 */
assert.match(system, /Taro\.getSystemInfoSync\(\)/, 'status-bar lookup must use the broadly supported sync API')
assert.match(system, /info\.statusBarHeight/, 'status-bar height must be read off the getSystemInfoSync result')
assert.doesNotMatch(system, /Taro\.getWindowInfo\(/, 'status-bar lookup must not depend on getWindowInfo')

/**
 * 胶囊让位（--capsule-r）的接线，三层一起守，缺一层整条链就断：
 *   ① 服务层算得出来 —— 必须量**真实**胶囊矩形，且对「全 0 矩形」有兜底
 *   ② 首页消费它 —— 首页头像贴右，实测被胶囊压住过
 *   ③ 顶栏消费它 —— 给标题封顶
 * 这里只守源码接线；「真的进了包」由 scripts/verify-dist.mjs 在产物上守。
 */
assert.match(system, /getMenuButtonBoundingClientRect/, 'capsule inset must be measured from the real capsule rect')
assert.match(
  system,
  /CAPSULE_INSET_FALLBACK/,
  'capsule inset must fall back — the API returns an all-zero rect on some devices'
)

const home = readFileSync(new URL('../src/pages/home/index.tsx', import.meta.url), 'utf8')
assert.match(home, /home-composer-card/, 'home should keep a focused composer card')
assert.match(home, /hd-swiper/, 'home should lead with the edge-to-edge card carousel')
assert.match(home, /previousMargin/, 'the carousel must expose neighbouring cards (两侧闪避)')
assert.doesNotMatch(home, /creation-grid/, 'home should not lead with a three-card workflow grid')

/**
 * 2026-09-22 王改方向：点数模块从首页搬到「我的」，原来的横滑轨道由卡片循环取代。
 * 这两条守的就是「搬走了、删掉了」——如果哪天点数药丸又回到首页，这里会红。
 */
assert.doesNotMatch(home, /credit-pill/, 'the credit module must not be on the home page any more')
assert.doesNotMatch(home, /inspiration-strip/, 'the old inspiration rail was replaced by the carousel')
assert.match(home, /pages\/profile\/index/, 'the home avatar must lead into 我的')
assert.match(
  home,
  /capsuleInsetRight/,
  'home must inject the capsule inset — its avatar is right-aligned straight under the capsule'
)

/**
 * 🔴 首页轮播的**海报卡白名单**（2026-09-26 王指出问题后加的）
 * ------------------------------------------------------------------
 * 王的原话：「首页轮播图中有一个手机直出的模板，我没有要求设计这个模板」
 *
 * 查证：轮播 18 张里只有「灵感复刻」「食感成字」是他要求过的；另外 5 张
 * （纸域微景 / 浅景分离 / 俯拍平铺 / 手机直出 / 异变主体）**查不到任何要求记录**。
 *
 * 🔴 根因不是谁偷偷加了模板，而是**原来的写法本身就不该存在**：
 *    `posterCards` 曾经是 `posterDirections.map(...)` **全量并入**，靠
 *    `CARDS` 末尾的 `.filter(card => !/^https?:/.test(card.cover))` 收口 ——
 *    那条 filter 的**本意**是「远程封面别进轮播」，**实际效果**却是
 *    「**封面是本地图的海报方向才进轮播**」。16 个方向里恰好 6 个用本地图
 *    ⇒ 这 6 个自动上了首页。**首页展示什么被一个打包细节决定了，不是设计决定。**
 *
 * ⇒ 现在必须是**显式白名单**。下面四条一起守「别再退回全量 map」。
 *
 * ⚠️ 判据跑在 `stripComments(home)` 上，不是裸 `home` ——
 *    上面这段注释里**故意**写了 `posterDirections.map(...)` 和 `.filter(`，
 *    拿裸源码判会被自己的注释命中（要么假红，要么让判据因为错误的原因通过）。
 */
const homeCode = stripComments(home)
assert.match(
  homeCode,
  /CAROUSEL_POSTER_IDS/,
  'home must keep an explicit carousel allowlist — without it, any new poster direction ' +
    'silently appears on the home page (that is exactly what 王 objected to)'
)
assert.doesNotMatch(
  homeCode,
  /const posterCards: Card\[\] = posterDirections\.map\(/,
  'posterCards must NOT be a full map over posterDirections — that is the bug 王 found: ' +
    'which posters show on home was decided by whether the cover happened to be a local file'
)
assert.match(
  homeCode,
  /posterDirections[\s\S]{0,200}?\.filter\([\s\S]{0,120}?CAROUSEL_POSTER_IDS/,
  'the poster cards must be derived by filtering posterDirections through the allowlist'
)

/** 白名单**内容**也是判据：王只要求过「食感成字」上首页，多一个都得有人来解释。 */
const allowlist = /const CAROUSEL_POSTER_IDS\s*=\s*\[([^\]]*)\]/.exec(homeCode)?.[1] ?? ''
const allowlistIds = [...allowlist.matchAll(/'([^']+)'/g)].map((m) => m[1])

/**
 * 王点名的那 5 张：**不许再出现在白名单里**。
 * ------------------------------------------------------------------
 * ⚠️ 这条放在下面那条 `deepEqual` **之前**，是为了让失败信息更具体。
 *    两条都会拦「白名单里多了 phone-candid」，但 `deepEqual` 只会打印一个数组 diff，
 *    而这条会直接说「这 5 张是王指出没要求设计的那批」——
 *    下一个人看到哪条，决定他是「改判据」还是「知道自己加错了」。
 */
const UNREQUESTED_POSTER_IDS = ['paper-field', 'shallow-dof', 'overhead-flatlay', 'phone-candid', 'anomaly-subject']
for (const id of UNREQUESTED_POSTER_IDS) {
  assert.ok(
    !allowlistIds.includes(id),
    `${id} 在首页轮播白名单里 —— 这 5 张是 2026-09-26 王指出「我没有要求设计」的那批，` +
      '不该自己回到首页'
  )
}

assert.deepEqual(
  allowlistIds,
  ['food-type'],
  `首页轮播白名单应当只有 food-type（食感成字），实际是 ${JSON.stringify(allowlistIds)}。\n` +
    '      加一张卡就是一次设计决定 —— 确认是王要求的之后，把这条一起改掉。'
)

/**
 * 「手机直出」这个方向已**整个删除**（16 → 15）。
 * ⚠️ 判据锚**条目写法** `{ id: 'phone-candid'`，不判裸子串 ——
 *    `prompt-templates.ts` 里留了墓碑注释，注释里**故意**写了 `phone-candid`
 *    这个 id（说明它去哪了）。裸 `includes('phone-candid')` 会被自己的注释命中而**假红**。
 */
const tps = stripComments(
  readFileSync(new URL('../src/data/prompt-templates.ts', import.meta.url), 'utf8')
)
assert.doesNotMatch(
  tps,
  /\{\s*id:\s*'phone-candid'/,
  'the phone-candid poster direction must stay deleted (王: 「我没有要求设计这个模板」)'
)
assert.doesNotMatch(
  tps,
  /import\s+\w+\s+from\s+'@\/assets\/poster-phone-candid/,
  'the phone-candid cover must stay un-imported — otherwise it gets bundled again (+112 KB)'
)

/**
 * 「快速创作」的参考图入口（2026-09-26 王要求：左下角加 + 号，直接在首页选图）
 * ------------------------------------------------------------------
 * ⚠️ 这条链路有**三段**，少任何一段都是**静默失败**：
 *   ① 首页真的能选图（入口 + 隐私弹窗）
 *   ② 选完真的交给下游（`setReferenceDraft`）—— 少这段 = 图选了但没带过去，
 *      下游照常出图，只是**没有参考图**，不报错
 *   ③ 下游真的接得住（`create-freeform` 的 `takeReferenceDraft`）
 *
 * ⚠️ 另有一条**真实踩过的坑**（见 components/UploadSlot.tsx 的 handleRemove）：
 *    删除按钮不 `stopPropagation` 的话，点「×」会连带触发外层的「换一张」——
 *    用户看到的是「删不掉，反而又让我选图」。同样**不报错**，只有真点一下才发现。
 *
 * ⚠️ 这里原来是一行提示字，意思是「参考图留到下一页再加」。它现在是**错的**
 *    （参考图就在这一步加），所以下面有两条 doesNotMatch 钉着它别回来。
 */
assert.match(home, /composer-ref-add/, 'home composer must keep the + entry for a reference image')
assert.match(
  home,
  /composer-ref-thumb/,
  'home composer must keep the picked-image thumbnail state (选了要看得见)'
)
assert.match(
  home,
  /setReferenceDraft\(reference\)/,
  'home must hand the picked image to the downstream page — otherwise it is silently dropped'
)
assert.match(
  home,
  /<PrivacyGate\s*\/>/,
  'home must mount PrivacyGate: wx.chooseMedia is a privacy API, and without the gate the consent popup never shows'
)
assert.match(
  home,
  /handleRemoveReference[\s\S]{0,400}?stopPropagation/,
  'the thumbnail × must stopPropagation, or tapping it also re-opens the album (silent: "删不掉，反而又让我选图")'
)
assert.doesNotMatch(
  home,
  /composer-card-tip/,
  'the "add a reference image later" hint is wrong now — the image is picked right here'
)
assert.doesNotMatch(
  home,
  /composer-card-meta/,
  'the top-right "生成 1 张" was removed (王 2026-09-26): it duplicated the 生成 button'
)
assert.match(
  home,
  /<View className='composer-launch'[\s\S]{0,200}?<Text>生成<\/Text>/,
  'the composer launch button must read 生成 (was 开始)'
)
assert.doesNotMatch(
  home,
  /<Text>开始<\/Text>/,
  'the composer launch button must no longer say 开始'
)

/**
 * 点击区下限：`+` 号和缩略图必须由**同一条共享规则**给出 42×42。
 *
 * ⚠️ 这条刻意写在**源码级**（`css` 已 stripComments），不写进 verify-dist：
 *    产物里 42px 会变成 `80.15267rpx`，那是 designWidth 换算出来的，
 *    锚死它就会在改 Taro 配置时**假红**。源码里 42px 是**写下来的设计意图**，
 *    在这里判它才稳。
 *
 * ⚠️ 42px 是**手指**的下限，不是审美。点击区更小用户点不中，
 *    而「点不中」**不报错** —— 用户只会觉得这个按钮坏了。
 *    两态共用一条规则，是为了避免「选中/删除的瞬间卡片跳一下」。
 */
const refSharedRule = /\.composer-ref-add\s*,\s*\.composer-ref-thumb\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
assert.ok(
  /width:\s*42px/.test(refSharedRule) && /height:\s*42px/.test(refSharedRule),
  'the + entry and the thumbnail must share one rule giving both width:42px and height:42px ' +
    '(42px is the tap-target floor; unequal boxes make the card jump on pick/remove) — ' +
    `got ${JSON.stringify(refSharedRule.slice(0, 160))}`
)

const appHeader = readFileSync(new URL('../src/components/AppHeader.tsx', import.meta.url), 'utf8')
assert.match(appHeader, /capsuleInsetRight/, 'AppHeader must inject the capsule inset for the title cap')

/**
 * ⚠️ 这条守的是「令牌**不许被删**」，不是「值必须是多少」。
 * `.header-title` 的 max-width 是 `calc(100% - 104px - var(--capsule-r))`。
 * 令牌在 ⇒ 没注入时退回 0px，只是少让一点（标题仍被封顶）。
 * 令牌被删 ⇒ var() 解析不到，**整条 max-width 声明在计算值阶段失效**，
 *           退回初始值 none —— 封顶闸门直接消失，而且不报错。
 * 这就是为什么它必须是「有兜底值的令牌」而不是「可选变量」。
 */
assert.match(
  css,
  /--capsule-r:\s*0px/,
  'the capsule token must keep a 0px fallback, or its calc() dies silently'
)
assert.match(
  css,
  /\.header-title\s*\{[^}]*max-width:\s*calc\([^;]*var\(--capsule-r\)/,
  'the header title must be width-capped so a long title cannot run under the capsule'
)

/**
 * ⚠️ calc() 里只许出现 var() —— 这是全项目既有约定，别让新代码破掉它。
 * 踩过（2026-09-22）：胶囊让位先写成 `calc(20px + var(--capsule-r))`，
 * Taro 把 20px 转成 `38.16794rpx`，postcss-calc 认不出 rpx 这个单位
 * （UNKNOWN_DIMENSION），构建**多出两条警告**。
 * 声明本身会原样保留（不致命，已核对产物），但警告会淹没真正的问题 ——
 * 而且改之前的产物里 12 条 calc **一条字面量都没有**，全是 var() 相加。
 * 判据：凡是消费 --capsule-r 的 calc，括号内不许出现 px 字面量。
 */
const capsuleCalcs = css.match(/calc\([^;{}]*var\(--capsule-r\)[^;{}]*\)/g) ?? []
assert.ok(capsuleCalcs.length > 0, 'expected at least one calc() consuming --capsule-r')
for (const expr of capsuleCalcs) {
  assert.doesNotMatch(
    expr,
    /\d+px/,
    'calc() consuming --capsule-r must be var()-only: a px literal compiles to rpx, ' +
      `which postcss-calc cannot parse and warns about — ${expr}`
  )
}

const profile = readFileSync(new URL('../src/pages/profile/index.tsx', import.meta.url), 'utf8')
assert.match(profile, /me-balance-value/, '我的 should show the points balance')
assert.match(profile, /pages\/recharge\/index/, '我的 should link into recharge')

const freeform = readFileSync(new URL('../src/pages/create-freeform/index.tsx', import.meta.url), 'utf8')
assert.match(freeform, /composer-toolbar/, 'freeform should expose a compact composer toolbar')
assert.match(freeform, /reference-add-label/, 'freeform should keep the reference-image add affordance')

/**
 * 链路第 ③ 段：下游真的接得住。
 * 只守首页「交出去」不够 —— 下游哪天不再 `takeReferenceDraft()`，
 * 图照样会**静默消失**（没有参考图就直接走文生图，出图看起来完全正常）。
 */
assert.match(
  freeform,
  /takeReferenceDraft\(\)/,
  'create-freeform must take the reference draft, or the image picked on home vanishes silently'
)

/**
 * 灵感复刻（2026-09-23 新增，见 docs/handoffs/2026-09-23-inspiration-recreate.md）
 * ------------------------------------------------------------------
 * 这里守的是**静态结构**，不是渲染结果 —— 三条各自会退化成不同的坏状态：
 *   ① **入口**：页面存在但首页没链接，用户根本到不了。功能等于没做，而门禁全绿。
 *   ② **单张**：点数必须从 `BATCH_SIZE` 派生。写死 `n: 1` 能跑，但哪天
 *      BATCH_SIZE 变了，**价格会和实际出图张数各说各话**。
 *      （2026-09-24 起按钮文案不再派生自 BATCH_SIZE —— 按钮上只剩「生成」，
 *        张数不再由按钮表达。价格那条断言仍在守，见下。）
 *   ③ **权利确认**：`rightsConfirmed` 必须真的进判定链，而且确认控件要有
 *      **可见文字标签**（只画一个方块的话，读屏用户不知道在确认什么）。
 *
 * 另两条「两张素材角色不可混淆」的判据：两个槽位的**删除文案**与**空状态说明**
 * 必须不同。不能只靠颜色区分 —— 读屏、低对比度、黑白截图下颜色都不存在。
 */
const recreate = readFileSync(new URL('../src/pages/create-reference/index.tsx', import.meta.url), 'utf8')

assert.match(home, /pages\/create-reference\/index/, 'home must link into 灵感复刻')
assert.match(recreate, /title=['"]灵感复刻['"]/, 'the page must render its own header title')
assert.match(recreate, /recreate-rights-label/, 'the rights control needs a visible text label, not just a box')
assert.match(recreate, /openPrivacyContract/, 'the rights note must link to the rules page')
assert.match(
  recreate,
  /recreateEditImages/,
  'the page must delegate material order to recreateEditImages — inlining it re-introduces the silent role swap'
)
assert.doesNotMatch(
  recreate,
  /images:\s*\[/,
  'the page must not inline the images array: recreateEditImages owns the [product, reference] order'
)

/**
 * ⚠️ 判据必须锚到**属性写法**，不能只做全文子串匹配（这一条是被对抗测试抓出来的）。
 * 第一版写的是 `assert.match(recreate, /BATCH_SIZE/)` 与 `/rightsConfirmed/` ——
 * 而这两个标识符在文件里**别处也出现**（`n: BATCH_SIZE`、`patch({ rightsConfirmed })`）。
 * 于是把 `count={BATCH_SIZE}` 改成 `count={1}`、把初始值改成 `rightsConfirmed: true`
 * 之后，断言**照样通过**：它看着在守这两件事，其实只证明了「这个标识符出现过」。
 * 同类的坑在铁律里记过（`code.includes(title)` / `includes('浅景分离')`）。
 */
const dock = recreate.match(/<GenerateDock[\s\S]*?\/>/)?.[0] ?? ''
assert.ok(dock, 'the page must render a GenerateDock')
/**
 * ⚠️ 这里原来还有一条 `assert.match(dock, /count=\{BATCH_SIZE\}/)`，
 * 守的是「按钮上的张数不能写死」。2026-09-24 按钮上不再显示张数
 * （只剩「生成」），`count` 这个 prop 已删，那条断言**没有对象可守了**，
 * 于是连同 prop 一起删掉 —— 留一条永远通过的断言比没有更坏。
 * 价格那条仍在，而且现在它是这一页**唯一**的钱数来源。
 */
assert.match(
  dock,
  /cost=\{costForImages\(BATCH_SIZE\)\}/,
  'the dock cost must come from costForImages(BATCH_SIZE) so price and count cannot drift apart'
)
assert.match(
  dock,
  /disabled=\{!ready\}/,
  'the generate button must be disabled while prerequisites are missing'
)

assert.match(
  recreate,
  /rightsConfirmed:\s*false/,
  'the draft must start **unconfirmed** — a default of true skips the confirmation entirely'
)

const removeLabels = [...recreate.matchAll(/removeLabel='([^']+)'/g)].map((m) => m[1])
assert.equal(removeLabels.length, 2, 'exactly two upload slots are expected')
assert.notEqual(removeLabels[0], removeLabels[1], 'the two slots must not share a remove label')

const slotHints = [...recreate.matchAll(/hint='([^']+)'/g)].map((m) => m[1])
assert.ok(slotHints.length >= 2, 'both upload slots need an empty-state hint')
assert.notEqual(slotHints[0], slotHints[1], 'the two slots must not share an empty-state hint')

/**
 * 首页轮播的前两张（2026-09-25 王确认：灵感复刻打头，食感成字第二）
 * ------------------------------------------------------------------
 * 这里守的仍然是**接线**：
 *   ① **入口**：页面存在但首页没链接，用户根本到不了 —— 功能等于没做，而门禁全绿。
 *   ② **首张**：灵感复刻必须是轮播第一张。
 *   ③ **封面比例**：灵感复刻那张卡必须用 2:3 的封面（产物级比例门禁在 verify:dist）。
 *
 * 🔴 2026-09-25 之前这里守的是**相反**的东西：
 *    当时王要求「所有新加入的功能都应该放在首页的集中展示里，不是单独成为一个模块」，
 *    于是有一块 `.home-features` 横滑轨道装三张卡（灵感复刻/产品拍摄/电商主图）。
 *    2026-09-25 王要求「删除页面下方的新功能三个模板，只把灵感复刻放在首页最上方里」，
 *    那条规矩作废 —— 所以下面这些断言**整体反了过来**。
 *    改回来之前先确认王确实又改主意了，别只是「觉得这样更整齐」。
 *
 * ⚠️ 负向断言也要**锚到写法**，不能数裸子串。
 *    首页的墓碑注释里为了说明删了什么，**特意写了** `FEATURES` / `.home-feature-rail` /
 *    `feature-*.jpg` 这些名字 —— 裸子串断言会被自己的注释命中而假红
 *    （也可能因为注释而假绿）。所以下面一律锚 `className='…'` / `from '@/assets/…'`。
 */
assert.doesNotMatch(
  home,
  /className='home-features'/,
  '首页不该再有「新功能」集中展示区了（2026-09-25 王要求整块删掉）'
)
assert.doesNotMatch(
  home,
  /className='home-feature-rail'/,
  '「新功能」那条横滑轨道已经删了 —— 各功能各开一块或整块加回来都要先问王'
)
assert.equal(
  (home.match(/className='home-feature-/g) ?? []).length,
  0,
  '首页不该再出现任何 .home-feature-* 的接线'
)

// 入口不再从意图表读：产品拍摄 / 电商主图 的首页入口随那块一起删了
assert.equal(
  (home.match(/productStudioIntentMeta\(/g) ?? []).length,
  0,
  '首页不再直接接产品拍摄/电商主图（它们改走「选择方式 → 产品图 → 切 tab」）'
)
assert.doesNotMatch(
  home,
  /from '@\/services\/product-studio'/,
  '首页不再需要 product-studio 的意图表 —— 留着就是一条没人读的 import'
)

// 那三张 4:5 展示图不许再被 import（留在 assets 里但不进包，见首页墓碑注释）
for (const asset of ['feature-inspiration-recreate', 'feature-product-shot', 'feature-marketplace']) {
  assert.doesNotMatch(
    home,
    new RegExp(`from '@\\/assets\\/${asset}\\.jpg'`),
    `home must not import ${asset} —— 「新功能」那块已经删了`
  )
}

// 灵感复刻的封面必须是 2:3 的那张新图
assert.match(
  home,
  /from '@\/assets\/cover-inspiration-recreate\.jpg'/,
  'home must import cover-inspiration-recreate —— 轮播首卡没有封面就是一张空白卡'
)

/**
 * 「灵感复刻是第一张」这条只能断言到**源码级**，且要锚到数组的**首项**。
 * ⚠️ 不去断言产物里的运行时顺序：那个顺序是 JS 算出来的，
 *    产物里只有 `...LEAD_CARDS` 这个展开，看不出谁在前谁在后。
 *    唯一能看到运行时 DOM 的是 `_diag/measure-page.mjs`，但它是**手写 mock**，
 *    拿它当判据等于造第二个真源。⇒ 这里就老老实实锁源码结构，并写明它的边界。
 */
const leadBlock = /const LEAD_CARDS: Card\[\] = \[([\s\S]*?)\n\]/.exec(home)
assert.ok(leadBlock, '找不到 LEAD_CARDS 数组 —— 首页轮播的置顶顺序改结构了')
assert.match(
  leadBlock[1],
  /^\s*REFERENCE_CARD,/,
  'LEAD_CARDS 的**第一项**必须是 REFERENCE_CARD（灵感复刻），它现在打头'
)
assert.match(
  home,
  /const CARDS: Card\[\] = \[\s*\.\.\.LEAD_CARDS,/,
  'CARDS 必须以 ...LEAD_CARDS 开头 —— 否则置顶顺序会被后面的展开挤掉'
)

// 灵感复刻那张卡的路由：create-reference 不读参数 ⇒ url 不许带 query
assert.match(
  home,
  /url: '\/pages\/create-reference\/index'/,
  '灵感复刻的入口要用 /pages/create-reference/index'
)
assert.doesNotMatch(
  home,
  /create-reference\/index\?/,
  'create-reference 不读任何路由参数 —— url 带上 query 不会报错，只会被静默忽略'
)
assert.match(
  home,
  /cover: coverInspirationRecreate/,
  'REFERENCE_CARD 的封面要用导入进来的 coverInspirationRecreate'
)

const result = readFileSync(new URL('../src/pages/result/index.tsx', import.meta.url), 'utf8')
assert.match(result, /result-action-row/, 'result should expose a dedicated action row')
assert.match(result, /作为参考图/, 'result should support using an output as a reference image')

const assets = readFileSync(new URL('../src/pages/assets/index.tsx', import.meta.url), 'utf8')
assert.match(assets, /asset-filter-row/, 'library should expose lightweight category filters')

assert.match(styles, /--accent-soft:/, 'visual system should include a restrained accent surface')
assert.match(styles, /\.home-composer-card\s*\{/, 'visual system should style the focused home composer')

assert.equal(
  assetMatchesFilter({ title: '自由生图', skill: 'IMAGE MAKER', createdAt: '', id: '1', images: [] }, 'freeform'),
  true,
  'library freeform filter should recognise freeform work'
)
setReferenceDraft({ name: 'generated', path: 'https://example.com/generated.png', size: 0 })
assert.equal(takeReferenceDraft()?.path, 'https://example.com/generated.png', 'result can pass an image into the composer')

/**
 * 2026-09-24 真机验收的三处 UI 修正（王在手机上逐条挑出来的）
 * ------------------------------------------------------------------
 * 这三条的共同点：**它们都不会让任何东西报错**。
 *   · 圆点压在价格上是两个盒子的坐标恰好差 1px；
 *   · 按钮里的字没居中，是 flex 分配的结果，不是「坏了」；
 *   · 按钮里多一个 `<Text>` 只是「字变小了」。
 * 所以逐条钉在**生效的 CSS 与结构**上（`css` 已剥掉注释，见上面 stripComments
 * 那段的理由：注释里为了说明历史会写出这些字面量）。
 */

// ① 生成按钮：不再撑满整行 + 按钮里没有单价了
/**
 * 🔴 这里**故意不守**「圆角是 999px」，虽然那是最容易写的一条。
 * 原因是它守不住，而且会假装守住了 —— 2026-09-24 实测过：
 *   源码里 `.generate-cta { border-radius: 999px }` 在，这条断言就绿；
 *   而第 13 节还有一条 `.primary-cta { border-radius: 8px }`，在文件里**更靠后**、
 *   特异性相同 ⇒ 产物里生效的是 **8px**，胶囊根本没生效。
 * 源码级判据看不见级联 —— 它只能证明「文件里出现过 999px」。
 * ⇒ 形状改由 `scripts/verify-dist.mjs` 的「生成按钮是胶囊」在**产物**上守
 *   （取最后一条 border-radius 与按钮高度比），量法见 `scripts/measure-page.mjs`。
 *   这一节只留源码能诚实断言的两条：不许撑满整行、不许再印单价。
 */
assert.doesNotMatch(
  css,
  /\.generate-cta\s*\{[^}]*flex:\s*1/,
  '生成按钮不再撑满整行：宽度只包住「生成」两个字'
)
assert.doesNotMatch(css, /\.cta-cost/, 'cta-cost 已随按钮里的单价一起删掉，别再回来')

// ② 方案卡的选中圆点：必须在**那一行里面**，不能绝对定位到价格上
const radioRule = css.match(/\.plan-radio\s*\{[^}]*\}/)?.[0] ?? ''
assert.ok(radioRule, 'expected a .plan-radio rule')
assert.doesNotMatch(
  radioRule,
  /position:\s*absolute/,
  '选中圆点必须在流里：绝对定位到 right/bottom 会压住价格（真机上就是这个问题）'
)
assert.match(radioRule, /flex-shrink:\s*0/, '圆点不能被价格挤扁（19px 的圆压成椭圆，且不报错）')
const rechargePage = readFileSync(new URL('../src/pages/recharge/index.tsx', import.meta.url), 'utf8')
const mainBlock =
  rechargePage.match(/<View className='plan-card-main'>[\s\S]*?className='plan-radio'[\s\S]*?<\/View>/)?.[0] ?? ''
assert.ok(mainBlock, 'expected .plan-radio inside .plan-card-main')
/**
 * 判据不是「文件里 plan-radio 出现在 plan-card-main 之后」（那样挪出去也照样通过），
 * 而是**标签配平**：从 `<View className='plan-card-main'>` 到 `className='plan-radio'`
 * 之间，`<View` 与 `</View>` 必须一一配平 —— 配平才说明圆点还在这一层里面。
 * 一旦有人把它挪回卡片层级（`</View>` 先关掉 main，再开 radio），这里就会多出一个
 * 闭合标签 ⇒ 红。这类「位置对但层级错」的回归，只有配平能抓。
 */
const inner = mainBlock.replace("<View className='plan-card-main'>", '')
const opens = (inner.match(/<View\b/g) ?? []).length
const closes = (inner.match(/<\/View>/g) ?? []).length
assert.equal(
  opens,
  closes,
  `圆点必须是 .plan-card-main 的**直接子项**（其间 <View ${opens} / </View> ${closes}）：` +
    '一旦挪回卡片层级，它又会回到右下角压价格'
)

// ③ 充值按钮：两段文字作为一组居中，不能再被 margin-left: auto 拉到两端
assert.doesNotMatch(
  css,
  /\.recharge-cta \.cta-price\s*\{[^}]*margin-left:\s*auto/,
  '充值按钮的文字要居中：单价不能再被推到最右'
)

/* ── 设置徽标必须显示「给人看的名字」，不能把内部 value 直接渲染出来 ──────────
 *
 * 2026-09-27 实测：自由生图「高级设置」徽标写的是 `{ratio} · {…} · {model}`，
 * 于是**同一个页面里**「模型」选择器显示 `Sunburst`，徽标却显示
 * `gpt-image-2.5-sunburst`；清晰度选「高清」时徽标显示 `medium`
 * （四个档位里只有 `auto` 被硬编码成了「自动」）。
 * 这类破绽编译通过、类型通过、看着也不像坏 —— 只是把内部标识漏给了用户。
 *
 * 判据锚**表达式形态**，不是「文件里有没有 optionLabel」：
 * 只查存在性的话，`optionLabel` 引进来不用也算过。
 */
const freeformPage = readFileSync(
  new URL('../src/pages/create-freeform/index.tsx', import.meta.url),
  'utf8'
)
const badgeBlock = freeformPage.match(/<View className='settings-badge'>[\s\S]*?<\/View>/)?.[0] ?? ''
assert.ok(badgeBlock, 'expected .settings-badge inside the freeform composer')
assert.match(
  badgeBlock,
  /optionLabel\(QUALITY_OPTIONS,\s*quality\)/,
  '徽标里的清晰度必须走 label 映射（否则显示 low/medium/high）'
)
assert.match(
  badgeBlock,
  /optionLabel\(MODEL_OPTIONS,\s*model\)/,
  '徽标里的模型必须走 label 映射（否则显示 gpt-image-2.5-sunburst）'
)
assert.doesNotMatch(badgeBlock, /\{model\}/, '徽标不许直接渲染 model 这个内部 value')
assert.doesNotMatch(badgeBlock, /\{quality\}/, '徽标不许直接渲染 quality 这个内部 value')

/* 助手本身：找不到时必须回落成 value —— 渲染空白比渲染丑更难发现。 */
const catalogSrc = readFileSync(new URL('../src/data/catalog.ts', import.meta.url), 'utf8')
assert.match(
  catalogSrc,
  /export function optionLabel\(/,
  'catalog 必须导出 optionLabel —— 内部 value → 展示 label 的唯一映射口'
)
assert.match(catalogSrc, /\?\? value/, 'optionLabel 找不到时须回落成 value，不许返回空')

/* ── 王的两个设计决定（2026-09-27 模拟器实测后定），不许被静默回退 ─────────────
 *
 * ① 轮播指示器：13 个 5px 圆点 → 细进度条。
 *    原写法一张卡一个点，白名单落地后 13 张 ⇒ 13 个点、整行约 137px，
 *    **当前项只靠颜色区分，在 13 个 4px 点里根本看不出来** —— 指示器失效。
 * ② 「更多工具」：2 列 → 3 列（原来 5 项排 2 列，第 3 行右侧空一格）。
 *
 * ⚠️ 负向断言锚 `.hd-dots {`（带花括号），**不能锚裸子串 `hd-dots`** ——
 *    forme.scss 的墓碑注释里故意写了 `` `.hd-dots` `` 说明历史，
 *    裸子串会被自己的注释命中（2026-09-26 踩过同类坑）。
 * ⚠️ 首页 TSX 里可以锚裸子串，因为那里没有注释提它。
 */
assert.match(home, /hd-progress/, '首页轮播指示器要用 .hd-progress（细进度条）')
assert.doesNotMatch(home, /hd-dots/, '首页不该再有 .hd-dots 圆点阵')
assert.match(css, /\.hd-progress-fill\s*\{/, '细进度条要有 .hd-progress-fill')
assert.doesNotMatch(css, /\.hd-dots\s*\{/, '圆点阵的样式规则应已删除（只剩注释里的历史说明）')
assert.match(
  css,
  /\.workflow-row\s*\{[^}]*grid-template-columns:\s*repeat\(\s*3\s*,/,
  '「更多工具」网格要改成 3 列'
)

/* ── 首页不放底导 + 资产页不许变成孤儿页（2026-09-27 王定） ────────────────
 *
 * 王定「首页不显示底导」，理由是底导（734–803）盖住了 composer 卡的操作行
 * （785.4–828.4）约 40%，而首屏要让给创作入口。
 *
 * ⚠️ 撤底导前做入口侦察，发现 `/pages/assets/index` 会**彻底失去入口**：
 *   - `app.config.ts` 只是路由注册，不是入口
 *   - `data/app-nav.ts` 是 BottomNav 的数据源，而 BottomNav 撤掉后
 *     只剩资产页自己在用（它自己那个 `active='assets'` 跳不到自己）
 *   - 全项目所有跳转目标里没有 `/pages/assets/index`
 * ⇒ 已把入口补在「我的」页的 `.me-assets-entry`。**这条门禁守住它。**
 *
 * ⚠️ 判据锚**跳转形态** `url: '/pages/assets/index'`，不是裸子串 ——
 *    首页与「我的」页的**注释里都写着** `` `/pages/assets/index` `` 说明背景，
 *    裸子串会被自己的注释命中（同 §2 ④ 与铁律 #11 ④ 的坑）。
 */
assert.doesNotMatch(
  home,
  /<BottomNav/,
  '首页不该再渲染底导（王 2026-09-27 定：底导会盖住 composer 卡的操作行约 40%）'
)

const ASSETS_NAV_FORM = "url: '/pages/assets/index'"
const pagesDir = new URL('../src/pages/', import.meta.url)
const navToAssets = readdirSync(pagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'assets')
  .map((entry) => `../src/pages/${entry.name}/index.tsx`)
  .filter((rel) => {
    try {
      return readFileSync(new URL(rel, import.meta.url), 'utf8').includes(ASSETS_NAV_FORM)
    } catch {
      return false
    }
  })
assert.ok(
  navToAssets.length >= 1,
  '「资产」页成了孤儿页：除它自己以外没有任何页面跳转到 /pages/assets/index。\n' +
    '      它唯一的入口曾经是首页底导；2026-09-27 首页撤掉底导后，入口补在「我的」页\n' +
    '      （.me-assets-entry）。删那个入口之前，先想清楚资产页从哪儿进。'
)

/* ── 首页首屏垂直预算（2026-09-27 王定「卡片底边要离开屏幕底」） ────────────
 *
 * **症状**：`.page-enter` 撤掉 transform 之后（见 verify-dist 的入场关键帧门禁），
 *   composer 卡的底边落在 **839.36**，而视口只有 **844** —— 卡底贴着屏幕底、
 *   压住 home indicator（≈831–836），观感像被切掉一块。
 *   实测记录：docs/handoffs/2026-09-27-ui-live-acceptance.md §10.5。
 *
 * **做法**：只压间距、不动任何组件尺寸（轮播卡仍是 236×354、输入区仍是 84px），
 *   共回收 36px：
 *     .hd-stage    margin-top  20 → 14
 *     .hd-caption  margin-top  18 → 12
 *     .hd-progress margin-top  16 → 10
 *     .home-intro  padding     36/16 → 24/10
 *   ⇒ 卡底 839.36 → **804.36**，落在底部安全区（810）之上。
 *
 * **同时必须把下一节推下去**：`.home-workflows` 原本在卡下面 30px。
 *   卡底 804.36 + 30 = 834.36 < 844 ⇒「更多工具」标题（约 22px 行高）会落在
 *   834–856，**屏幕底露出半行被切掉的标题**。所以 margin-top 30 → 46，
 *   workflows 顶边 = 850.36 > 844，首屏干净地以 composer 卡收尾。
 *
 * ⚠️ **判据为什么是「预算」而不是直接算卡底**：
 *   卡底 = **固定部分** + **可变间距**。可变间距（下面读的 6 项）在源码里；
 *   固定部分（顶栏 93 / 技能行 10 / 进度条 2 / 说明区内容 80.36 / 卡片 199.4）
 *   是**模拟器实测**出来的，源码里读不出来。
 *   所以把固定部分写成常量，并**同时断言它的来源没变**（下面第二条）——
 *   来源一变就红，否则这条断言会静默失效
 *   （铁律：留一条永远为真的断言比没有更坏）。
 *
 * ⚠️ 视口前提：**390×844（iPhone 12/13），状态栏 47、底部安全区 34**。
 *   换成别的机型，这条的数值要重新量 —— 首屏是一个「视口相关」的概念。
 */

// 首屏固定部分：实测卡底 839.36 − 改前可变间距之和 462 = 377.36
const HOME_FIRST_SCREEN_BASE = 377.36
// 844（视口）− 34（底部安全区）
const HOME_FIRST_SCREEN_LIMIT = 810

const cssBlock = (selector) =>
  new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''

/**
 * 取某个选择器在**全部**匹配规则里的声明串（`;` 连接）。
 * ------------------------------------------------------------------
 * ⚠️ `cssBlock` 只取**第一个**匹配。同一个选择器在多处出现时，后面的声明
 *    它读不到 —— 读不到就返回 `''`/旧值，于是判据会**静默失效**。
 *
 *    产物侧早就踩过同一个坑（`verify-dist.mjs` 的 `declsFor` 注释：压缩器会把
 *    选择器合并成组，`font-size` 落在**后面**那条规则里）。
 *    源码侧实测（2026-09-27）：`.input-card .composer-section-title` 有两条规则 ——
 *    「间距收口」那条（`margin-bottom: 12px`）在前、新增的 `margin-top` 在后 ⇒
 *    用 `cssBlock` 读 `margin-top` 得到 null，判据报「没有上边距」而其实有。
 */
const cssAll = (selector) => {
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    'g'
  )
  return [...css.matchAll(re)].map((m) => m[1]).join(';')
}
const cssPx = (selector, prop) => {
  const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*(-?[\\d.]+)px`).exec(cssBlock(selector))
  return m ? Number(m[1]) : null
}
/**
 * 上外边距：`.hd-progress` 写的是简写 `margin: 10px auto 0`（第一个值就是 top），
 * 只认 `margin-top` 会读成 null —— 2026-09-27 第一版就栽在这，门禁直接红。
 */
const cssMarginTop = (selector) => {
  const direct = cssPx(selector, 'margin-top')
  if (direct !== null) return direct
  const shorthand = /(?:^|[;\s])margin\s*:\s*(-?[\d.]+)px/.exec(cssBlock(selector))
  return shorthand ? Number(shorthand[1]) : null
}

// 假设守卫：首屏固定部分的来源。这些一变，377.36 就不再成立。
const FIXED_PART_ASSUMPTIONS = [
  ['.home-composer-input', 'min-height', 84],
  ['.composer-launch', 'min-height', 42],
  ['.home-composer-card', 'padding', 15],
  ['.composer-card-footer', 'margin-top', 12],
  ['.home-composer-input', 'margin-top', 14]
]
const driftedAssumptions = FIXED_PART_ASSUMPTIONS.filter(
  ([selector, prop, expected]) => cssPx(selector, prop) !== expected
)
assert.deepStrictEqual(
  driftedAssumptions,
  [],
  '首页首屏的**固定部分**变了（这些声明驱动卡片高度）：' +
    driftedAssumptions.map(([s, p, e]) => `${s} ${p}（期望 ${e}px）`).join('、') +
    '\n      ⇒ HOME_FIRST_SCREEN_BASE = 377.36 不再成立。' +
    '\n      请重跑 _diag/measure.sh .home-composer-card 量出新的卡底，' +
    '\n      按「新卡底 − 新的可变间距之和」更新常量，别直接放宽阈值。'
)

const introPad = (/padding\s*:\s*([\d.]+)px\s+[\d.]+px\s+([\d.]+)px/.exec(
  cssBlock('.home-dark .home-intro')
) ?? [])
const homeFirstScreenSpacings = [
  cssMarginTop('.hd-stage'),
  cssPx('.hd-swiper', 'height'),
  cssMarginTop('.hd-caption'),
  cssMarginTop('.hd-progress'),
  introPad[1] === undefined ? null : Number(introPad[1]),
  introPad[2] === undefined ? null : Number(introPad[2])
]
assert.ok(
  homeFirstScreenSpacings.every((value) => typeof value === 'number' && !Number.isNaN(value)),
  '首页首屏的间距读不出来（选择器或写法变了）：' + JSON.stringify(homeFirstScreenSpacings)
)

const homeCardBottom =
  HOME_FIRST_SCREEN_BASE + homeFirstScreenSpacings.reduce((sum, value) => sum + value, 0)
assert.ok(
  homeCardBottom <= HOME_FIRST_SCREEN_LIMIT,
  `首页 composer 卡的底边会落在 ${homeCardBottom.toFixed(2)}，` +
    `而底部安全区从 ${HOME_FIRST_SCREEN_LIMIT} 起（视口 844 − 安全区 34）。\n` +
    '      卡片会贴住屏幕底、压住 home indicator，观感像被切掉。\n' +
    '      间距之和 = ' + JSON.stringify(homeFirstScreenSpacings) + '\n' +
    '      改小上面任一项（.hd-stage / .hd-swiper / .hd-caption / .hd-progress / .home-intro）。'
)

const homeWorkflowsTop = homeCardBottom + cssPx('.home-workflows', 'margin-top')
assert.ok(
  homeWorkflowsTop > 844,
  `首页首屏会在屏幕底露出一截被切掉的「更多工具」标题（顶边 ${homeWorkflowsTop.toFixed(2)} ≤ 844）。\n` +
    '      首屏应当干净地以 composer 卡收尾。\n' +
    '      把 .home-workflows 的 margin-top 加到 ≥ ' + Math.ceil(844 - homeCardBottom + 1) + 'px。'
)

/* ── 三个字段式生成页必须与自由生图**同构**（2026-09-27 王定） ──────────────
 *
 * 背景：这三页（海报 / 产品 / 头像）原来是另一套结构 ——
 *   `.preview-panel` 大图（`aspect-ratio: 0.92` ⇒ 实测约 **352×383**，占首屏近一半）
 *   + `structured-intro` 两行大标题 + 一节一节的 `structured-section`。
 * 同一个产品里两套标题系统（31px `.h1` vs 27px `.composer-page-title`）、
 * 两套分区方式，是「界面杂乱、没有设计感」的结构性来源。
 * 现在三页统一成与 `create-freeform` 相同的三层：
 *   `composer-page-head`（96×96 缩略图 + 标题）→ `input-card` + `settings-card` → `GenerateDock`。
 *
 * ⚠️ **判据打在 JSX 的 className 字面量上，不打裸子串。**
 *    这三页的 TSX 注释里**故意写着** `preview-panel + structured-intro + structured-section`
 *    说明历史（同铁律 #11④：墓碑注释会命中自己的门禁）。
 *    抽 `className=` 字面量既避开了注释，也避开了字符串。
 */
const stripJsComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')

const jsxClasses = (code) => {
  const out = []
  for (const m of code.matchAll(/className=(?:'([^']*)'|\{`([^`]*)`\}|\{\s*'([^']*)'\s*\})/g)) {
    for (const tok of (m[1] ?? m[2] ?? m[3] ?? '').split(/[\s${}?:()'"]+/)) {
      if (tok) out.push(tok)
    }
  }
  return out
}

const FIELD_PAGES = {
  'create-poster': '字段式海报',
  'create-product': '产品替换',
  'create-avatar': '头像生成'
}

/** 同构必须具备的类（缺一个就说明这一页还是旧结构） */
const SHELL_CLASSES = [
  'page-enter',
  'composer-page-head',
  'is-thumbed',
  'composer-page-thumb',
  'composer-page-thumb-img',
  'composer-page-heading',
  'composer-page-title',
  'composer-page-copy',
  'composer-scroll',
  'input-card',
  'composer-surface',
  'settings-card',
  'settings-header',
  'settings-badge'
]

/** 旧结构的类，一个都不许留 */
const LEGACY_CLASSES = [
  'preview-panel',
  'structured-intro',
  'structured-section',
  'compact-settings',
  'replace-upload-section'
]

for (const [name, label] of Object.entries(FIELD_PAGES)) {
  const code = readFileSync(new URL(`../src/pages/${name}/index.tsx`, import.meta.url), 'utf8')
  const classes = jsxClasses(code)

  const missing = SHELL_CLASSES.filter((c) => !classes.includes(c))
  assert.deepStrictEqual(
    missing,
    [],
    `${label}（${name}）没有和自由生图同构：缺 ${missing.join('、')}。\n` +
      '      三层结构 = composer-page-head（含 96×96 缩略图）→ input-card + settings-card → GenerateDock。'
  )

  const legacy = LEGACY_CLASSES.filter((c) => classes.includes(c))
  assert.deepStrictEqual(
    legacy,
    [],
    `${label}（${name}）里还有旧结构的类：${legacy.join('、')}。\n` +
      '      旧结构 = preview-panel 大图 + structured-intro + structured-section，已于 2026-09-27 整体废弃。'
  )
}

/* 「输出设置」卡：只有「字段式海报」有可调项，另两页是**静态**卡（不可展开）。
 * 王 2026-09-27 定：三页都保留设置卡，无项时不可点开。
 * ⚠️ 判据看的是「有没有折叠面板」这个结构，不是文案 —— 文案会改，结构不该改。 */
{
  const poster = jsxClasses(
    readFileSync(new URL('../src/pages/create-poster/index.tsx', import.meta.url), 'utf8')
  )
  assert.ok(
    poster.includes('composer-settings-panel'),
    '字段式海报有可调项（比例 / 模型 / 清晰度），它的设置卡必须是可展开的 composer-settings-panel'
  )
  for (const name of ['create-product', 'create-avatar']) {
    const classes = jsxClasses(
      readFileSync(new URL(`../src/pages/${name}/index.tsx`, import.meta.url), 'utf8')
    )
    assert.ok(
      !classes.includes('composer-settings-panel'),
      `${FIELD_PAGES[name]}（${name}）的参数全部由模板锁定，设置卡应当是**静态**的（王 2026-09-27 定），` +
        '不该出现可展开的 composer-settings-panel'
    )
  }
}

/* ── 灵感复刻 = 第 4 个同构页（2026-09-27 王定「先只做这一页」） ──────────────
 *
 * 这一页原来是一串**平铺块**：每块一个 eyebrow + 25px `.h2` 标题
 * （`composer-block` + `form-heading` + `SectionHeading`）。
 * 模拟器实测（390×844，rpx = 1.0）：
 *   composer-page-head        117   → 279.6   （162.6px，其中 61.3px 是折成两行的标题）
 *   composer-block 产品图片    304.6 → 544.0
 *   composer-block 视觉参考    570.0 → 809.4   ← 下沿 801 被 719px 起的生成条盖住一截
 *   composer-choice 保留什么？  815.4 → 969.9   ← **整块在生成条后面**
 *   composer-block 补充说明   1178.4 → 1374.4
 *   recreate-rights          1412.8 → 1549.7   ← 法务勾选要滚 1.7 屏才够得到
 *   内容总高 1432.7px / 视口 844 ⇒ 约 **1.9 屏**
 * 另外两处结构性问题：页头 27px 标题 vs `.h2` 25px 只差 2px（两套标题系统视觉同级）；
 * 每个槽的解释说了三遍（`.h2` 标题 + 槽内 hint + `.composer-block-note`）。
 *
 * 现在与自由生图 / 字段式海报**同构**：
 *   composer-page-head（96×96 缩略图）→ input-card（创作输入）+ settings-card（输出设置）
 *   → GenerateDock，**法务声明 `recreate-rights` 留在两张卡之外**。
 *
 * ⚠️ 判据一律打在 `className=` 字面量上（`jsxClasses`），不打裸子串 ——
 *    这个文件的注释里故意写着 `composer-block` / `form-heading` 说明历史
 *    （同铁律 #11④：墓碑注释会命中自己的门禁）。
 */
const REFERENCE_LEGACY_CLASSES = ['composer-block', 'form-heading', 'section-heading']
const REFERENCE_REQUIRED_CLASSES = [
  'upload-grid',
  'composer-settings-panel',
  'settings-note',
  'recreate-rights'
]

/**
 * ⚠️ 灵感复刻的页头**刻意没有** `composer-page-copy`（王 2026-09-27 定）。
 * ------------------------------------------------------------------
 * 原来那两行说明是「选一张你有权使用的画面，再上传你的产品。只借鉴你勾选的
 * 那一项，其余重新组织。」—— 下半句和「保留什么？」的说明**一字不差**，
 * 上半句由两个槽的 label + hint 说清了。删掉后页头 162.6px → 134px
 * （带缩略图那一支的实测值；字段式海报实测 133px）。
 *
 * 用**显式例外表**，不用 `.filter()` 一笔带过：例外了谁、为什么例外，必须看得见。
 * 例外表的两条自检见下面（拼错一个字母的例外 = 静默无效的例外）。
 */
const REFERENCE_SHELL_EXCEPTIONS = ['composer-page-copy']
const REFERENCE_SHELL_CLASSES = SHELL_CLASSES.filter((c) => !REFERENCE_SHELL_EXCEPTIONS.includes(c))

{
  const code = readFileSync(new URL('../src/pages/create-reference/index.tsx', import.meta.url), 'utf8')
  const classes = jsxClasses(code)

  // ① 例外表里不许有 SHELL_CLASSES 里根本不存在的名字 —— 拼错一个字母，
  //    例外就静默失效（过滤掉一个不存在的名字 = 什么都没过滤）。
  const bogusExceptions = REFERENCE_SHELL_EXCEPTIONS.filter((c) => !SHELL_CLASSES.includes(c))
  assert.deepStrictEqual(
    bogusExceptions,
    [],
    `REFERENCE_SHELL_EXCEPTIONS 里有 SHELL_CLASSES 里不存在的名字：${bogusExceptions.join('、')}\n` +
      '      拼错一个字母 = 这个例外**静默无效**（过滤一个不存在的名字等于什么都没过滤）。'
  )

  // ② 例外必须真的是「被剔掉的」：逐项核对页面。
  //    🔴 这一条原来写的是
  //       `assert.deepStrictEqual(SHELL_CLASSES.filter(c => !REFERENCE_SHELL_CLASSES.includes(c)), REFERENCE_SHELL_EXCEPTIONS)`
  //       —— 拿「从例外表算出来的结果」去比「例外表自己」，**恒真**。
  //       对抗测试实测（M6）：把 'settings-card' 加进例外表，那条**照样绿**。
  //       典型的「永远为真的假门禁」：它看着在守例外表，其实什么都没守。
  const staleExceptions = REFERENCE_SHELL_EXCEPTIONS.filter((c) => classes.includes(c))
  assert.deepStrictEqual(
    staleExceptions,
    [],
    `例外表里的 ${staleExceptions.join('、')} 其实**在页面上是有的**。\n` +
      '      要么这个例外是多余的，要么页面没按计划改。\n' +
      '      如果是有意加回来的，把对应项从 REFERENCE_SHELL_EXCEPTIONS 里删掉。'
  )

  const missing = [...REFERENCE_SHELL_CLASSES, ...REFERENCE_REQUIRED_CLASSES].filter(
    (c) => !classes.includes(c)
  )
  assert.deepStrictEqual(
    missing,
    [],
    `灵感复刻（create-reference）没有和自由生图同构：缺 ${missing.join('、')}。\n` +
      '      三层结构 = composer-page-head（含 96×96 缩略图）→ input-card + settings-card → GenerateDock。'
  )

  const legacy = REFERENCE_LEGACY_CLASSES.filter((c) => classes.includes(c))
  assert.deepStrictEqual(
    legacy,
    [],
    `灵感复刻里还有旧平铺结构的类：${legacy.join('、')}。\n` +
      '      旧结构 = composer-block（eyebrow + 25px .h2 标题的平铺块）+ form-heading + section-heading，' +
      '2026-09-27 整体废弃。'
  )
}

/**
 * 🔴 权利确认必须在**两张卡之外**。
 * ------------------------------------------------------------------
 * 王 2026-09-27 的验收标准原话：「权利确认勾选（recreate-rights）不能被塞进
 * 卡片里 —— 它是**法务声明**，不该像设置项」。
 *
 * 判据：从 `composer-scroll` 到 `recreate-rights` 之间，`<View>` 必须**全部成对**。
 * 成对 ⇒ `recreate-rights` 是 `composer-scroll` 的直接子节点。
 * 这条同时拦两个方向：
 *   · 塞进 input-card / settings-card ⇒ 少一个 `</View>` ⇒ 红；
 *   · 挪到 `composer-scroll` 外面（会被固定生成条盖住）⇒ 多一个 `</View>` ⇒ 红。
 *
 * ⚠️ 它假设本页没有**自闭合**的 `<View ... />`（全部成对）。真加了自闭合 View，
 *    这条会误报成红 —— 那时改成显式深度扫描，**别直接删它**。
 *    已用对抗测试证明它会拦（把 recreate-rights 移进 settings-card ⇒ 红）。
 */
{
  const code = readFileSync(new URL('../src/pages/create-reference/index.tsx', import.meta.url), 'utf8')
  const scrollAt = code.indexOf("className='composer-scroll'")
  const rightsAt = code.indexOf("className='recreate-rights'")
  /**
   * ⚠️ 起点/终点都要落在**标签之前**，否则会各差一个。
   *    踩过：`scrollAt` 取在 `className=` 上 ⇒ composer-scroll 自己的 `<View` 不计入
   *    （正是想要的）；但 `rightsAt` 也取在 `className=` 上 ⇒
   *    `recreate-rights` 自己的 `<View` 被**多算一个**，于是 11 开 11 闭 变成 12 开 11 闭，
   *    判据**永远为红**。所以终点回退到它自己的 `<View`。
   */
  const rightsTagAt = code.lastIndexOf('<View', rightsAt)
  assert.ok(
    scrollAt > 0 && rightsTagAt > scrollAt,
    '取不到 composer-scroll / recreate-rights 的位置 —— 这条判据会退化成永远为真，先修它'
  )
  const seg = code.slice(scrollAt, rightsTagAt)
  const opens = (seg.match(/<View\b/g) ?? []).length
  const closes = (seg.match(/<\/View>/g) ?? []).length
  assert.equal(
    opens,
    closes,
    `权利确认被塞进卡片里（或挪出 composer-scroll）了：composer-scroll 到 recreate-rights 之间` +
      `有 ${opens} 个 <View> 开、${closes} 个闭。\n` +
      '      它是**法务声明**，必须是 composer-scroll 的直接子节点、在两张卡之外。'
  )
}

/**
 * 两个上传槽并排后，那段合并的小字**两句话的事实都不能少**。
 * ------------------------------------------------------------------
 * 原来两段（分在各自块下）：
 *   · 这张图是画面里唯一的产品主体，包装比例与上面的文字会被保留。
 *   · 参考图里的人物、Logo、文字与商标都不会进入结果。
 * 两槽并排后半宽塞不下两段 ⇒ 合成一段。合并**不能顺手删事实**：
 * 前半句是「产品主体」的承诺，后半句是「不复制第三方内容」的承诺。
 * ⚠️ 跑在 `stripJsComments` 上 —— 上面那段注释里也写着这两句。
 */
{
  const code = stripJsComments(recreate)
  assert.match(code, /唯一的产品主体/, '合并后的说明必须保留「唯一的产品主体」这句承诺')
  assert.match(
    code,
    /人物、Logo、文字与商标都不会进入结果/,
    '合并后的说明必须保留「人物 / Logo / 文字 / 商标都不会进入结果」这句承诺'
  )
}

/**
 * 「素材 0/2」这个计数必须**只看两张图**，不能从 `blocker` 反推。
 * `blocker` 还包含权利确认 ⇒ 拿它反推的话，勾完权利计数会凭空跳到 2/2，
 * 而用户其实一张图都没传。这种错不报错、只是数字不对。
 */
{
  const filledLine = /const filled =[^\n]*/.exec(recreate)?.[0] ?? ''
  assert.ok(filledLine, '页面里必须有 `const filled = …`（素材 n/2 的分子）')
  assert.match(filledLine, /draft\.product/, '计数必须看产品图')
  assert.match(filledLine, /draft\.reference/, '计数必须看参考图')
  assert.doesNotMatch(
    filledLine,
    /rightsConfirmed|blocker/,
    '计数不能从 blocker / rightsConfirmed 反推 —— 勾完权利会让它凭空跳到 2/2'
  )
  assert.match(recreate, /\{filled\}\/2/, '计数必须真的渲染出来（「0/2」）')
}

/**
 * 页头缩略图必须复用**首页那张封面**（`cover-inspiration-recreate.jpg`）。
 * 它是 640×960 = 2:3，已经被 `pages/home/index.tsx` import ⇒ 本来就在包里，
 * 这一处**不增加任何字节**（主包余量只有 ~352KB，不能随便加图）。
 * 换成别的图会真的加字节；这条判据同时钉住「首页也在 import 同一张」，
 * 否则「0 额外字节」这句话就不成立了。
 */
{
  const ASSET_IMPORT = "from '@/assets/cover-inspiration-recreate.jpg'"
  assert.match(recreate, new RegExp(`import coverInspirationRecreate ${ASSET_IMPORT}`), '页头缩略图必须 import 那张封面')
  assert.match(recreate, /src=\{coverInspirationRecreate\}/, '缩略图必须真的用这张封面')
  assert.match(home, new RegExp(ASSET_IMPORT), '首页也必须 import 同一张封面 —— 否则「0 额外字节」不成立')
}

/**
 * 「添加产品图片后继续」不许**同屏出现两遍**（2026-09-27 实测踩到）。
 * ------------------------------------------------------------------
 * `GenerateDock.hint` 用同一个 `RECREATE_BLOCKER_HINT` 在生成条上方显示这句话，
 * 而生成条是 `position: fixed`（top 719，视口 844）⇒ 它**永远在视野里**。
 * 页面上再渲染一遍 `composer-blocker` 就是同一句话同屏两次 ——
 * 截图证据 `_diag/shots/ref-after-2.png`：y≈455 与 y≈680 各一句。
 * 空槽自己带着「必需」小标，字段级提示没有增加任何信息。
 *
 * ⚠️ 如果哪天要让 `composer-blocker` 回来，**别直接删这条** ——
 *    先把生成条那句 hint 改成别的文案（两处不能同源同一个常量），
 *    否则「同一句话印两遍」会静默回来。
 */
assert.doesNotMatch(
  stripJsComments(recreate),
  /composer-blocker/,
  '页面里又出现了 composer-blocker —— 它会和生成条的 hint 同屏显示同一句话'
)

/**
 * 卡片里「非首个」分区标题必须有上边距。
 * ------------------------------------------------------------------
 * 实测：`.composer-section-title` 只有 `margin-bottom: 12px`，没有上边距 ⇒
 * 「补充说明」小标题贴着「保留什么？」的胶囊行（只差 13px），
 * 读起来像它属于「保留什么？」。
 * ⚠️ 判据**不锚 px 值**，只锚不变量「第一个是 0、后面的不是 0」——
 *    间距以后可以调，但「第一个不加、后面的加」这条关系不该变。
 */
{
  const spaced = Number(
    /margin-top:\s*([\d.]+)px/.exec(cssAll('.input-card .composer-section-title'))?.[1] ?? 0
  )
  assert.ok(
    spaced > 0,
    '`.input-card .composer-section-title` 没有上边距 —— 「补充说明」会贴着上面那一块的胶囊。\n' +
      '      ⚠️ 用 `cssAll` 读，不是 `cssBlock` —— 这个选择器有两条规则，' +
      '`cssBlock` 只取第一条（`margin-bottom`），读不到 `margin-top`。'
  )
  assert.match(
    cssAll('.input-card .composer-section-title:first-child'),
    /margin-top:\s*0/,
    '卡片里**首个**分区标题必须清零上边距 —— 卡片的 padding 已经给了，否则卡片顶部会空一块'
  )
}

/**
 * 新增的类必须**两边都有**（铁律 #19：TSX 用了但 SCSS 没定义 = 编译通过、
 * 没样式、不报错；`var(--不存在的令牌)` 同样静默失效）。
 */
{
  const NEW_SELECTORS = [
    '.input-card .composer-choice',
    '.input-card .upload-grid',
    '.input-card.composer-surface .reference-note.prompt-field',
    '.settings-note'
  ]
  for (const selector of NEW_SELECTORS) {
    assert.ok(cssBlock(selector), `forme.scss 里没有 ${selector} 的定义 —— TSX 用了它，但样式是空的（静默失败）`)
  }
  assert.match(
    cssBlock('.input-card .composer-choice'),
    /border:\s*0/,
    '「保留什么？」进了卡片必须去掉自己的边框 —— 不然是「卡中卡」'
  )
  assert.match(
    cssBlock('.input-card .composer-choice'),
    /background:\s*transparent/,
    '「保留什么？」进了卡片必须去掉自己的底色'
  )
  assert.match(
    cssBlock('.input-card.composer-surface .reference-note.prompt-field'),
    /padding:\s*0/,
    '补充说明必须抵消 `.composer-surface .prompt-field` 的 14px 内缩，否则左边线和上传槽对不齐'
  )
  assert.match(cssBlock('.settings-note'), /color:\s*var\(--muted\)/, '.settings-note 必须走令牌')
}

/* 假的收藏按钮必须彻底消失（2026-09-27 王定「删掉」）。
 * 它原来只弹一个 Toast「已收藏到灵感夹」，不存任何数据 —— 用户以为收藏了，
 * 其实什么都没发生。假功能比没有更糟，所以门禁拦住它回来。
 * ⚠️ 判据跑在**去掉注释**的源码上：这三页的注释里解释了为什么删它。 */
for (const name of Object.keys(FIELD_PAGES)) {
  const code = stripJsComments(
    readFileSync(new URL(`../src/pages/${name}/index.tsx`, import.meta.url), 'utf8')
  )
  assert.doesNotMatch(code, /已收藏到灵感夹/, `${name} 里又出现了假的收藏 Toast 文案`)
  assert.doesNotMatch(code, /♡/, `${name} 里又出现了 ♡ 收藏按钮（它是假功能，2026-09-27 已删）`)
}

/* 缩略图页头：96×96 是王 2026-09-27 定的尺寸，且必须是**横向**排版
 * （缩略图与标题同一行）。改成竖排或改大，首屏又会被图吃掉。 */
{
  const thumbed = cssBlock('.composer-page-head.is-thumbed')
  assert.match(thumbed, /display:\s*flex/, '缩略图页头必须是横向 flex（缩略图与标题同一行）')
  assert.match(thumbed, /gap:\s*14px/, '缩略图与标题之间的间隙要 14px')

  const thumb = cssBlock('.composer-page-thumb')
  assert.match(thumb, /width:\s*96px/, '模板缩略图宽度要 96px')
  assert.match(thumb, /height:\s*96px/, '模板缩略图高度要 96px')
  assert.match(thumb, /flex:\s*0\s+0\s+96px/, '缩略图必须 `flex: 0 0 96px`，否则会被文案挤扁')

  const heading = cssBlock('.composer-page-heading')
  assert.match(
    heading,
    /min-width:\s*0/,
    '标题列必须写 min-width: 0 —— flex 子项默认 min-width: auto，长文案会把列撑开、缩略图被挤扁（静默布局失败）'
  )
}

/* 字段式页的配色必须走令牌（2026-09-27）。
 *
 * 这三页的样式是**浅色主题**时代留下的：橄榄绿边框 `#4a5844`、橄榄绿底 `#1a2119`、
 * 橄榄绿 ✦ 图标 `#8b9f29` / `#9bad34`，外加同一个「次要灰」写了 6 个不同值
 * （#8d958f / #909891 / #8f9690 / #8b928c / #8b938c / #858a87，而 --muted 是 #8b8b85）。
 * 「同一份设计里有 6 种灰」正是「没有设计感」的可量化来源。
 *
 * ⚠️ 判据是「这些规则里**一个硬编码色都不许有**」，不是「不许出现某几个色值」——
 *    后者只拦已知的几个，下次有人写 #a1b2c3 照样溜过去。
 * ⚠️ 跑在 `css`（已去注释）上：墓碑注释里写着这些历史色值。 */
{
  const TOKEN_ONLY_SELECTORS = [
    '.select-field',
    '.select-field.is-compact',
    '.structured-field',
    '.structured-field .field-input',
    '.structured-lock',
    '.structured-lock .lock-icon',
    '.replace-tip',
    '.replace-lock',
    '.replace-lock .lock-icon',
    '.back-home-link',
    '.option-row',
    '.option-pills .pill'
  ]
  const offenders = []
  for (const selector of TOKEN_ONLY_SELECTORS) {
    const block = cssBlock(selector)
    if (!block) {
      offenders.push(`${selector}（读不到这条规则 —— 选择器变了）`)
      continue
    }
    const hexes = block.match(/#[0-9a-fA-F]{3,6}\b/g) ?? []
    if (hexes.length) offenders.push(`${selector} → ${hexes.join(' ')}`)
  }
  assert.deepStrictEqual(
    offenders,
    [],
    '字段式页的样式里还有硬编码颜色，必须改成令牌引用：\n      ' +
      offenders.join('\n      ') +
      '\n      （同一个「次要灰」曾经有 6 个不同值；橄榄绿 #4a5844/#1a2119/#8b9f29/#9bad34 是浅色主题遗留）'
  )
}

/* 令牌必须只有一个真源（2026-09-27）。
 *
 * `forme.scss` 里有**两个** `page{}` 块（L62 基础块 / L2074 深色皮肤块）。
 * 两块选择器与特异性完全相同 ⇒ **后写的赢**。原先块 1 里也放了 8 个颜色令牌
 * （--ink #f4f4ef / --muted #969897 / --line #282c2c / --lime / --bg #101212 /
 *  --surface #171b1b / --surface-2 #1a1e1e / --surface-3 #181d1c），
 * 全部被块 2 覆盖 ⇒ 是**死代码**：改它们**没有任何效果，也没有任何提示**。
 * 我一度把块 1 的旧值当成有效值记进长期记忆，并据此干活 —— 错的。
 *
 * 判据 = 「同一个令牌名全文件只定义一次」。
 * ⚠️ 跑在 `css`（已去注释）上：删掉的那 8 个名字还写在墓碑注释里。
 * ⚠️ 刻意**不**写成「`page{}` 只能有一个」—— 块 1 的 16 个非颜色令牌
 *    （--safe-b / --dock-h / --page-pad …）仍然有效、必须留着，
 *    那条断言会**永远为红**，而永远为红的门禁会被下一个人删掉。
 *    （「留一条永远为真的断言比没有更坏」的镜像：永远为红的门禁同样更坏。） */
{
  const defs = [...css.matchAll(/(?:^|[;{])\s*(--[\w-]+)\s*:/g)].map((m) => m[1])
  const seen = new Map()
  for (const name of defs) seen.set(name, (seen.get(name) ?? 0) + 1)
  const dup = [...seen.entries()].filter(([, n]) => n > 1)
  assert.deepStrictEqual(
    dup,
    [],
    '这些令牌定义了不止一次（后定义的会静默覆盖前面的，改前一个没有效果）：\n      ' +
      dup.map(([n, c]) => `${n} × ${c}`).join('\n      ') +
      '\n      （颜色令牌只应定义在「深色皮肤」那个 page{} 块里；块 1 只放非颜色令牌）'
  )
}

/* 不许有悬空的 var()（2026-09-27）。
 * `var(--不存在的令牌)` **静默退回初始值** —— 不报错、不红、属性等于没写。
 * 2026-09-27 我的方案里就编过一个不存在的 `var(--edge)`（正确是 `--line`）。
 *
 * ⚠️ 定义的正则必须容忍**单行规则里的定义**：`.foo { --bar: 1px; }`。
 *    第一版写成 `^[ \t]*--name:`（只认行首）⇒ 单行规则的定义**认不出来**，
 *    而 `var(--bar)` 认得出来 ⇒ 报假「悬空」。**是负控制组抓到的。** */
{
  const defined = new Set(
    [...css.matchAll(/(?:^|[;{])\s*(--[\w-]+)\s*:/g)].map((m) => m[1])
  )
  const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))
  const undef = [...used].filter((n) => !defined.has(n)).sort()
  assert.deepStrictEqual(
    undef,
    [],
    '这些 var() 引用了没定义的令牌（会静默退回初始值）：\n      ' + undef.join('\n      ')
  )
}

/* 资产库骨架屏（2026-09-27，P1-2）。
 *
 * 取证：全项目**只有资产库**真的异步取数据（`loadAssets()` → 服务端）。
 * 产品工作室 / 头像模板库是本地常量**同步**渲染（0 处 await / useDidShow）——
 * 给它们加数据骨架屏**永远不会显示**，等于留一条永远为真的断言。
 * ⇒ 王定：只做资产库。（原方案写的是「三个列表页」，那是个错误假设。）
 *
 * 另一半问题：`skeleton-pulse` 早就定义了，`@keyframes pulse` 也进了产物存在性门禁，
 * 但**0 个页面引用它** —— 关键帧在、动画永远不跑。这一条补的就是「真被用上」。
 */
{
  const assetsCode = stripComments(assets)

  // ① 骨架屏真的被引用，且用的是约定好的类
  assert.match(
    assetsCode,
    /className='asset-skeleton skeleton-pulse'/,
    '资产库找不到骨架屏容器（`asset-skeleton skeleton-pulse`）——\n' +
      '      `@keyframes pulse` 在产物里存在、却没有页面用它，动画永远不跑。'
  )

  // ② 必须是**条件渲染**，不能常驻（常驻 = 一直显示骨架）
  assert.match(
    assetsCode,
    /loading\s*&&\s*!loadedOnce\.current\s*\?\s*\(/,
    '骨架屏不再是「仅首次加载」的条件渲染 —— 要么常驻（一直显示骨架），\n' +
      '      要么条件被改掉了；两种情况都会让用户看到不该看到的骨架。'
  )

  // ③ 占位块必须复用真实列表的类 —— 否则几何会漂（漂了不报错，只是高度跳一下）
  //
  // 🔴 判据必须**只看骨架屏那一段 JSX**。写在整份文件上会退化成**永远为真**：
  //    真实列表本身就已经含有 'asset-group' / 'asset-grid' / 'asset-cell' / 'asset-img'
  //    这四个字符串 ⇒ 骨架屏就算改用别的类，整份文件里照样找得到它们。
  //    （「留一条永远为真的断言比没有更坏」——这条我第一版就写错了。）
  const skStart = assetsCode.indexOf("className='asset-skeleton skeleton-pulse'")
  const skEnd = skStart >= 0 ? assetsCode.indexOf(') : null}', skStart) : -1
  const skeletonJsx = skStart >= 0 && skEnd > skStart ? assetsCode.slice(skStart, skEnd) : ''
  assert.ok(
    skeletonJsx.length > 0,
    '取不到骨架屏那段 JSX —— 这条「复用真实类」的判据会退化成永远为真，必须先修它。'
  )
  const REUSED_LIST_CLASSES = ['asset-group', 'asset-grid', 'asset-cell', 'asset-img']
  const missingReuse = REUSED_LIST_CLASSES.filter((cls) => !skeletonJsx.includes(`'${cls}'`))
  assert.deepStrictEqual(
    missingReuse,
    [],
    '骨架屏没有复用真实列表的类：' +
      missingReuse.join(' / ') +
      '\n      另写一套占位类会和真实卡片漂开，而漂开的表现是「数据到了之后高度跳一下」。'
  )

  // ④ 旧的文字加载态必须彻底消失（TSX + SCSS 两处）
  assert.doesNotMatch(
    assetsCode,
    /asset-loading/,
    '资产库还在用旧的 `.asset-loading` 文字加载态（应已换成骨架屏）'
  )
  assert.doesNotMatch(css, /\.asset-loading\b/, 'forme.scss 里 `.asset-loading` 没删干净')

  // ⑤ 骨架样式必须定义 —— TSX 用了 SCSS 没定义 = 静默失败（编译通过、没样式、不报错）
  for (const sel of ['.asset-skeleton', '.asset-skeleton-bar']) {
    assert.ok(
      new RegExp(`\\${sel}\\s*\\{`).test(css),
      `forme.scss 里找不到 ${sel} —— TSX 用了但没定义（编译通过、没样式、不报错）`
    )
  }
}

console.log('creator UI behavior checks passed')
