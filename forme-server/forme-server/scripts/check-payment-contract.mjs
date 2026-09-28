import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forme-payment-contract-'))
Object.assign(process.env, { NODE_ENV: 'test', DATA_DIR: dataDir, MOCK_WECHAT: '0', WECHAT_APP_KEY: 'contract-test-key', WECHAT_ENV: '0', INITIAL_BALANCE: '0', ALERT_WEBHOOK_URL: '' })
const { config } = await import('../src/config.mjs')
// A local .env must never send alerts or select real service endpoints during this test.
config.alert.webhookUrl = ''
const { createOrder, getOrder, getAccount } = await import('../src/store.mjs')
const { verifiedPaidOrder, queryUserOrder, sweepUndeliveredOrders, handleXpayNotify } = await import('../src/pay.mjs')
const { sellablePlans } = await import('../src/catalog.mjs')
assert.deepEqual(sellablePlans().map(({ planId, priceFen, points, durationDays }) => [planId, priceFen, points, durationDays]), [
  ['pass-starter', 3000, 26, 30], ['pass-pro', 10000, 88, 30],
  ['points-100', 10000, 88, 0], ['points-500', 50000, 440, 0]
])
// A pre-change order must still deliver its original 30 points.
const local = { planId: 'pass-starter', outTradeNo: 'Tcontract00001', userId: 'contract-user', openid: 'contract-openid', priceFen: 3000, points: 30, status: 'pending', createdAt: new Date().toISOString() }
const official = { errcode: 0, order: { order_id: local.outTradeNo, status: 2, order_type: 0, env_type: 1, order_fee: 3000, left_fee: 3000, wx_order_id: 'wx-contract-001' } }
let payload = structuredClone(official)
let failAck = true
let queryCalls = 0
let ackCalls = 0
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input)
  if (url.pathname === '/cgi-bin/token') return Response.json({ access_token: 'contract-token', expires_in: 7200 })
  if (url.pathname === '/xpay/query_order') {
    queryCalls++
    assert.equal(options.method, 'POST')
    assert.equal(url.searchParams.get('access_token'), 'contract-token')
    const expected = crypto.createHmac('sha256', 'contract-test-key').update('/xpay/query_order&' + options.body).digest('hex')
    assert.equal(url.searchParams.get('pay_sig'), expected)
    assert.equal(options.headers.pay_sig, undefined)
    assert.deepEqual(JSON.parse(options.body), { openid: local.openid, env: 0, order_id: local.outTradeNo })
    return Response.json(payload)
  }
  if (url.pathname === '/xpay/notify_provide_goods') {
    ackCalls++
    assert.deepEqual(JSON.parse(options.body), { order_id: local.outTradeNo, env: 0 })
    return Response.json(failAck ? { errcode: -1 } : { errcode: 0 })
  }
  throw new Error('Unexpected network request')
}

try {
  for (const status of [0, 1, 5, 6, 7, 8, 9, 10]) {
    assert.equal(verifiedPaidOrder({ ...official, order: { ...official.order, status } }, local), null)
  }
  for (const status of [2, 3, 4]) {
    assert.ok(verifiedPaidOrder({ ...official, order: { ...official.order, status } }, local))
  }
  for (const mismatch of [{ order_id: 'other' }, { order_fee: 1 }, { left_fee: 1 }, { wx_order_id: '' }, { order_type: 1 }, { env_type: 2 }]) {
    assert.equal(verifiedPaidOrder({ ...official, order: { ...official.order, ...mismatch } }, local), null)
  }
  assert.equal(verifiedPaidOrder({ errcode: 0, order_status: 1 }, local), null)
  assert.equal(verifiedPaidOrder({ ...official, errcode: -1 }, local), null)
  assert.ok(verifiedPaidOrder({ ...official, order: { ...official.order, order_type: 7 } }, local))

  await createOrder(local)
  payload.order.status = 1
  await queryUserOrder({ userId: local.userId, outTradeNo: local.outTradeNo })
  assert.equal(getOrder(local.outTradeNo).status, 'pending')
  payload.order.status = 2
  await queryUserOrder({ userId: local.userId, outTradeNo: local.outTradeNo })
  assert.equal(getAccount(local.userId).balance, 30)
  assert.equal(getOrder(local.outTradeNo).wxOrderId, official.order.wx_order_id)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'))).orders[local.outTradeNo].providerAckPending, true)
  failAck = false
  await sweepUndeliveredOrders()
  assert.equal(getOrder(local.outTradeNo).providerAckPending, false)
  assert.equal(getAccount(local.userId).balance, 30)
  assert.equal(queryCalls, 2)
  assert.equal(ackCalls, 2)
  // Duplicate platform ID must not get a successful delivery acknowledgement.
  const other = { ...local, outTradeNo: 'Tcontract00002', status: 'pending' }
  await createOrder(other)
  payload = { ...official, order: { ...official.order, order_id: other.outTradeNo } }
  globalThis.fetch = async (input) => {
    assert.equal(new URL(input).pathname, '/xpay/query_order')
    return Response.json(payload)
  }
  const reply = await handleXpayNotify(`<xml><Event>xpay_goods_deliver_notify</Event><OutTradeNo>${other.outTradeNo}</OutTradeNo></xml>`)
  assert.match(reply, /<ErrCode>1<\/ErrCode>/)
  assert.equal(getOrder(other.outTradeNo).status, 'pending')
  assert.equal(getAccount(local.userId).balance, 30)
  console.log('Payment contract passed: official response, unpaid rejection, signature query, durable acknowledgement retry, duplicate protection')
} finally {
  globalThis.fetch = originalFetch
  fs.rmSync(dataDir, { recursive: true, force: true })
}
