import assert from 'node:assert/strict'
import {
  RECREATE_FOCUS,
  RECREATE_FOCUS_OPTIONS,
  RECREATE_NOTE_MAX,
  buildReferenceRecreatePrompt,
  canGenerateReferenceRecreate,
  recreateBlocker,
  recreateEditImages,
  recreateFocusLabel
} from '../src/services/reference-recreate.ts'

/**
 * 灵感复刻 · 纯函数单测
 * ------------------------------------------------------------------
 * 这里测的是**编排**，不是渲染。编排错了不会报错，只会出图不对：
 *   · 素材顺序反了 ⇒ 模型把参考图当产品，主体不是用户的产品
 *   · 提示词少了禁止项 ⇒ 参考图里的人物/Logo 被搬进结果
 *   · note 为空却输出了「补充说明：」⇒ 模型把它当成一条真实指令
 * 三种都是「看着像成功了」的失败，所以必须钉在测试里。
 *
 * 用法：npm run test:reference-recreate
 */

const product = { name: 'product.jpg', path: '/tmp/product.jpg', size: 11 }
const reference = { name: 'reference.jpg', path: '/tmp/reference.jpg', size: 22 }

const draft = (over = {}) => ({
  product,
  reference,
  focus: 'composition',
  note: '',
  rightsConfirmed: true,
  ...over
})

/* ---------------- 素材顺序：不可变约定 ---------------- */

assert.deepEqual(
  recreateEditImages({ product, reference, focus: 'composition', note: '' }),
  [product, reference],
  'editImages must receive [product, reference] — the prompt says 图一=产品 / 图二=参考'
)

// 顺序不能随 focus 变（将来有人「顺手」按 focus 重排就会红）
for (const focus of RECREATE_FOCUS) {
  assert.deepEqual(
    recreateEditImages({ product, reference, focus, note: '' }),
    [product, reference],
    `素材顺序不能随 focus(${focus}) 变化`
  )
}

/* ---------------- 门禁：三项缺一不可 ---------------- */

assert.equal(canGenerateReferenceRecreate(draft()), true, '两张图 + 权利确认齐了就该能生成')
assert.equal(canGenerateReferenceRecreate(draft({ product: null })), false, '缺产品图不能生成')
assert.equal(canGenerateReferenceRecreate(draft({ reference: null })), false, '缺参考图不能生成')
assert.equal(
  canGenerateReferenceRecreate(draft({ rightsConfirmed: false })),
  false,
  '没确认权利不能生成'
)

/* ---------------- 缺哪一项：顺序稳定，且与 canGenerate 同源 ---------------- */

assert.equal(recreateBlocker(draft()), null, '齐了就没有 blocker')
assert.equal(recreateBlocker(draft({ product: null })), 'product', '最先缺的是产品图')
assert.equal(
  recreateBlocker(draft({ product: null, reference: null, rightsConfirmed: false })),
  'product',
  '多项都缺时，按 产品 → 参考 → 确认 的固定顺序报第一个'
)
assert.equal(
  recreateBlocker(draft({ reference: null, rightsConfirmed: false })),
  'reference',
  '产品有了之后，先报参考图'
)
assert.equal(
  recreateBlocker(draft({ rightsConfirmed: false })),
  'rights',
  '两张图都齐了才报权利确认'
)

/**
 * ⚠️ 关键不变量：`recreateBlocker` 和 `canGenerateReferenceRecreate` 必须**永远一致**。
 * 两者不一致时，界面会出现「按钮能点但提示说缺图」或者反过来
 * 「提示齐了但按钮点不动」—— 而且不报错。这里把 8 种组合全枚举一遍。
 */
let combos = 0
for (const hasProduct of [true, false]) {
  for (const hasReference of [true, false]) {
    for (const confirmed of [true, false]) {
      const d = draft({
        product: hasProduct ? product : null,
        reference: hasReference ? reference : null,
        rightsConfirmed: confirmed
      })
      combos += 1
      assert.equal(
        recreateBlocker(d) === null,
        canGenerateReferenceRecreate(d),
        `两个判据在 product=${hasProduct} reference=${hasReference} rights=${confirmed} 下不一致`
      )
    }
  }
}
assert.equal(combos, 8, '组合枚举要覆盖 2×2×2')

/* ---------------- 标签与选项 ---------------- */

assert.equal(RECREATE_NOTE_MAX, 160, '补充说明上限是 160 字')
assert.deepEqual([...RECREATE_FOCUS], ['composition', 'lighting', 'palette'], '复刻重点就这三项')
assert.equal(recreateFocusLabel('composition'), '构图', '构图标签')
assert.equal(recreateFocusLabel('lighting'), '光影', '光影标签')
assert.equal(recreateFocusLabel('palette'), '色彩氛围', '色彩氛围标签')

assert.deepEqual(
  RECREATE_FOCUS_OPTIONS.map((o) => o.value),
  [...RECREATE_FOCUS],
  '选项必须由 RECREATE_FOCUS 派生 —— 各写一份的话，加维度时界面会静默漏掉它'
)
assert.deepEqual(
  RECREATE_FOCUS_OPTIONS.map((o) => o.label),
  ['构图', '光影', '色彩氛围'],
  '选项标签'
)

/* ---------------- 提示词 ---------------- */

const promptOf = (over = {}) =>
  buildReferenceRecreatePrompt({ product, reference, focus: 'composition', note: '', ...over })

const prompt = promptOf()

assert.match(prompt, /图一/, '必须点名图一')
assert.match(prompt, /图二/, '必须点名图二')
assert.match(prompt, /唯一的产品主体/, '图一必须是唯一产品主体')
assert.match(prompt, /轮廓、材质、包装比例与包装上可读的文字/, '产品要保留的要素要写全')

// 禁止项：参考图里的可识别内容不许进结果
assert.match(prompt, /人物/, '禁止项要含「人物」')
assert.match(prompt, /Logo/, '禁止项要含 Logo')
assert.match(prompt, /商标/, '禁止项要含「商标」')
assert.match(prompt, /不要逐像素照搬参考图/, '要明确「不是逐像素复制」')

// 只复刻选中的那一项：三个维度的说明互不串门
const FOCUS_MARK = { composition: '留白与视线的走向', lighting: '主光的方向与角度', palette: '饱和度与明度' }
for (const focus of RECREATE_FOCUS) {
  const p = promptOf({ focus })
  assert.match(p, new RegExp(recreateFocusLabel(focus)), `prompt 要含选中的标签「${recreateFocusLabel(focus)}」`)
  assert.match(p, new RegExp(FOCUS_MARK[focus]), `prompt 要含 ${focus} 的专属说明`)
  for (const other of RECREATE_FOCUS) {
    if (other === focus) continue
    assert.doesNotMatch(
      p,
      new RegExp(FOCUS_MARK[other]),
      `选了 ${focus} 就不该出现 ${other} 的说明（否则等于同时复刻两项）`
    )
  }
}

/* ---------------- 补充说明：为空时整段不许出现 ---------------- */

assert.doesNotMatch(prompt, /补充说明/, 'note 为空时不许出现「补充说明」这一段')
for (const bad of ['undefined', 'null', 'NaN']) {
  assert.doesNotMatch(prompt, new RegExp(bad), `prompt 里不许出现 ${bad}`)
}

const blank = promptOf({ note: '   \n  ' })
assert.doesNotMatch(blank, /补充说明/, 'note 只有空白字符时，等同没填')

const withNote = promptOf({ note: '换成清晨的窗边光线' })
assert.match(withNote, /补充说明：换成清晨的窗边光线/, '填了 note 就要原样带上')
assert.equal(withNote.trim(), withNote.trim(), 'note 两端的空白要被去掉')

console.log('reference recreate checks passed')
