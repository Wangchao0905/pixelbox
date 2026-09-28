/**
 * 无真机量页面：把**编译产物** `dist/app.wxss` 的 rpx 按 designWidth=393 换回 px，
 * 用产物里的真实 class 搭出页面，在 393px 视口里渲染，截图 + 打印关键尺寸。
 *
 * 为什么不用开发者工具：沙箱里没有微信开发者工具，也没有真机。
 * 「看着差不多」不算证据 —— 这里用的是打包出来给微信的那份样式本身。
 *
 * 用法：node scripts/measure-page.mjs <页面> [输出目录]
 *       页面：result | create-poster        （见下面的 PAGES）
 * 依赖：从 work/visual-studio 借 playwright（本工程没装，用 PLAYWRIGHT_FROM 指别处）。
 */
import { readFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

// ⚠️ 不能用 `new URL('.', import.meta.url).pathname`：路径里的空格会被编码成 %20，
//    而 node 不会替你解回来（本机路径正好含空格，踩过）。
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DESIGN_WIDTH = 393
const RPX = DESIGN_WIDTH / 750

const page = process.argv[2] ?? 'result'
const OUT = process.argv[3] ?? join(ROOT, 'ui-preview')
const DIST = process.env.MEASURE_DIST ?? join(ROOT, 'dist')

/**
 * playwright 从 `work/visual-studio` 借（本工程没装，也不想为几张截图装一份）。
 * 路径写死是为了本机跑得起来；换了目录用 `PLAYWRIGHT_FROM` 指过去。
 */
const PW_FROM =
  process.env.PLAYWRIGHT_FROM ??
  'file:///C:/Users/Sunyan win/Documents/Codex/2026-09-13/wo/work/visual-studio/package.json'
let chromium
try {
  ;({ chromium } = createRequire(PW_FROM)('@playwright/test'))
} catch (cause) {
  console.error(`借不到 playwright（${PW_FROM}）：${cause.message}`)
  console.error('设 PLAYWRIGHT_FROM=<某个装了 @playwright/test 的 package.json> 再跑。')
  process.exit(1)
}

/* ---------- 产物样式：rpx → px ---------- */
const wxss = readFileSync(join(DIST, 'app.wxss'), 'utf8')
const rpxCount = (wxss.match(/[\d.]+rpx/g) ?? []).length
const css = wxss.replace(/([\d.]+)rpx/g, (_, n) => `${(Number(n) * RPX).toFixed(4)}px`)

/* 真实设备上没有安全区时 env() 取 0；沙箱里它解析不到，
   而 `.page-pad` 的 padding 是 `calc(… + var(--safe-b))` —— 解析不到会**整条简写被丢弃**
   （老铁律 #2）。所以这里显式给 0px，否则量出来的容器宽度是错的。 */
const HARNESS_CSS = `
page { display: block; width: 100%; min-height: 100vh; --safe-b: 0px; --safe-t: 0px; }
* { box-sizing: border-box; }
`

/* 用内联 SVG 当占位图，不依赖网络 */
const swatch = (hue, w = 360, h = 430) =>
  `data:image/svg+xml;utf8,` +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
       <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0" stop-color="hsl(${hue},55%,42%)"/>
         <stop offset="1" stop-color="hsl(${(hue + 60) % 360},45%,18%)"/>
       </linearGradient></defs>
       <rect width="${w}" height="${h}" fill="url(#g)"/>
       <text x="24" y="${h - 38}" font-family="monospace" font-size="20" fill="rgba(255,255,255,.75)">${hue}°</text>
     </svg>`
  )

const header = (title) =>
  `<div class="app-header"><div class="header-back">‹</div><div class="header-title">${title}</div><div class="header-side"></div></div>`

/** 下拉框。`.select-field` 来自公共组件 `SelectField`，本页 chunk 里没有，手搭 */
const select = (value, compact) =>
  `<div class="select-field ${compact ? 'is-compact' : ''}"><span class="select-value">${value}</span><span class="select-caret">▾</span></div>`

/* ================================================================
   各页面的 mock。
   ⚠️ 这些 DOM 是**手搭的**，所以下面有一道「没漂」的自证：把产物 chunk 里的
      `className` 全抽出来，要求 mock 里每一个都能找到。
   ================================================================ */

/** 结果页。`multiple` 为 false 时**不渲染**缩略条和序号角标 —— 与 index.tsx 同构 */
function resultPage({ multiple }) {
  const variants = multiple ? [swatch(28), swatch(96), swatch(168), swatch(232)] : [swatch(28)]
  return `
<page><div class="app-screen page-pad result-screen">
  ${header('生成结果')}
  <div class="result-intro">
    <div class="eyebrow">${multiple ? `${variants.length} DIRECTIONS GENERATED` : 'IMAGE GENERATED'}</div>
    <div class="h2">${multiple ? '选一个你喜欢的方向' : '这是你的作品'}</div>
    <div class="result-copy">自由生图 · Sunburst</div>
  </div>
  <div class="result-stage">
    <img class="result-img" src="${variants[0]}" alt="" />
    <div class="aigc-badge is-top-left">AI 生成</div>
    ${multiple ? `<div class="result-stage-badge">01 / 0${variants.length}</div>` : ''}
  </div>
  ${
    multiple
      ? `<div class="result-strip">${variants
          .map(
            (src, i) =>
              `<div class="result-thumb ${i === 0 ? 'is-selected' : ''}"><img class="result-img" src="${src}" alt="" />${
                i === 0 ? '<div class="result-check">✓</div>' : ''
              }</div>`
          )
          .join('')}</div>`
      : ''
  }
  <div class="result-actions">
    <div class="secondary-button">继续编辑</div>
    <div class="primary-cta export-button">导出图片</div>
  </div>
  <div class="recharge-footnote">本次生成已存入资产库</div>
</div></page>`
}

/**
 * 字段式海报页。
 * ⚠️ 2026-09-27 重写过一次：这一页的布局从「preview-panel + structured-intro +
 *    structured-section」改成了与 `create-freeform` 同构的三层结构
 *    （composer-page-head + input-card + settings-card + dock），
 *    mock 必须跟着走 —— 不跟的话这道漂移自检会**报出缺失类**（不会静默出图）。
 * 原来那两个 state（`lockSuffix` 的「改前还在印像素 / 改后」）是 2026-09-21
 * 那次 A/B 留下的，现在只剩一种形态，合成一个 state。
 */
function posterPage() {
  const pill = (label, selected) => `<div class="pill ${selected ? 'is-selected' : ''}">${label}</div>`
  return `
<page><div class="app-screen create-content page-pad has-dock page-enter">
  ${header('字段式海报')}
  <div class="composer-page-head is-thumbed">
    <div class="composer-page-thumb"><img class="composer-page-thumb-img" src="${swatch(150, 192, 192)}" alt="" /></div>
    <div class="composer-page-heading">
      <div class="composer-overline">EDITABLE POSTER SYSTEM</div>
      <div class="composer-page-title">填入内容，保持风格。</div>
      <div class="composer-page-copy">只需填写主题与标题，构图、材质、排版和禁用项会自动保留。</div>
    </div>
  </div>
  <div class="composer-scroll">
    <div class="input-card composer-surface">
      <div class="composer-section-title">
        <div><span>海报方向</span><span class="composer-section-note">可复用模板 · Poster Editorial</span></div>
        <span>杂志编辑</span>
      </div>
      ${select('01 · 杂志编辑 — Poster Editorial')}
      <div class="structured-grid">
        <label class="structured-field"><span>主题描述</span><input class="field-input" value="春季新品发布" /></label>
        <label class="structured-field"><span>标题</span><input class="field-input" value="BOTANICAL" /></label>
      </div>
      <div class="structured-lock"><span class="lock-icon">✦</span><span>构图与负面提示词已锁定</span></div>
    </div>
    <div class="settings-card">
      <div class="settings-header composer-toolbar">
        <span>输出设置</span>
        <div class="settings-badge">4:5 · 自动 · Sunburst</div>
      </div>
      <div class="composer-settings-panel is-expanded">
        <div class="option-row"><span class="option-label">画面比例</span><div class="option-pills">${pill('4:5', true)}${pill('1:1')}</div></div>
        <div class="option-row"><span class="option-label">模型</span><div class="option-pills">${pill('Sunburst', true)}${pill('Flare')}</div></div>
        <div class="option-row"><span class="option-label">清晰度</span><div class="option-pills">${pill('自动', true)}${pill('标准')}</div></div>
      </div>
    </div>
    <div class="back-home-link"><span>返回模板库</span></div>
  </div>
  <div class="generate-dock">
    <div class="dock-meta"><span>预计消耗</span><strong class="dock-cost"><span class="cost-mark">✦</span>0.4 点</strong></div>
    <div class="primary-cta generate-cta">生成</div>
  </div>
</div></page>`
}

/**
 * 充值中心。结构与 `pages/recharge/index.tsx` 的 `PlanCard` 同构 ——
 * ⚠️ 尤其是圆点的位置：它现在是 `.plan-card-main` 的**第三个子项**（在流里），
 *    不是卡片右下角的绝对定位元素。mock 必须跟着这个结构走，否则量出来的间隙是假的。
 */
function rechargePage({ selected }) {
  const card = (name, detail, price, isSelected, badge) => `
    <div class="plan-card ${isSelected ? 'is-selected' : ''}">
      <div class="plan-card-top">
        <div class="eyebrow">POINTS</div>
        ${badge ? `<div class="plan-badge">${badge}</div>` : ''}
      </div>
      <div class="plan-card-main">
        <div class="plan-copy">
          <div class="plan-name">${name}</div>
          <div class="plan-detail">${detail}</div>
        </div>
        <div class="plan-price">${price}</div>
        <div class="plan-radio">${isSelected ? '✓' : ''}</div>
      </div>
    </div>`
  return `
<page><div class="app-screen page-pad">
  ${header('充值中心')}
  <div class="recharge-balance">
    <div class="balance-main">
      <div class="eyebrow">CURRENT BALANCE</div>
      <div class="balance-value"><span class="balance-mark">✦</span> 12 点</div>
      <div class="balance-note">每张图片消耗 0.4 点 · 充值价 ¥1/点</div>
    </div>
    <div class="balance-orb">✦</div>
  </div>
  <div class="recharge-heading">
    <div class="eyebrow">CHOOSE YOUR RHYTHM</div>
    <div class="h1"><span class="line">为下一组想法</span><span class="line accent">补充一点能量。</span></div>
    <div class="recharge-copy">每张图片消耗 0.4 点，1 点充值价 ¥1；创作权益为一次性购买，有效期 30 天。</div>
  </div>
  <div class="plan-section">
    <div class="plan-section-title"><div class="h2">点数充值</div><div class="plan-caption">一次性购买 · 点数不过期</div></div>
    <div class="plan-list">
      ${card('100 点', '一次性到账 · 约 250 张图片', '¥100.00', false, '')}
      ${card('30 点', '一次性到账 · 约 75 张图片', '¥30.00', selected, 'POPULAR')}
    </div>
  </div>
  <div class="primary-cta recharge-cta"><span>继续</span><span class="cta-price">¥30.00</span></div>
  <div class="recharge-footnote">点数不过期 · 支付由微信安全保障</div>
</div></page>`
}

const PAGES = {
  result: {
    chunk: 'pages/result/index.js',
    height: 780,
    states: [
      { name: 'n1', label: '1 张', build: () => resultPage({ multiple: false }) },
      { name: 'n4', label: '4 张', build: () => resultPage({ multiple: true }) }
    ]
  },
  'create-poster': {
    chunk: 'pages/create-poster/index.js',
    // 2026-09-27 改版后这一页短了很多（页头 ~140 + 输入卡 ~200 + 设置卡 ~150 + 生成条）。
    // 视口给矮了会把设置卡切掉，而这次要看的正是它。
    height: 1000,
    // 原来两个 state（lockSuffix 的「改前还在印像素 / 改后」）是 2026-09-21 那次
    // A/B 留下的，现在只剩一种形态，合成一个。
    states: [{ name: 'default', label: '默认（设置展开）', build: () => posterPage() }]
  },
  /**
   * 充值中心（2026-09-24 真机验收后加的）。这一页专门用来量两处**看不见的错**：
   *   ① 方案卡的选中圆点是否还压在价格上 —— 量「价格右边缘 → 圆点左边缘」的间隙；
   *   ② 充值按钮的文字是否居中 —— 量两段文字之间的间隙。
   *      居中时应等于 flex 的 `gap: 9px`；被 `margin-left: auto` 拉开时是几百 px。
   * 两个都是「不报错、不崩、typecheck 全绿」的错，只能靠数字说话。
   */
  recharge: {
    chunk: 'pages/recharge/index.js',
    height: 1000,
    states: [
      { name: 'unselected', label: '未选中', build: () => rechargePage({ selected: false }) },
      { name: 'selected', label: '已选中', build: () => rechargePage({ selected: true }) }
    ]
  }
}

const spec = PAGES[page]
if (!spec) {
  console.error(`不认识的页面「${page}」。可选：${Object.keys(PAGES).join(' / ')}`)
  process.exit(1)
}

/* ---------- 先证明 mock 没漂，再截图 ---------- */
/** 漂移判据。抽成纯函数，好在下面直接喂假输入自测 —— 不然它只是「看起来在检查」 */
function findMissingClasses(classes, mock, notRendered) {
  return classes.filter(
    (name) => !notRendered.has(name) && !mock.includes(`class="${name}`) && !mock.includes(` ${name}`)
  )
}

const chunk = readFileSync(join(DIST, spec.chunk), 'utf8')
const literalClasses = [...chunk.matchAll(/className:"([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean)

/**
 * 本脚本**不渲染**的类，逐条写明为什么不渲染。
 * 必须显式列出来 —— 否则就成了「装作覆盖了」。
 */
const NOT_RENDERED = new Map([
  ['is-disabled', '「保存中」/「生成中」的按钮态，本次不看'],
  ['empty-assets', '结果页空态（拿不到生成结果时）整块，本次不看'],
  ['empty-copy', '同上'],
  ['empty-mark', '同上'],
  ['empty-title', '同上']
])

const mockSource = spec.states.map((state) => state.build()).join('\n')

/**
 * 判据自测（2026-09-21 那次「两边都没读到 === 两边都一样」的教训）：
 * ① 先断言**真的抽到了预期条数** —— 正则写坏时抽到 0 个，漂移检查会「空着通过」；
 * ② 再喂一个必然不存在的类，确认它**真的会被报出来**（不是无条件返回空数组）。
 */
if (literalClasses.length < 20) {
  console.error(`\n❌ 判据瞎了：只从产物里抽出 ${literalClasses.length} 个 class（预期 ≥ 20）。`)
  console.error('   正则或产物结构变了 —— 这条检查现在是空转，别把它当成通过。')
  process.exit(1)
}
/**
 * ⚠️ 探针必须**单独喂**（2026-09-27 修的）。
 * 原来写的是 `findMissingClasses([...literalClasses, PROBE], ...)` —— 探针和真类
 * 混在一个数组里数「缺失数」。于是 mock 一漂、`literalClasses` 里多出 N 个
 * 缺失的类，这个数就变成 N+1 ≠ 1：**本该报「mock 漂开了」，却报成「判据瞎了」。**
 * 2026-09-27 改海报页布局时就是这么被误导了一次 —— 错误归因比不报还难查。
 */
const PROBE_CLASS = 'this-class-does-not-exist'
if (findMissingClasses([PROBE_CLASS], mockSource, NOT_RENDERED).length !== 1) {
  console.error('\n❌ 判据瞎了：喂一个不存在的 class 却没报出来。')
  process.exit(1)
}

const missing = findMissingClasses(literalClasses, mockSource, NOT_RENDERED)
console.log(`页面：${page}    产物：${DIST}`)
console.log(`产物 chunk 里的 class：${literalClasses.length} 个（另 ${NOT_RENDERED.size} 个刻意不渲染，见脚本内说明）`)
console.log('✓ 判据自测通过（抽到了预期条数；喂假 class 能报出来）')
if (missing.length) {
  console.error(`\n❌ mock 和真实页面漂开了，缺这些 class：${missing.join('、')}`)
  console.error('   这张图不能信 —— 先把 mock 补成和产物一致，再跑。')
  process.exit(1)
}
console.log('✓ mock 覆盖了产物里的每一个 class（漂了会在这里报错，不会悄悄出一张看着正常的图）')
console.log('  ⚠️ app-header / option-pills / select-field / generate-dock 等来自公共组件，')
console.log('     它们的 class 在本页 chunk 里没有，是按组件源码手搭的，这道检查覆盖不到。\n')

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: DESIGN_WIDTH, height: spec.height },
  deviceScaleFactor: 3
})

console.log(`rpx 换算：${rpxCount} 处，1rpx = ${RPX.toFixed(6)}px（designWidth=${DESIGN_WIDTH}）\n`)
/** 量出来的问题攒到这里，全部量完再一次性判 —— 免得第一个状态就退出，后面没量到 */
const overlaps = []
for (const state of spec.states) {
  const p = await ctx.newPage()
  await p.setContent(
    `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${css}</style><style>${HARNESS_CSS}</style></head><body style="margin:0">${state.build()}</body></html>`,
    { waitUntil: 'load' }
  )
  await p.waitForTimeout(120)

  const measured = await p.evaluate(() => {
    const q = (sel) => document.querySelector(sel)
    const box = (sel) => {
      const el = q(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return `${+r.width.toFixed(1)} × ${+r.height.toFixed(1)}`
    }
    /** 四边坐标（保留 1 位）——「压没压住」只能靠坐标说话，不能靠眼睛 */
    const rect = (sel) => {
      const el = q(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        l: +r.left.toFixed(1),
        r: +r.right.toFixed(1),
        t: +r.top.toFixed(1),
        b: +r.bottom.toFixed(1),
        w: +r.width.toFixed(1),
        h: +r.height.toFixed(1)
      }
    }
    const gen = q('.generate-cta')
    return {
      screen: box('.app-screen'),
      lock: q('.structured-lock')?.textContent ?? null,
      eyebrow: q('.eyebrow')?.textContent ?? null,
      h2: q('.h2')?.textContent ?? null,
      optionRows: [...document.querySelectorAll('.option-row')].map(
        (row) => `${row.querySelector('.option-label')?.textContent} → ${row.querySelector('.option-pills, .select-field')?.textContent}`
      ),
      stage: box('.result-stage'),
      strip: box('.result-strip'),
      dock: box('.generate-dock'),
      /* 2026-09-24 真机验收的三处修正，逐处给数字 */
      price: rect('.plan-price'),
      radio: rect('.plan-radio'),
      cta: rect('.recharge-cta'),
      ctaLabel: rect('.recharge-cta span:first-child'),
      ctaPrice: rect('.recharge-cta .cta-price'),
      genCta: rect('.generate-cta'),
      genCtaRadius: gen ? getComputedStyle(gen).borderRadius : null
    }
  })

  const file = join(OUT, `${page}-${state.name}.png`)
  await p.screenshot({ path: file })
  await p.close()

  console.log(`── ${state.label} ──`)
  console.log(`  容器           ${measured.screen}`)
  if (measured.eyebrow) console.log(`  eyebrow        ${JSON.stringify(measured.eyebrow)}`)
  if (measured.h2) console.log(`  h2             ${JSON.stringify(measured.h2)}`)
  if (measured.stage) console.log(`  大图           ${measured.stage}`)
  if (measured.strip) console.log(`  缩略条         ${measured.strip}`)
  for (const row of measured.optionRows) console.log(`  设置行         ${row}`)
  if (measured.lock) console.log(`  锁定行         ${JSON.stringify(measured.lock)}`)
  if (measured.dock) console.log(`  生成条         ${measured.dock}`)

  /**
   * 2026-09-24 真机验收的三处修正 —— 打印数字，并且**真的判定**：
   *   ① 价格与圆点的横向间隙必须 > 0（真机上原来圆点压在价格最后一位上）；
   *   ② 充值按钮两段文字的间隙必须 ≈ flex gap（居中）。被 `margin-left: auto`
   *      拉开时这个数是几百 px —— 那正是改之前的形状。
   *   ③ 生成按钮：宽 × 高 + 计算后的圆角，证明它进了包（源码写了 ≠ 打进包了）。
   */
  if (measured.price && measured.radio) {
    const gap = +(measured.radio.l - measured.price.r).toFixed(1)
    console.log(
      `  价格 → 圆点    间隙 ${gap}px（价格右 ${measured.price.r} / 圆点左 ${measured.radio.l}）` +
        (gap > 0 ? '' : '   ❌ 重叠')
    )
    if (gap <= 0) overlaps.push(`${page}/${state.name}：价格与圆点重叠 ${gap}px`)
  }
  if (measured.ctaLabel && measured.ctaPrice && measured.cta) {
    const inner = +(measured.ctaPrice.l - measured.ctaLabel.r).toFixed(1)
    console.log(
      `  充值按钮       ${measured.cta.w} × ${measured.cta.h}，两段文字间隙 ${inner}px` +
        `（居中应 ≈ 9px，即 flex gap）`
    )
    if (inner > 40) overlaps.push(`${page}/${state.name}：充值按钮的文字没有居中（间隙 ${inner}px）`)
  }
  if (measured.genCta) {
    console.log(`  生成按钮       ${measured.genCta.w} × ${measured.genCta.h}，圆角 ${measured.genCtaRadius}`)
  }

  console.log(`  截图           ${file}`)
  console.log()
}

await browser.close()

if (overlaps.length) {
  console.log('❌ 有元素叠在一起 / 文字没居中 —— 这几条都不报错，只能靠量：')
  for (const line of overlaps) console.log(`   · ${line}`)
  console.log()
  process.exit(1)
}
