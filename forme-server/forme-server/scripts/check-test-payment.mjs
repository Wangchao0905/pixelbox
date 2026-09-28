import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const run = (env) => spawnSync(process.execPath, ['--input-type=module', '-e', `
  const { sellablePlans, findPlan, isTestPaymentOpenid } = await import('./src/catalog.mjs')
  const test = findPlan('test-1yuan-20260924')
  if (process.env.TEST_PAYMENT_ENABLED === '1') {
    if (!test || test.priceFen !== 100 || test.productId !== 'forme_test') process.exit(2)
    if (sellablePlans().some(p => p.planId === test.planId)) process.exit(3)
    if (!sellablePlans({ includeTest: isTestPaymentOpenid('openid-test') }).some(p => p.planId === test.planId)) process.exit(4)
  } else if (test || sellablePlans().some(p => p.planId === 'test-1yuan-20260924')) process.exit(5)
`], { cwd: root, env: { ...process.env, NODE_ENV: 'test', MOCK_WECHAT: '1', DATA_DIR: '', TEST_PAYMENT_OPENIDS: 'openid-test', ...env } })

let result = run({ TEST_PAYMENT_ENABLED: '0' })
assert.equal(result.status, 0, result.stderr)
result = run({ TEST_PAYMENT_ENABLED: '1', TEST_PAYMENT_PRODUCT_ID: 'forme_test' })
assert.equal(result.status, 0, result.stderr)
console.log('临时 1 元支付通道测试通过：默认关闭、白名单目录可见、非白名单目录隐藏、关闭后立即下架。')
