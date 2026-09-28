import crypto from 'node:crypto'
import { config } from './config.mjs'
import { findPlan, isTestPaymentOpenid, isTestPlan } from './catalog.mjs'
import { notify } from './alert.mjs'
import { ApiError, badRequest, notFound } from './http.mjs'
import { calcPaySig, calcSignature, queryOrder, notifyProvideGoods } from './wechat.mjs'
import {
  createOrder,
  getOrder,
  listUndeliveredOrders,
  listUnconfirmedDeliveries,
  confirmDelivery,
  listUserOrders,
  read,
  refundOrder,
  settleOrder
} from './store.mjs'

/**
 * 微信虚拟支付（个人主体 · 道具直购）
 * ------------------------------------------------------------------
 * 依据官方文档：
 * https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person
 *
 * 三条链路：
 *   /pay/order  下单：生成 outTradeNo + signData + paySig + signature
 *   /pay/notify 发货推送 / 退款推送：解析 XML → 幂等 → 处理 → 回 XML
 *   /pay/query  兜底查单：query_order 补发货
 *
 * 发货依据只用平台数据，不用小程序端 success 回调：
 * 用户支付后异常退出会丢回调，拿回调当发货依据 = 漏发货。
 *
 * 关于「包月」：mode 固定 short_series_goods，没有续费字段，
 * 所以包月做成一次性购买的 N 天有效期道具（见 catalog.mjs 注释）。
 */

const XPAY_URI = 'requestVirtualPayment'

function newOutTradeNo() {
  // 8-32 位、不能以下划线开头、不可复用
  return `T${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`
}

/**
 * 构造 signData。
 * 字段顺序固定，且 JSON.stringify 的结果会原样用于两次签名——
 * 顺序一变签名就废，所以这里不要「顺手」重排字段。
 */
function buildSignData({ offerId, buyQuantity, productId, goodsPrice, outTradeNo, attach }) {
  return JSON.stringify({
    offerId,
    buyQuantity,
    env: config.wechat.env, // 固定 0（正式环境/现网）
    currencyType: 'CNY',
    productId,
    goodsPrice, // 单位：分，必须与 MP 后台道具价格一致
    outTradeNo,
    attach
  })
}

/* ================================================================
   下单
   ================================================================ */

export async function createPayOrder({ userId, openid, sessionKey, planId }) {
  const plan = findPlan(planId)
  if (!plan) throw badRequest(`未知的充值方案：${planId}`, 'unknown_plan')
  if (isTestPlan(planId) && !isTestPaymentOpenid(openid)) {
    throw new ApiError(403, '临时测试商品仅限授权测试用户', 'test_payment_forbidden')
  }
  if (!sessionKey) throw new ApiError(401, '缺少 session_key，请重新登录后再试', 'relogin_required')

  const outTradeNo = newOutTradeNo()
  const attach = userId
  const signData = buildSignData({
    offerId: config.wechat.offerId,
    buyQuantity: 1,
    productId: plan.productId,
    goodsPrice: plan.priceFen,
    outTradeNo,
    attach
  })

  const order = {
    outTradeNo,
    userId,
    openid,
    planId: plan.planId,
    kind: plan.kind,
    productId: plan.productId,
    points: plan.points,
    // 发货内容在**下单时快照**下来，发货时不再回查目录：
    // 目录会随运营改价改配置，订单必须自包含，否则老订单会按新配置发货
    durationDays: plan.durationDays ?? 0,
    priceFen: plan.priceFen,
    status: 'pending',
    attach,
    wxOrderId: '',
    createdAt: new Date().toISOString()
  }
  await createOrder(order)

  return {
    orderId: outTradeNo,
    planId: plan.planId,
    kind: plan.kind,
    points: plan.points,
    durationDays: order.durationDays,
    priceFen: plan.priceFen,
    payData: {
      signData,
      mode: 'short_series_goods',
      paySig: calcPaySig(XPAY_URI, signData),
      signature: calcSignature(signData, sessionKey)
    }
  }
}

/* ================================================================
   平台推送（发货 / 退款）
   ================================================================ */

/** 发货推送事件名 */
export const EVENT_DELIVER = 'xpay_goods_deliver_notify'
/** 退款推送事件名。Android 由我们主动发起，iOS 由用户向 App Store 申请 */
export const EVENT_REFUND = 'xpay_refund_notify'

/** 从 XML 里取字段，支持 <Tag><![CDATA[v]]></Tag> 与 <Tag>v</Tag> */
export function extractXmlField(xml, tag) {
  const pattern = new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`, 'i')
  const match = pattern.exec(xml)
  if (!match) return ''
  return (match[1] ?? match[2] ?? '').trim()
}

/**
 * 解析平台推送。
 * ------------------------------------------------------------------
 * 发货与退款通知的订单号字段不同：发货是 OutTradeNo，退款是 MchOrderId。
 *
 * 认不出订单时会把**原始 XML 打进日志**——等第一笔真实退款出现，
 * 照着日志补字段就行。比猜一个格式然后静默失败要好得多。
 */
export function parseXpayNotify(xml) {
  return {
    event: extractXmlField(xml, 'Event'),
    openid: extractXmlField(xml, 'OpenId') || extractXmlField(xml, 'FromUserName'),
    outTradeNo: extractXmlField(xml, 'OutTradeNo') || extractXmlField(xml, 'MchOrderId'),
    wxOrderId: extractXmlField(xml, 'WxOrderId'),
    mchOrderNo: extractXmlField(xml, 'MchOrderNo'),
    productId: extractXmlField(xml, 'ProductId'),
    quantity: Number(extractXmlField(xml, 'Quantity') || '0'),
    orderStatus: extractXmlField(xml, 'OrderStatus'),
    refundNo: extractXmlField(xml, 'WxRefundId') || extractXmlField(xml, 'MchRefundId') || extractXmlField(xml, 'RefundOrderId') || extractXmlField(xml, 'RefundNo'),
    refundReason: extractXmlField(xml, 'RefundReason') || extractXmlField(xml, 'Reason'),
    refundFee: extractXmlField(xml, 'RefundFee'),
    retCode: extractXmlField(xml, 'RetCode')
  }
}

export function notifyReply(errCode = 0, errMsg = 'success') {
  return `<xml><ErrCode>${errCode}</ErrCode><ErrMsg><![CDATA[${errMsg}]]></ErrMsg></xml>`
}

/* ================================================================
   消息推送 URL 验证握手
   ================================================================ */

/**
 * MP 后台【开发管理 → 消息推送】点「保存」时，微信会发一个 GET 到同一个
 * URL，带 signature / timestamp / nonce / echostr，要求**原样返回 echostr**。
 * 答不上来后台就报「配置失败」，发货推送与退款推送都永远配不上。
 *
 * 算法按官方文档：三个参数字典序排序 → 拼接 → sha1。
 * 用 JS 默认的 sort()：它按 UTF-16 码元比较，对 ASCII 的数字与字母
 * 与文档的 ASCII 序一致。已用文档里两组算例核对过（见 smoke 第 15 节），
 * 改这里之前先跑一遍那两组算例。
 */
export function msgPushSignature({ token, timestamp, nonce }) {
  return crypto
    .createHash('sha1')
    .update([token, timestamp, nonce].sort().join(''))
    .digest('hex')
}

/**
 * 定长比较，避免逐字符短路比较泄露签名。
 * 长度不同直接 false —— timingSafeEqual 要求等长，否则会抛异常。
 */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8')
  const right = Buffer.from(String(b ?? ''), 'utf8')
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

/**
 * 识别「后台配错了」的两种包体。
 * ------------------------------------------------------------------
 * 配错时症状完全一样：解析不出 OutTradeNo → 回 ErrCode=1 → 平台按
 * 15s/15s/30s/3m/10m/20m/30m/30m/30m/60m/3h/3h/3h/6h/6h 一直重试，
 * 而日志里只有一句「缺少 OutTradeNo」，真正的原因一个字都没有。
 * 这里把它翻成能直接照做的中文，省掉一轮「为什么收不到推送」的排查。
 */
export function detectPushMisconfig(rawBody) {
  const body = String(rawBody ?? '').trim()
  if (!body) return '推送包体是空的'

  if (body.startsWith('{') || body.startsWith('[')) {
    return '收到的是 JSON 包体。MP 后台「消息推送」的【数据格式】必须选 XML（本服务只解析 XML）'
  }
  if (/<Encrypt>/.test(body) || /<MsgSignature>/.test(body)) {
    return '收到的是加密包体。MP 后台「消息推送」的【消息加解密方式】必须选「明文模式」（本服务不做解密）'
  }
  return null
}

/* ================================================================
   发货
   ================================================================ */

/**
 * 发货（幂等）。
 * ------------------------------------------------------------------
 * 幂等与「点数到账 + 发放权益 + 改订单状态」三件事都收在 store.settleOrder
 * 的**单次原子写入**里。拆成多次写入的话，进程在中间崩掉会留下
 * 「订单仍 pending 但点数已加」的状态，平台重试就会重复加点。
 *
 * 幂等键用 wx_order_id（平台单号）：同一笔支付在平台侧可能推送多次，
 * 平台单号才是唯一真相。
 */
export async function deliverOrder({ outTradeNo, wxOrderId, source }) {
  const result = await settleOrder({ outTradeNo, wxOrderId: wxOrderId ?? '', source })

  if (!result.ok) {
    if (result.reason === 'unknown_order') {
      console.warn(`[pay] 收到未知订单的发货通知 outTradeNo=${outTradeNo}`)
    } else if (result.reason === 'wx_order_id_conflict') {
      console.error(
        `[pay] wx_order_id ${wxOrderId} 已绑定到其它订单，拒绝重复发货到 ${outTradeNo}`
      )
    } else if (result.reason === 'already_refunded') {
      console.warn(`[pay] 订单 ${outTradeNo} 已退款，拒绝发货`)
    }
    return result
  }

  if (result.already) return result

  const granted = []
  if (result.points > 0) granted.push(`+${result.points} 点`)
  if (result.durationDays > 0) granted.push(`+${result.durationDays} 天权益`)
  console.log(
    `[pay] 发货完成 outTradeNo=${outTradeNo} wx_order_id=${wxOrderId} ${granted.join(' ')}`
  )
  return result
}

/**
 * 处理发货推送
 * ------------------------------------------------------------------
 * 为什么还要查单交叉确认：
 * 路由先验消息签名；这里再查平台订单，核对状态、金额与平台单号后发货。
 */
async function handleDeliverNotify(notify) {
  if (!notify.outTradeNo) {
    console.warn('[pay] 发货推送缺少 OutTradeNo')
    return notifyReply(1, 'missing outTradeNo')
  }

  const order = getOrder(notify.outTradeNo)
  if (!order) {
    console.warn(`[pay] 发货推送指向未知订单 ${notify.outTradeNo}`)
    return notifyReply(1, 'unknown order')
  }

  if (order.status === 'delivered') {
    // 已发货，直接回成功，避免平台继续重试
    return notifyReply(0, 'already delivered')
  }
  if (order.status === 'refunded') {
    console.warn(`[pay] 订单 ${notify.outTradeNo} 已退款，忽略发货推送`)
    return notifyReply(0, 'refunded')
  }

  if (config.mockWechat) {
    const result = await deliverOrder({
      outTradeNo: notify.outTradeNo,
      wxOrderId: notify.wxOrderId || notify.mchOrderNo || `mock_${notify.outTradeNo}`,
      source: 'notify(mock)'
    })
    return notifyReply(result.ok ? 0 : 1, result.ok ? 'success' : 'delivery failed')
  }

  try {
    const queried = await queryOrder({ openid: order.openid, outTradeNo: notify.outTradeNo })
    if (queried?.errcode && queried.errcode !== 0) {
      console.error(`[pay] 查单失败 outTradeNo=${notify.outTradeNo} errcode=${queried.errcode}`)
      return notifyReply(1, 'query failed')
    }
    const paid = verifiedPaidOrder(queried, order)
    if (!paid) {
      console.warn(`[pay] 查单尚未确认支付 outTradeNo=${notify.outTradeNo} status=${queried?.order?.status}`)
      return notifyReply(1, 'not paid yet')
    }

    const result = await deliverOrder({
      outTradeNo: notify.outTradeNo,
      wxOrderId: paid.wx_order_id,
      source: 'notify+query'
    })
    return notifyReply(result.ok ? 0 : 1, result.ok ? 'success' : 'delivery failed')
  } catch (error) {
    console.error('[pay] 发货推送处理异常', error?.message)
    return notifyReply(1, 'internal error')
  }
}

/* ================================================================
   退款
   ================================================================ */

/**
 * 退款回收（幂等）。
 * ------------------------------------------------------------------
 * 外部通知必须先通过路由验签及 handleRefundNotify 的订单、金额校验。
 * 回收点数下限为 0，已消费的点数差额记录为 shortfall 并告警。
 */
export async function refundUserOrder({ outTradeNo, wxOrderId, reason, source }) {
  const result = await refundOrder({
    outTradeNo,
    wxOrderId: wxOrderId ?? '',
    reason: reason ?? ''
  })

  if (!result.ok) {
    console.warn(`[pay] 收到未知订单的退款通知 outTradeNo=${outTradeNo}`)
    return result
  }

  if (result.already) {
    console.log(`[pay] 订单 ${outTradeNo} 已是退款状态，忽略重复推送`)
    return result
  }

  console.log(
    `[pay] 退款处理 outTradeNo=${outTradeNo} 回收 ${result.clawedBack} 点（来源 ${source}）`
  )

  if (result.shortfall > 0) {
    // 点数已被花掉，收不回来 —— 这是真实亏损，必须推到人能看到的地方。
    // 只打日志等于没打：没人会主动翻服务器日志去发现一笔几十块的损失。
    notify('critical', '退款缺口', {
      outTradeNo,
      shortfall: `${result.shortfall} 点`,
      clawedBack: result.clawedBack,
      reason: reason || '(未提供)',
      source,
      action: '用户已消费这部分点数，需人工决定是否追损'
    })
  }
  if (!result.wasDelivered) {
    // 未发货就退款：什么都没损失，属于用户取消
    console.log(`[pay] 订单 ${outTradeNo} 在发货前被退款，无需回收`)
  }

  return result
}

function notifyAlertForRefund(event, detail) {
  notify('critical', event, { ...detail, action: '核对虚拟支付后台退款订单与服务端状态' })
}

async function handleRefundNotify(notify, rawBody) {
  if (!notify.outTradeNo) {
    console.warn('[pay] 退款推送缺少 OutTradeNo，原始内容：', rawBody)
    notifyAlertForRefund('退款通知缺少订单号', {})
    return notifyReply(1, 'missing outTradeNo')
  }

  const order = getOrder(notify.outTradeNo)
  if (!order) {
    console.warn(`[pay] 退款推送指向未知订单 ${notify.outTradeNo}，原始内容：`, rawBody)
    notifyAlertForRefund('退款通知找不到订单', { outTradeNo: notify.outTradeNo })
    return notifyReply(1, 'unknown order')
  }

  if (notify.retCode !== '0' || !/^\d+$/.test(notify.refundFee)) {
    console.warn(`[pay] 退款通知尚未成功或缺少金额 outTradeNo=${notify.outTradeNo}`)
    return notifyReply(1, 'refund not confirmed')
  }
  if (Number(notify.refundFee) !== order.priceFen || notify.openid !== order.openid ||
      (order.wxOrderId && notify.wxOrderId !== order.wxOrderId)) {
    console.error(`[pay] 退款通知与订单不匹配 outTradeNo=${notify.outTradeNo}`)
    notifyAlertForRefund('退款通知与订单不匹配', { outTradeNo: notify.outTradeNo, refundFee: notify.refundFee })
    return notifyReply(1, 'order mismatch')
  }

  try {
    await refundUserOrder({
      outTradeNo: notify.outTradeNo,
      wxOrderId: notify.wxOrderId,
      reason: notify.refundReason || notify.refundNo || '平台退款',
      source: 'notify'
    })
    return notifyReply(0, 'success')
  } catch (error) {
    console.error('[pay] 退款推送处理异常', error?.message)
    return notifyReply(1, 'internal error')
  }
}

/* ================================================================
   推送总入口
   ================================================================ */

export async function handleXpayNotify(rawBody) {
  // 先判「是不是后台配错了」。放在解析之前：这两种包体解析出来是空的，
  // 会走到「缺少 OutTradeNo」，把真正的原因盖掉。
  const misconfig = detectPushMisconfig(rawBody)
  if (misconfig) {
    console.error(`[pay] 消息推送配置有误：${misconfig}`)
    return notifyReply(1, 'misconfigured')
  }

  const notify = parseXpayNotify(rawBody)

  if (notify.event === EVENT_REFUND) {
    return handleRefundNotify(notify, rawBody)
  }

  if (notify.event && notify.event !== EVENT_DELIVER) {
    console.log(`[pay] 收到未知事件 ${notify.event}，已忽略。原始内容：`, rawBody)
    return notifyReply(0, 'ignored')
  }

  return handleDeliverNotify(notify)
}

/* ================================================================
   兜底查单
   ================================================================ */

/** 前端主动查询自己的订单状态 */
export async function queryUserOrder({ userId, outTradeNo }) {
  const order = getOrder(outTradeNo)
  if (!order) throw notFound('订单不存在')
  if (order.userId !== userId) throw new ApiError(403, '无权查看该订单', 'forbidden')

  if (order.status === 'pending' && !config.mockWechat) {
    // 用户刚付完就回来问，推送可能还没到：顺手查一次单
    await settleOne(order)
  }

  const fresh = getOrder(outTradeNo)
  return {
    orderId: fresh.outTradeNo,
    status: fresh.status,
    kind: fresh.kind ?? 'points',
    points: fresh.points,
    durationDays: fresh.durationDays ?? 0,
    priceFen: fresh.priceFen,
    planId: fresh.planId,
    wxOrderId: fresh.wxOrderId,
    createdAt: fresh.createdAt,
    deliveredAt: fresh.deliveredAt ?? null,
    refundedAt: fresh.refundedAt ?? null
  }
}

export function listOrders(userId, limit = 20) {
  return listUserOrders(userId, limit).map((order) => ({
    orderId: order.outTradeNo,
    planId: order.planId,
    kind: order.kind ?? 'points',
    status: order.status,
    points: order.points,
    durationDays: order.durationDays ?? 0,
    priceFen: order.priceFen,
    createdAt: order.createdAt,
    deliveredAt: order.deliveredAt ?? null,
    refundedAt: order.refundedAt ?? null
  }))
}

/** 官方 query_order 返回 order 对象；status=1 仅创建，2/3/4 才可发货。
 * https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_query_order
 */
export function verifiedPaidOrder(payload, localOrder) {
  const order = payload?.order
  if (payload?.errcode !== 0 || !order || ![2, 3, 4].includes(order.status)) return null
  if (order.order_id !== localOrder.outTradeNo || ![0, 7].includes(order.order_type) ||
      order.env_type !== 1 || order.order_fee !== localOrder.priceFen ||
      order.left_fee !== localOrder.priceFen || typeof order.wx_order_id !== 'string' || !order.wx_order_id) return null
  return order
}

async function acknowledgeDelivery(order) {
  try {
    await notifyProvideGoods(order.outTradeNo)
    await confirmDelivery(order.outTradeNo)
  } catch (error) {
    console.error(`[pay] 平台发货确认待重试 ${order.outTradeNo}`, error?.message)
  }
}

async function settleOne(order) {
  try {
    const queried = await queryOrder({ openid: order.openid, outTradeNo: order.outTradeNo })
    const paid = verifiedPaidOrder(queried, order)
    if (!paid) return false
    const result = await deliverOrder({
      outTradeNo: order.outTradeNo,
      wxOrderId: paid.wx_order_id,
      source: 'query-sweep'
    })
    if (!result.ok) return false
    await acknowledgeDelivery(order)
    return true
  } catch (error) {
    console.error(`[pay] 查单兜底失败 ${order.outTradeNo}`, error?.message)
    return false
  }
}

/**
 * 定时兜底：推送丢失时补发货。
 * 建议每 5 分钟跑一次（官方建议），启动时也会跑一次。
 */
export async function sweepUndeliveredOrders() {
  if (config.mockWechat) return { checked: 0, delivered: 0 }
  for (const order of listUnconfirmedDeliveries()) await acknowledgeDelivery(order)
  const orders = listUndeliveredOrders()
  let delivered = 0
  for (const order of orders) {
    // 只查 2 小时内的单，老单多半是用户放弃了支付
    const age = Date.now() - new Date(order.createdAt).getTime()
    if (age > 2 * 3600 * 1000) continue
    if (await settleOne(order)) delivered += 1
  }
  return { checked: orders.length, delivered }
}

export function startSweeper(intervalMs = 5 * 60 * 1000) {
  const timer = setInterval(() => {
    sweepUndeliveredOrders().catch((error) => console.error('[pay] 兜底查单异常', error?.message))
  }, intervalMs)
  timer.unref?.()
  return timer
}

/** 调试用：直接把订单标记为已支付并发货（mock 模式下的「模拟支付成功」） */
export async function mockPaidAndDeliver(outTradeNo) {
  if (!config.mockWechat) {
    throw new ApiError(403, 'mock 支付只在 MOCK_WECHAT=1 时可用', 'forbidden')
  }
  const order = getOrder(outTradeNo)
  if (!order) throw notFound('订单不存在')
  return deliverOrder({ outTradeNo, wxOrderId: `mock_${outTradeNo}`, source: 'mock' })
}

/**
 * 调试用：模拟一笔退款。
 * 真实退款推送无法在本地复现，没有这个入口回收逻辑就测不到。
 */
export async function mockRefundOrder(outTradeNo, reason = 'mock 退款') {
  if (!config.mockWechat) {
    throw new ApiError(403, 'mock 退款只在 MOCK_WECHAT=1 时可用', 'forbidden')
  }
  const order = getOrder(outTradeNo)
  if (!order) throw notFound('订单不存在')
  return refundUserOrder({
    outTradeNo,
    wxOrderId: order.wxOrderId || `mock_${outTradeNo}`,
    reason,
    source: 'mock'
  })
}

export function debugOrderSnapshot() {
  return read((s) => Object.values(s.orders).length)
}
