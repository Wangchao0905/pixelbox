#!/usr/bin/env node
/**
 * 幂等键策略校验
 * ------------------------------------------------------------------
 * 直接 import 真实的 `src/services/request-key.ts`（Node 22 的类型擦除），
 * 测的是线上跑的同一份代码，不是它的复述。
 *
 * 背景：服务端的幂等是 requestId 维度的，重放同一个 id 不会重复扣费。
 * 但如果客户端每次调用都发新 id，这层保护就被架空 —— 用户网络超时后
 * 点一次「重试」就被多扣一次钱。这个脚本钉住「什么时候必须复用 id」。
 *
 * 用法：npm run check:request-key
 */

import { createRequestKeyStore, fingerprintOf } from '../src/services/request-key.ts'

let passed = 0
const failures = []

function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failures.push({ name, detail })
    console.log(`  ✗ ${name}`)
    if (detail) console.log(`      ${detail}`)
  }
}

/** 确定性生成器：让断言能直接比对具体值 */
function counterMint() {
  let n = 0
  return () => `key-${(n += 1)}`
}

const GENERATE = '/api/generate-image'
const EDIT = '/api/edit-image'

const baseRequest = {
  prompt: '雨夜便利店门口的柴犬',
  model: 'gpt-image-1',
  quality: 'auto',
  size: '1024x1024',
  n: 2
}

console.log('\n幂等键策略校验\n' + '─'.repeat(56))

console.log('\n1. 重试必须复用幂等键（本次修复的核心）')
{
  const store = createRequestKeyStore({ mint: counterMint() })
  const fp = fingerprintOf(GENERATE, baseRequest)

  const first = store.take(fp)
  // 请求失败 —— 没有 settle()，等价于抛错后什么都没标记
  const retry = store.take(fp)
  const retryAgain = store.take(fp)

  check('首次生成拿新键', first === 'key-1', `实际 ${first}`)
  check(
    '失败后重试复用同一个键',
    retry === first && retryAgain === first,
    `期望 key-1，实际 ${retry} / ${retryAgain} —— 不复用会导致重复扣费`
  )
}

console.log('\n2. 成功之后再来一次算「新的一批」，必须换新键')
{
  const store = createRequestKeyStore({ mint: counterMint() })
  const fp = fingerprintOf(GENERATE, baseRequest)

  const first = store.take(fp)
  store.settle(fp, first) // 成功了
  const second = store.take(fp)

  check('成功后换新键', second !== first, `两次都是 ${first}`)
}

console.log('\n3. 中间夹一次失败：失败后复用，成功后才换')
{
  const store = createRequestKeyStore({ mint: counterMint() })
  const fp = fingerprintOf(GENERATE, baseRequest)

  const a = store.take(fp) // 第 1 次，失败
  const b = store.take(fp) // 重试
  store.settle(fp, b) // 第 2 次成功
  const c = store.take(fp) // 用户又要一批
  store.settle(fp, c)
  const d = store.take(fp)

  check('失败 → 复用', a === b, `${a} vs ${b}`)
  check('成功 → 换新', c !== b, `${c} vs ${b}`)
  check('再次成功 → 再换新', d !== c, `${d} vs ${c}`)
}

console.log('\n4. 内容变了就是新的创作意图')
{
  const store = createRequestKeyStore({ mint: counterMint() })
  const original = fingerprintOf(GENERATE, baseRequest)
  const first = store.take(original)
  store.settle(original, first)

  const changedPrompt = store.take(fingerprintOf(GENERATE, { ...baseRequest, prompt: '换了提示词' }))
  const changedSize = store.take(fingerprintOf(GENERATE, { ...baseRequest, size: '1024x1280' }))
  const changedBatch = store.take(fingerprintOf(GENERATE, { ...baseRequest, n: 4 }))
  const changedPath = store.take(fingerprintOf(EDIT, baseRequest))

  check('改提示词换新键', changedPrompt !== first)
  check('改尺寸换新键', changedSize !== first && changedSize !== changedPrompt)
  check('改数量换新键', changedBatch !== first)
  check('换接口（生成→产品替换）换新键', changedPath !== first)
}

console.log('\n5. 指纹不该被无关字段影响')
{
  const withAsset = fingerprintOf(GENERATE, {
    ...baseRequest,
    asset: { title: '自由生图', skill: 'poster' }
  })
  const withoutAsset = fingerprintOf(GENERATE, baseRequest)

  check(
    'asset 元信息不进指纹',
    withAsset === withoutAsset,
    'asset 只是「要不要入库」的标记，不影响出图结果，' +
      '把它算进指纹会让「同一次重试」因为元信息不同而换键，幂等就失效了'
  )

  const withFileIds = fingerprintOf(EDIT, { ...baseRequest, fileIds: ['f_a'] })
  const otherFileIds = fingerprintOf(EDIT, { ...baseRequest, fileIds: ['f_b'] })
  check('产品替换的素材文件进指纹', withFileIds !== otherFileIds)

  // 自己拼分隔符的话 n: 2 与 n: '2' 会得到同一个指纹，两次不同的请求
  // 就被当成同一次（一个会白扣、一个会白拿）。JSON 序列化能区分类型。
  const numericN = fingerprintOf(GENERATE, { ...baseRequest, n: 2 })
  const stringN = fingerprintOf(GENERATE, { ...baseRequest, n: '2' })
  check('数字与同值字符串不混淆', numericN !== stringN, '两者相同说明指纹丢掉了类型信息')

  // 提示词里带分隔符/引号也不能让两个不同请求撞在一起
  const tricky = fingerprintOf(GENERATE, { ...baseRequest, prompt: 'a", "b' })
  const plain = fingerprintOf(GENERATE, { ...baseRequest, prompt: 'a' })
  check('提示词含引号不会串位', tricky !== plain)
}

console.log('\n6. 记录上限')
{
  const store = createRequestKeyStore({ limit: 3, mint: counterMint() })
  for (let i = 0; i < 10; i += 1) {
    store.take(fingerprintOf(GENERATE, { ...baseRequest, prompt: `提示词 ${i}` }))
  }
  check('超出上限后不再增长', store.size() <= 3, `实际 ${store.size()}`)
}

console.log('\n' + '─'.repeat(56))
if (failures.length) {
  console.log(`❌ ${passed} 项通过，${failures.length} 项失败\n`)
  process.exit(1)
}
console.log(`✅ ${passed} 项全部通过\n`)
