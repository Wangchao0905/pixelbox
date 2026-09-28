import crypto from 'node:crypto'
import { config } from './config.mjs'
import { ApiError } from './http.mjs'

/**
 * 微信服务端接口封装
 * ------------------------------------------------------------------
 * 所有 AppSecret / AppKey / sessionKey 都只在这里使用，绝不外泄到小程序。
 */

const API = 'https://api.weixin.qq.com'
/** B 端虚拟支付接口。官方文档给的是路径（/xpay/query_order），
 *  这里默认挂在 api.weixin.qq.com 下；如果后台给你的域名不同，
 *  用 WECHAT_XPAY_BASE 覆盖，不用改代码。 */
const XPAY = (process.env.WECHAT_XPAY_BASE || API).replace(/\/+$/, '')

async function getJson(url) {
  const response = await fetch(url, { method: 'GET' })
  return response.json()
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })
  return response.json()
}

function assertOk(payload, what) {
  if (payload && payload.errcode && payload.errcode !== 0) {
    throw new ApiError(502, `${what}失败：${payload.errmsg ?? payload.errcode}`, 'wechat_error', {
      errcode: payload.errcode
    })
  }
  return payload
}

/* ================================================================
   code2Session
   ================================================================ */

export async function code2Session(code) {
  if (!code) throw new ApiError(400, '缺少 code', 'missing_code')

  if (config.mockWechat) {
    // 开发模式：由 code 派生一个稳定的假 openid，同一个人重复登录拿到同一个账号
    const openid = `mock_${crypto.createHash('sha256').update(code).digest('hex').slice(0, 24)}`
    return { openid, sessionKey: crypto.createHash('sha256').update(`sk:${code}`).digest('hex').slice(0, 24), mocked: true }
  }

  const url = `${API}/sns/jscode2session?appid=${encodeURIComponent(config.wechat.appId)}&secret=${encodeURIComponent(config.wechat.appSecret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`
  const payload = assertOk(await getJson(url), 'code2Session')
  if (!payload.openid) throw new ApiError(502, 'code2Session 未返回 openid', 'wechat_error')
  return { openid: payload.openid, sessionKey: payload.session_key, unionid: payload.unionid }
}

/* ================================================================
   access_token（带缓存，微信限制每日获取次数）
   ================================================================ */

let tokenCache = { value: '', expiresAt: 0 }

export async function getAccessToken() {
  if (config.mockWechat) return 'mock-access-token'
  if (tokenCache.value && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value

  const url = `${API}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(config.wechat.appId)}&secret=${encodeURIComponent(config.wechat.appSecret)}`
  const payload = assertOk(await getJson(url), '获取 access_token')
  tokenCache = {
    value: payload.access_token,
    expiresAt: Date.now() + (Number(payload.expires_in) || 7200) * 1000
  }
  return tokenCache.value
}

/* ================================================================
   内容安全
   ================================================================ */

/** 文本检查。suggest: pass / review / risky */
export async function msgSecCheck(content, openid) {
  if (config.mockWechat) return { suggest: 'pass', mocked: true }
  const token = await getAccessToken()
  const payload = await postJson(`${API}/wxa/msg_sec_check?access_token=${token}`, {
    version: 2,
    openid,
    scene: 2, // 2 = 评论/资料类文本
    content
  })
  if (payload.errcode === 87014) return { suggest: 'risky', label: 20001 }
  assertOk(payload, '文本安全检查')
  return { suggest: payload.result?.suggest ?? 'pass', label: payload.result?.label }
}

/** 图片检查。errcode 87014 = 内容违规 */
export async function imgSecCheck(buffer, mime, filename = 'image.png') {
  if (config.mockWechat) return { ok: true, mocked: true }
  const token = await getAccessToken()
  const form = new FormData()
  form.append('media', new Blob([buffer], { type: mime }), filename)
  const response = await fetch(`${API}/wxa/img_sec_check?access_token=${token}`, {
    method: 'POST',
    body: form
  })
  const payload = await response.json()
  if (payload.errcode === 87014) return { ok: false, reason: '图片含违规内容' }
  assertOk(payload, '图片安全检查')
  return { ok: true }
}

/* ================================================================
   虚拟支付（B 端）
   ================================================================ */

/**
 * paySig 计算（官方 5.5 节）
 *   msg = uri + '&' + postBody
 *   paySig = HMAC-SHA256(AppKey, msg) 的 hex
 *
 * postBody 必须是**实际发出去的原始字符串**：不重新格式化、
 * 不改键顺序，否则签名对不上。所以下面 queryOrder 里先序列化一次，
 * 把同一个字符串同时用于签名和发送。
 */
export function calcPaySig(uri, postBody) {
  return crypto
    .createHmac('sha256', config.wechat.appKey)
    .update(`${uri}&${postBody}`)
    .digest('hex')
}

/** 用户态签名：HMAC-SHA256(sessionKey, signData) */
export function calcSignature(signData, sessionKey) {
  return crypto.createHmac('sha256', sessionKey).update(signData).digest('hex')
}

/** 兜底查单：POST /xpay/query_order */
export async function queryOrder({ openid, outTradeNo }) {
  if (config.mockWechat) {
    return { errcode: 0, errmsg: 'ok', order: { order_id: outTradeNo, status: 2, wx_order_id: `mock_${outTradeNo}` }, mocked: true }
  }
  const token = await getAccessToken()
  const uri = '/xpay/query_order'
  const body = JSON.stringify({
    openid,
    env: config.wechat.env,
    order_id: outTradeNo
  })
  const paySig = calcPaySig(uri, body)

  const response = await fetch(`${XPAY}${uri}?access_token=${encodeURIComponent(token)}&pay_sig=${paySig}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body,
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) throw new ApiError(502, '微信查单请求失败', 'wechat_error')
  return response.json()
}

/** 推送丢失后补发货，通知平台结束发货重试。 */
export async function notifyProvideGoods(outTradeNo) {
  if (config.mockWechat) return { errcode: 0 }
  const token = await getAccessToken()
  const response = await fetch(`${XPAY}/xpay/notify_provide_goods?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: outTradeNo, env: config.wechat.env }),
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) throw new ApiError(502, '微信发货确认失败', 'wechat_error')
  const result = await response.json()
  if (result.errcode !== 0) throw new ApiError(502, '微信发货确认未成功', 'wechat_error')
  return result
}
