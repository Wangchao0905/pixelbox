import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MARKETPLACE_SHOT_OPTIONS,
  MARKETPLACE_SHOTS,
  PRODUCT_SHOT_MODES,
  PRODUCT_SHOT_OPTIONS,
  PRODUCT_STUDIO_BLOCKER_HINT,
  PRODUCT_STUDIO_INTENTS,
  PRODUCT_STUDIO_NOTE_MAX,
  buildProductStudioPrompt,
  canGenerateProductStudio,
  defaultProductStudioIntent,
  intentFromValue,
  intentValue,
  productStudioBlocker,
  productStudioEditImages,
  productStudioIntentFromParam,
  productStudioIntentMeta,
  productStudioOptions,
  productStudioParamName,
  productStudioRatio,
  productStudioSkill,
  productStudioTemplateId,
  productStudioTitle
} from '../src/services/product-studio.ts'

/**
 * 产品工作室（产品拍摄 / 电商主图）· 纯函数单测
 * ------------------------------------------------------------------
 * 这里测的是**编排**，不是渲染。编排错了不会报错，只会出图不对：
 *   · 素材顺序多带了别的图 ⇒ 提示词里的「图一」指向变了，主体不是用户的产品
 *   · 提示词少了「产品保真」那条 ⇒ 模型会把包装换掉，而这类工作流存在的全部意义
 *     就是「不重拍、不改产品」
 *   · 比例落到 `ratioToSize` 的 key 之外 ⇒ `defaultConfigForRatio` **静默回落 2:3**
 *   · 模板 id 前缀不对 ⇒ 资产库按前缀分类时这条记录在「产品」下**看不见**，
 *     而列表照常渲染、不报错
 * 四种都是「看着像成功了」的失败，所以必须钉在测试里。
 *
 * 用法：npm run test:product-studio
 */

const product = { name: 'product.jpg', path: '/tmp/product.jpg', size: 11 }
const other = { name: 'other.jpg', path: '/tmp/other.jpg', size: 22 }

const draft = (over = {}) => ({ product, intent: { kind: 'product-shot', mode: 'studio' }, note: '', ...over })

/** 全部六种意图，用于「逐项都要成立」的遍历断言 */
const ALL_INTENTS = [
  ...PRODUCT_SHOT_MODES.map((mode) => ({ kind: 'product-shot', mode })),
  ...MARKETPLACE_SHOTS.map((shot) => ({ kind: 'marketplace', shot }))
]

/** 每个意图的**专属**标记串 —— 取各自说明里唯一的片段，不取整句（整句里可能含共有词） */
const MARK = {
  studio: '接触阴影',
  lifestyle: '环境不得抢走注意力',
  with_model: '人物只承担辅助叙事',
  white_background: '无缝背景',
  color_benefit: '叠加商品文案',
  detail_closeup: '不虚构包装上不存在的信息'
}

const keyOf = (intent) => intentValue(intent)

/* ---------------- 素材顺序：永远只有产品图一张 ---------------- */

/**
 * ⚠️ 这是与「灵感复刻」**最容易被合并掉**的一条：那边是 `[产品, 参考]`，
 * 这边**没有参考图**。谁「顺手」把两张都带上，图一的含义就变了，
 * 而提示词里写的正是「以图一中的产品为唯一主体」—— 不报错，只是主体不对。
 */
for (const intent of ALL_INTENTS) {
  assert.deepEqual(
    productStudioEditImages({ product, intent, note: '' }),
    [product],
    `${keyOf(intent)}：editImages 只该收到产品图一张`
  )
}

/* ---------------- 门禁：只有产品图是必填 ---------------- */

assert.equal(canGenerateProductStudio(draft()), true, '有产品图就能生成')
assert.equal(canGenerateProductStudio(draft({ product: null })), false, '没产品图不能生成')
assert.equal(productStudioBlocker(draft()), null, '齐了就没有 blocker')
assert.equal(productStudioBlocker(draft({ product: null })), 'product', '缺的是产品图')

// 两个判据必须永远一致（不一致 ⇒ 「按钮能点但提示说缺图」或反过来，且不报错）
for (const hasProduct of [true, false]) {
  const d = draft({ product: hasProduct ? product : null })
  assert.equal(
    productStudioBlocker(d) === null,
    canGenerateProductStudio(d),
    `两个判据在 product=${hasProduct} 下不一致`
  )
}
assert.equal(
  PRODUCT_STUDIO_BLOCKER_HINT.product,
  '添加产品图片后继续',
  '字段级提示文案由服务层持有，页面不许内联写死'
)

/* ---------------- 比例：必须是 ratioToSize 的 key ---------------- */

/**
 * ⚠️ 这里**不能 `import` `data/catalog.ts`**：它内部写的是无扩展名的
 * `import { media } from './media'`，而 Node 的 ESM 解析器要求带扩展名
 * （`--experimental-strip-types` 只负责剥类型，不管解析）。
 * 所以从源码文本里抽 `ratioToSize` 的 key —— 判据锚到 `'比例': '尺寸'`
 * 这个**属性写法**，不锚裸字符串。
 */
const catalogSource = readFileSync(new URL('../src/data/catalog.ts', import.meta.url), 'utf8')
const ratioBody = /ratioToSize[^{]*\{([\s\S]*?)\}/.exec(catalogSource)?.[1] ?? ''
const RATIO_KEYS = [...ratioBody.matchAll(/'(\d+:\d+)'\s*:/g)].map((m) => m[1])

/**
 * 解析器自检。抽不到 key 时下面的断言会**全部通过**（空集合里当然没有元素），
 * 于是这条门禁静默变成瞎的 —— 所以先钉住「抽出来的条数」和两个已知值。
 */
assert.ok(RATIO_KEYS.length >= 5, `ratioToSize 只抽到 ${RATIO_KEYS.length} 个比例 —— 解析器坏了`)
assert.ok(RATIO_KEYS.includes('1:1'), '解析器没抽到 1:1 —— 判据是瞎的')
assert.ok(RATIO_KEYS.includes('2:3'), '解析器没抽到 2:3 —— 判据是瞎的')

for (const intent of ALL_INTENTS) {
  const ratio = productStudioRatio(intent)
  /**
   * ⚠️ 这条是本次最值钱的一条断言。`defaultConfigForRatio` 写的是
   * `ratioToSize[ratio] ?? '1024x1536'` —— 比例不在表里时**静默回落 2:3**。
   * 于是「棚拍选了 1:1」会发出一张 2:3 的尺寸，界面、按钮、扣费全都正常。
   */
  assert.ok(
    RATIO_KEYS.includes(ratio),
    `${keyOf(intent)} 的比例 ${ratio} 不在 ratioToSize 里 —— defaultConfigForRatio 会静默回落 2:3`
  )
}

/* ---------------- 标题 / 技能名 / 模板 id ---------------- */

assert.equal(productStudioTitle({ kind: 'product-shot', mode: 'studio' }), '产品拍摄', '工作流标题')
assert.equal(productStudioTitle({ kind: 'marketplace', shot: 'white_background' }), '电商主图', '工作流标题')

assert.equal(productStudioSkill({ kind: 'product-shot', mode: 'studio' }), '棚拍', '技能名落到模式')
assert.equal(productStudioSkill({ kind: 'product-shot', mode: 'with_model' }), '人物使用', '技能名落到模式')
assert.equal(
  productStudioSkill({ kind: 'marketplace', shot: 'detail_closeup' }),
  '细节特写',
  '技能名落到镜头'
)

for (const intent of ALL_INTENTS) {
  /**
   * ⚠️ 必须以 `product-` 开头：`services/create-ui.ts` 的资产分类按 templateId
   * 前缀判「产品」。前缀不对时这条记录在「产品」筛选下**看不到**，
   * 而列表照常渲染、不报错。
   */
  const id = productStudioTemplateId(intent)
  assert.ok(id.startsWith('product-'), `${keyOf(intent)} 的 templateId(${id}) 必须以 product- 开头`)
  assert.ok(id.includes(keyOf(intent)), `${keyOf(intent)} 的 templateId 要含模式名，便于排查`)
}

// 六种意图的 id 互不相同（撞了会让资产库里两条记录无法区分）
assert.equal(
  new Set(ALL_INTENTS.map((i) => productStudioTemplateId(i))).size,
  ALL_INTENTS.length,
  '六种意图的 templateId 必须互不相同'
)

/* ---------------- 选项：从常量派生，且每项都有说明 ---------------- */

assert.deepEqual(
  PRODUCT_SHOT_OPTIONS.map((o) => o.value),
  [...PRODUCT_SHOT_MODES],
  '选项必须由 PRODUCT_SHOT_MODES 派生 —— 各写一份的话，加模式时界面会静默漏掉它'
)
assert.deepEqual(
  MARKETPLACE_SHOT_OPTIONS.map((o) => o.value),
  [...MARKETPLACE_SHOTS],
  '选项必须由 MARKETPLACE_SHOTS 派生'
)

for (const option of [...PRODUCT_SHOT_OPTIONS, ...MARKETPLACE_SHOT_OPTIONS]) {
  assert.ok(option.label.trim(), `${option.value} 缺 label`)
  /**
   * ⚠️ `copy` 为空时页面上那一行**什么都不渲染**（组件里是 `selectedCopy ? … : null`），
   * 不报错、不留空行 —— 只是那个选项下面少一句说明，看起来像设计如此。
   */
  assert.ok(option.copy.trim(), `${option.value} 缺 copy —— 页面上那个选项会少一句说明，且不报错`)
}

// copy 与 label 不能是同一句（那就等于没有说明）
for (const option of [...PRODUCT_SHOT_OPTIONS, ...MARKETPLACE_SHOT_OPTIONS]) {
  assert.notEqual(option.copy, option.label, `${option.value} 的 copy 不该等于 label`)
}

assert.deepEqual(
  productStudioOptions('product-shot').map((o) => o.value),
  [...PRODUCT_SHOT_MODES],
  'productStudioOptions 要按 kind 分流'
)
assert.deepEqual(
  productStudioOptions('marketplace').map((o) => o.value),
  [...MARKETPLACE_SHOTS],
  'productStudioOptions 要按 kind 分流'
)

/* ---------------- 意图构造与取值 ---------------- */

for (const intent of ALL_INTENTS) {
  const value = intentValue(intent)
  assert.deepEqual(intentFromValue(intent.kind, value), intent, `${value} 应能原样往返`)
}

assert.deepEqual(
  defaultProductStudioIntent('product-shot'),
  { kind: 'product-shot', mode: PRODUCT_SHOT_MODES[0] },
  '默认意图是第一个模式'
)
assert.deepEqual(
  defaultProductStudioIntent('marketplace'),
  { kind: 'marketplace', shot: MARKETPLACE_SHOTS[0] },
  '默认意图是第一个镜头'
)

// 未知值必须抛错 —— 页面里写 `as ProductShotMode` 的话，不存在的模式会静默通过
assert.throws(() => intentFromValue('product-shot', 'nope'), /未知/, '未知模式要抛错')
assert.throws(() => intentFromValue('marketplace', 'studio'), /未知/, '把拍摄模式当镜头要抛错')
assert.throws(() => productStudioIntentMeta('nope'), /未知/, '未知 kind 要抛错')

/* ---------------- 提示词 ---------------- */

const promptOf = (intent, note = '') => buildProductStudioPrompt({ product, intent, note })

assert.equal(PRODUCT_STUDIO_NOTE_MAX, 160, '补充说明上限是 160 字')

for (const intent of ALL_INTENTS) {
  const prompt = promptOf(intent)
  const key = keyOf(intent)

  assert.match(prompt, /图一/, `${key}：必须点名图一`)
  assert.match(prompt, /唯一的产品主体/, `${key}：图一必须是唯一产品主体`)
  assert.match(prompt, /保持它的轮廓、包装比例、材质、颜色/, `${key}：产品保真要写全`)
  assert.match(prompt, /不要替换成别的产品/, `${key}：要明确不许换产品`)
  assert.match(prompt, new RegExp(productStudioTitle(intent)), `${key}：要写上工作流名`)
  assert.match(prompt, new RegExp(MARK[key]), `${key}：要含它自己的专属说明`)

  // 只发选中那一项的约束 —— 串门等于同时下了两个互相矛盾的指令
  for (const other of ALL_INTENTS) {
    if (keyOf(other) === key) continue
    assert.doesNotMatch(
      prompt,
      new RegExp(MARK[keyOf(other)]),
      `${key}：不该出现 ${keyOf(other)} 的说明`
    )
  }
}

/* ---------------- 电商主图额外禁止促销文字 ---------------- */

const shotPrompt = promptOf({ kind: 'product-shot', mode: 'studio' })
const marketPrompt = promptOf({ kind: 'marketplace', shot: 'white_background' })

assert.doesNotMatch(
  shotPrompt,
  /不要生成任何促销文字/,
  '产品拍摄不追加这条 —— 加错了不算 bug，但说明 kind 分流写反了'
)
for (const shot of MARKETPLACE_SHOTS) {
  assert.match(
    promptOf({ kind: 'marketplace', shot }),
    /不要生成任何促销文字、价格、标签或水印/,
    `${shot}：商品图上多出没写过的价格或标签是这类图最不能容忍的错`
  )
}

/* ---------------- 补充说明：为空时整段不许出现 ---------------- */

for (const intent of ALL_INTENTS) {
  const key = keyOf(intent)
  assert.doesNotMatch(promptOf(intent), /补充说明/, `${key}：note 为空时不许出现「补充说明」这一段`)
  assert.doesNotMatch(promptOf(intent, '   \n  '), /补充说明/, `${key}：只有空白字符等同没填`)

  for (const bad of ['undefined', 'null', 'NaN']) {
    assert.doesNotMatch(promptOf(intent), new RegExp(bad), `${key}：prompt 里不许出现 ${bad}`)
  }
}

const withNote = promptOf({ kind: 'product-shot', mode: 'studio' }, '背景换成水泥灰')
assert.match(withNote, /补充说明：背景换成水泥灰/, '填了 note 就要原样带上')
/**
 * ⚠️ 「补充说明不得覆盖产品保真」这句不能省：用户写「换个包装」时，
 * 没有这句话模型会照做 —— 而「不重拍、不改产品」是这个工作流存在的全部意义。
 */
assert.match(
  withNote,
  /不得\*\*改变产品本身的外形、材质、颜色或包装文字/,
  '有补充说明时必须声明它不能覆盖产品保真'
)
assert.match(withNote, /唯一的产品主体/, '有补充说明时产品保真那条仍在')

/* ---------------- 意图表：页面文案的唯一真源 ---------------- */

assert.equal(PRODUCT_STUDIO_INTENTS.length, 2, '产品工作室顶层就两个意图（「精选场景」走原有模板库）')
assert.deepEqual(
  PRODUCT_STUDIO_INTENTS.map((item) => item.kind),
  ['product-shot', 'marketplace'],
  '意图顺序即界面顺序'
)

const appConfig = readFileSync(new URL('../src/app.config.ts', import.meta.url), 'utf8')

for (const item of PRODUCT_STUDIO_INTENTS) {
  for (const field of ['title', 'eyebrow', 'headline', 'description', 'choiceTitle', 'choiceLabel', 'choiceCopy']) {
    assert.ok(item[field]?.trim(), `${item.kind} 缺 ${field} —— 页面会渲染出空白`)
  }

  /**
   * ⚠️ 入口页必须在 `app.config.ts` 里登记。漏登记时 `navigateTo` 直接失败，
   * 但首页那张卡照常渲染、可点 —— 用户点下去没有任何反应。
   * 判据锚到**引号包着的字面量**，不是裸子串（裸子串会被注释命中）。
   */
  const page = item.route.replace(/^\//, '')
  assert.ok(
    appConfig.includes(`'${page}'`),
    `${item.kind} 的入口页 ${page} 没登记进 app.config.ts 的 pages —— 点进去没有任何反应`
  )

  /**
   * 页面自己的 `<AppHeader title='…' />` 必须与意图表一致。
   * 这是产物门禁 `HEADER_PAGES` 的**源码级孪生**：产物那条在构建后才跑，
   * 这条在 `npm run test:product-studio` 就能拦下。两边都锚 `title='…'` 的属性写法。
   */
  const pageSource = readFileSync(
    new URL(`../src/pages/${page.replace(/^pages\//, '')}.tsx`, import.meta.url),
    'utf8'
  )
  assert.match(
    pageSource,
    new RegExp(`<AppHeader\\s+title='${item.title}'`),
    `${page} 里的 <AppHeader title='${item.title}' /> 与意图表不一致`
  )
}

/* ---------------- 组件：两个页面必须共用同一份表单 ---------------- */

/**
 * ⚠️ 这条守的是「两个页面有没有各写一份表单」。
 * 各写一份时，加一个模式必漏改一处 —— 不报错，只是那一页少了这个选项。
 * 判据用「页面文件里有没有出现模式表」，而不是数行数（行数会漂）。
 */
const composerSource = readFileSync(
  new URL('../src/components/ProductStudioComposer.tsx', import.meta.url),
  'utf8'
)
for (const item of PRODUCT_STUDIO_INTENTS) {
  const page = item.route.replace(/^\//, '').replace(/^pages\//, '')
  const pageSource = readFileSync(new URL(`../src/pages/${page}.tsx`, import.meta.url), 'utf8')
  assert.match(
    pageSource,
    /<ProductStudioComposer\s+kind='/,
    `${page} 必须挂共享的 ProductStudioComposer，而不是自己写一份表单`
  )
  assert.doesNotMatch(
    pageSource,
    /productStudioOptions|PRODUCT_SHOT_MODES|MARKETPLACE_SHOTS|buildProductStudioPrompt/,
    `${page} 里不该出现模式表或提示词编排 —— 那些归 ProductStudioComposer / 服务层`
  )
}

// 组件里不许自己拼素材数组（顺序归服务层独占）
assert.doesNotMatch(
  composerSource,
  /images:\s*\[/,
  '组件不许内联 images 数组 —— productStudioEditImages 独占「只有产品图一张」这个约定'
)
assert.match(composerSource, /productStudioEditImages/, '组件必须委托 productStudioEditImages')

/* ---------------- 路由参数：非法值必须退回默认，不能白屏 ---------------- */

assert.equal(productStudioParamName('product-shot'), 'mode', '产品拍摄的路由参数名')
assert.equal(productStudioParamName('marketplace'), 'shot', '电商主图的路由参数名')
assert.notEqual(
  productStudioParamName('product-shot'),
  productStudioParamName('marketplace'),
  '两个工作流的参数名必须不同 —— 共用 mode 会让分享链接看起来像同一个东西'
)

for (const intent of ALL_INTENTS) {
  const key = keyOf(intent)
  assert.deepEqual(
    productStudioIntentFromParam(intent.kind, key),
    intent,
    `${key} 应能从路由参数原样还原`
  )
}

/**
 * ⚠️ 路由参数是**外部输入**：手改过的链接、上一版缓存的分享链接、被截断的 URL。
 * 这里必须**不抛错** —— `intentFromValue` 抛错是给内部用的（内部传错说明代码写错了），
 * 而在页面里抛错就是用户白屏。
 */
const INVALID_FOR_BOTH = [undefined, null, '', 'nope', '1:1', 'white_background-x']
for (const bad of INVALID_FOR_BOTH) {
  for (const kind of ['product-shot', 'marketplace']) {
    let got
    assert.doesNotThrow(() => {
      got = productStudioIntentFromParam(kind, bad)
    }, `路由参数 ${JSON.stringify(bad)} 不该抛错（用户看到的是白屏）`)
    assert.deepEqual(
      got,
      defaultProductStudioIntent(kind),
      `非法参数 ${JSON.stringify(bad)} 要退回默认意图`
    )
  }
}

// 「把另一边的模式名贴过来」是最现实的一种坏链接，也必须退回默认
assert.deepEqual(
  productStudioIntentFromParam('product-shot', 'white_background'),
  defaultProductStudioIntent('product-shot'),
  '把电商主图的镜头名贴到产品拍摄的链接上，要退回默认'
)
assert.deepEqual(
  productStudioIntentFromParam('marketplace', 'studio'),
  defaultProductStudioIntent('marketplace'),
  '把产品拍摄的模式名贴到电商主图的链接上，要退回默认'
)

/* ---------------- 产品工作室：三个同级意图 + 14 个场景一个不删 ---------------- */

const gallery = readFileSync(new URL('../src/pages/product-gallery/index.tsx', import.meta.url), 'utf8')

assert.match(gallery, /title='产品工作室'/, '产品工作室的顶栏标题')

/**
 * ⚠️ 交接文件明确：不要把三个能力塞成平铺的九宫格。
 * 前两个意图的 tab 必须**从意图表派生** —— 这一页再抄一份的话，
 * 加一个意图时它不会出现在这一页上，而别处一切正常。
 */
assert.match(gallery, /PRODUCT_STUDIO_INTENTS\.map/, '顶层 tab 的前两个必须从意图表派生')
assert.match(gallery, /key: 'scene'/, '第三个 tab 是精选场景')
assert.match(
  gallery,
  /productStudioOptions\(/,
  '模式清单必须从服务层派生，页面不许再写一份'
)
assert.match(
  gallery,
  /productStudioParamName\(/,
  '跳转参数名必须从服务层取 —— 页面里写 mode= 字面量就会和读参数的那一侧漂开'
)
assert.doesNotMatch(
  gallery,
  /\?(mode|shot)=/,
  '页面不许自己拼参数名字面量'
)

/**
 * ⚠️ 14 个精选场景**一个不删**（交接文件）。这条判据必须**遍历**：
 * 只断言「import 了 productReplacementTemplates」证明不了条数没少 ——
 * 数据被删掉几条时，页面照常渲染、门禁全绿。
 * `prompt-templates.ts` 有 `@/assets` 别名与图片导入，Node 读不了，只能按文本解析。
 */
const templatesSource = readFileSync(new URL('../src/data/prompt-templates.ts', import.meta.url), 'utf8')
const arrayBlock =
  /export const productReplacementTemplates[\s\S]*?\n\]/.exec(templatesSource)?.[0] ?? ''
const templateIds = [...arrayBlock.matchAll(/\bid:\s*'([^']+)'/g)].map((m) => m[1])

// 解析器自检：抽不到就说明判据瞎了，别让它真空通过
assert.ok(templateIds.length > 0, '解析器没抽到 productReplacementTemplates 的条目 —— 判据是瞎的')
// 2026-09-28 「一键抠图」（transparent-cutout）曾短暂加入又下掉（用户判定：
// image 2.5 一步就能把产品放到任何背景，中间抠一次多余），精选场景回到 14。
// 这道断言的本意是「交接的模板一个不许删」—— 新增是允许的，删减才报警。
assert.equal(
  templateIds.length,
  14,
  `精选场景应保留 14 个，实际 ${templateIds.length} —— 交接文件要求一个不删`
)
assert.ok(
  !templateIds.includes('transparent-cutout'),
  '一键抠图（transparent-cutout）已下掉，不应再出现'
)
assert.equal(new Set(templateIds).size, 14, '14 个精选场景的 id 不能重复')
assert.match(gallery, /productReplacementTemplates/, '产品工作室必须仍然渲染这 14 个精选场景')

/**
 * ⚠️ 「收据拼贴」是**产品组第一张**（2026-09-26 王指定）。
 * 首页轮播的产品卡顺序 = 本数组顺序（`home/index.tsx` 直接 map 这个数组），
 * 所以「挪一下位置」会**真的**改变用户看到的第一张产品卡 —— 而编译和
 * 其它判据全是绿的。位置是产品要求，不是排版细节。
 */
assert.equal(
  templateIds[0],
  'receipt-collage',
  `产品组第一张应该是 receipt-collage，实际是 ${templateIds[0]}`
)

/**
 * ⚠️ 「收据拼贴」的 prompt 是**王给的原文，逐字照搬**。
 *    落地时我自己改错过一次：把原文的「使用提供的图像作为图像 A」
 *    写成了「使用用户上传的图片作为图像 A」，还顺手把原文的 3 处中文弯引号
 *    换成了直角引号 —— 一共 4 处改写，而编译、typecheck、当时的门禁**全绿**。
 *    这条断言就是为了让那种改写**响一声**。
 *    ⚠️ 弯引号是非 ASCII，塞进反引号字面量里本来就没有转义问题 ——
 *       所以「为了安全把弯引号换掉」这个理由是错的，别再犯。
 */
const tpsLines = arrayBlock.split('\n')
const receiptAt = tpsLines.findIndex((l) => l.includes("id: 'receipt-collage'"))
assert.ok(receiptAt !== -1, '产品模板里找不到 receipt-collage —— 判据是瞎的')
/**
 * 找条目结尾。
 * ⚠️ 2026-09-26 改了写法：原来是 `endsWith('negative: productNegative },')`，
 *    而这条的 negative 已经换成 `receiptCollageNegative`、文案字段还拆成了
 *    好几行 —— 旧判据会**一条都匹配不到**（`receiptEnd` = -1），
 *    于是下面那条 `receiptEnd > receiptAt` 报红。它是**变更探测器**，不是坏判据。
 *    现在按「本条目的第一行以 `},` 收尾」来找：receipt-collage 是数组第一项，
 *    中间那 12 行 prompt 都以 `。` 收尾，所以第一个 `},` 就是它自己的结尾。
 */
const receiptEnd = tpsLines.findIndex((l, i) => i >= receiptAt && l.trimEnd().endsWith('},'))
assert.ok(receiptEnd > receiptAt, 'receipt-collage 的条目没有正常收尾（解析器瞎了）')
const receiptEntry = tpsLines.slice(receiptAt, receiptEnd + 1).join('\n')
// 边界自检：既不能少收（缺尾部），也不能多吞（把下一条也圈进来）
assert.ok(
  receiptEntry.includes("id: 'receipt-collage'"),
  '收尾判据圈出来的块里没有 receipt-collage 的开头'
)
assert.ok(
  !receiptEntry.includes("id: 'gelato-overhead'"),
  '收尾判据把下一个条目（gelato-overhead）也吞进来了 —— 后面的断言会在错的块上跑'
)

assert.match(
  receiptEntry,
  /使用提供的图像作为图像 A/,
  '「收据拼贴」prompt 被改写了：开头应是「使用提供的图像作为图像 A」'
)
assert.doesNotMatch(
  receiptEntry,
  /用户上传的图片/,
  '「收据拼贴」prompt 被改写了：原文里没有「用户上传的图片」这句'
)
for (const quote of ['\u201c@ 单词\u201d或\u201c@ 短语\u201d', '\u201cWhisper\u201d', '\u201cVol. 01。\u201d']) {
  assert.ok(
    receiptEntry.includes(quote),
    `「收据拼贴」prompt 的中文弯引号被改掉了，缺少：${quote}`
  )
}

/**
 * ⚠️ 「收据拼贴」的 negative **不继承** `productNegative`（王 2026-09-26 定）。
 *    `productNegative` 是写给「把画面里的产品主体换掉」那类模板的，它把输入
 *    预设成一件**带包装的商品**（「包装文字与品牌标识准确」「不得…改变产品
 *    结构」「无关人物」），而这条模板的输入是一张**照片** —— prompt 第一句
 *    就是「使用提供的图像作为图像 A」。两处语义直接打架，而这类错
 *    **不会**让编译 / typecheck / 其它门禁变红，只会让出图跑偏。
 */
assert.match(
  receiptEntry,
  /negative: receiptCollageNegative/,
  '「收据拼贴」的 negative 应该用自己的 receiptCollageNegative'
)
assert.doesNotMatch(
  receiptEntry,
  /negative: productNegative/,
  '「收据拼贴」又用回 productNegative 了 —— 它是写给「换掉产品主体」那类模板的'
)

/**
 * ⚠️ 「收据拼贴」的页面文案也不继承产品链默认（见 `ProductPageCopyOverride`）。
 *    默认那句「模板会自动保留场景、光线和构图，只替换画面中的产品主体」对这条
 *    模板是**错的**：它不替换产品，它把照片印出来、用回形针夹在热敏收据上。
 */
const RECEIPT_COPY = {
  pageHeadline: '上传照片，',
  pageHeadlineAccent: '拼成收据。',
  pageCopy: '模板会读取照片的主题、色彩与氛围，据此写收据上的全部文案，并把照片全出血印出、用回形针夹在收据上。',
  uploadEyebrow: 'YOUR PHOTO',
  uploadTitle: '上传你的照片',
  uploadLabel: '上传照片',
  uploadHint: '建议使用主题明确、光线充足、构图干净的照片',
  uploadError: '请先上传照片'
}
for (const [field, value] of Object.entries(RECEIPT_COPY)) {
  assert.ok(
    receiptEntry.includes(`${field}: '${value}'`),
    `「收据拼贴」的页面文案字段 ${field} 应该是 ${JSON.stringify(value)}`
  )
}
assert.ok(
  !receiptEntry.includes('只替换画面中的产品主体'),
  '「收据拼贴」的 pageCopy 不该还是产品链那句「只替换画面中的产品主体」'
)

/**
 * 「一键抠图」的页面文案覆盖（2026-09-28 新增，同日随模板下掉）。
 * ------------------------------------------------------------------
 * 保留这段注释当路标：将来如果再加「输出不是普通替换图」的模板，
 * 文案覆盖要逐字段锁死，并且下面的减速带要同步加判据。
 */

/**
 * ⚠️ 页面文案覆盖目前只有一个模板：receipt-collage。
 *    2026-09-28 transparent-cutout 曾是第二个，已随模板下掉。
 *    每多一个，`create-product` 的默认文案和 `verify-dist` 的判据都要重新想一遍，
 *    所以这里做成一道**减速带**：加第二个时它会响，提醒你去补判据 ——
 *    而不是默默多出一个「页面说的和做的不一样」的模板。
 */
const copyFieldNames = Object.keys(RECEIPT_COPY)
const entriesWithCopy = templateIds.filter((id) => {
  const at = tpsLines.findIndex((l) => l.includes(`id: '${id}'`))
  const end = tpsLines.findIndex((l, i) => i >= at && l.trimEnd().endsWith('},'))
  const block = tpsLines.slice(at, end + 1).join('\n')
  return copyFieldNames.some((f) => block.includes(`${f}:`))
})
assert.deepEqual(
  entriesWithCopy,
  ['receipt-collage'],
  `只有 receipt-collage 该填页面文案覆盖，实际：${entriesWithCopy.join(' / ') || '（一个都没有）'}`
)

/**
 * ⚠️ 上面只证明「模板表里填了」。下面三条证明「页面真的用了它」——
 *    少任何一环的表现都是：模板填了、门禁绿了、页面上还是默认文案，**不报错**。
 */
const createProductSource = readFileSync(
  new URL('../src/pages/create-product/index.tsx', import.meta.url),
  'utf8'
)
const DEFAULT_COPY_LITERALS = {
  pageHeadline: '上传产品，',
  pageHeadlineAccent: '直接生成。',
  pageCopy: '模板会自动保留场景、光线和构图，只替换画面中的产品主体。',
  uploadEyebrow: 'YOUR PRODUCT',
  uploadTitle: '上传你的产品',
  uploadLabel: '上传产品',
  uploadHint: '建议使用正面、清晰、背景干净的产品图',
  uploadError: '请先上传产品图片'
}
/**
 * 把 `DEFAULT_COPY = { … }` 那一块抠出来单独看。
 * ⚠️ 为什么要抠：下面 ③ 要断言「这些字面量只准出现在 DEFAULT_COPY 里」。
 *    第一版写的是 `split("'" + value + "'")`（**带引号**地数）——
 *    对抗测试当场证明它是假门禁：把 JSX 改回 `<Text>上传产品，</Text>`
 *    （没有引号）时它数出来还是 1，**exit=0**。
 * ⚠️ 第二版（不带引号地数）又被控制组当场抓住：文件顶部的注释里有一句
 *    「上传产品图，所以页面刻意不提供提示词输入框」，里面**含**默认文案
 *    `上传产品`，于是它在 DEFAULT_COPY 之外「出现 1 次」—— **误报**。
 *    所以下面先把注释剥掉再看代码：注释里提到这些词是无害的，代码里才是渲染。
 */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const pageCode = stripComments(createProductSource)
const copyBlock = /const DEFAULT_COPY[\s\S]*?\n\}/.exec(pageCode)?.[0] ?? ''
assert.ok(
  copyBlock.includes('uploadError') && copyBlock.includes('pageHeadline'),
  '解析器没抠出 create-product 的 DEFAULT_COPY 块 —— 下面的判据会是瞎的'
)
const outsideCopyBlock = pageCode.replace(copyBlock, '')

for (const [field, value] of Object.entries(DEFAULT_COPY_LITERALS)) {
  // ① 默认文案**必须**还是改造前的原文 —— 另外 13 个模板都靠它。
  //    改它 = 同时改那 13 个模板的文案，属于产品决定，不是重构。
  assert.ok(
    copyBlock.includes(`${field}: '${value}'`),
    `create-product 的默认文案 ${field} 被改了（它同时影响另外 13 个模板）：期望 ${JSON.stringify(value)}`
  )
  // ② 页面**必须真的读**模板上的覆盖字段。
  assert.ok(
    createProductSource.includes(`template.${field} ??`),
    `create-product 没有读模板的 ${field} —— 填了也不会生效（静默失效）`
  )
  // ③ 代码里、DEFAULT_COPY **之外**不该再出现这个字面量：JSX 必须渲染 `copy.X`。
  //    少这一条的表现是：字段读了、也解析了，但页面上渲染的还是写死的字面量。
  const outside = outsideCopyBlock.split(value).length - 1
  assert.equal(
    outside,
    0,
    `create-product 的代码在 DEFAULT_COPY 之外还出现了 ${outside} 次 ${JSON.stringify(value)} —— JSX 要渲染 copy.${field}`
  )
}

console.log('product studio checks passed')
