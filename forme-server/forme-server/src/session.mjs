import crypto from 'node:crypto'
import { config } from './config.mjs'
import { unauthorized } from './http.mjs'
import { code2Session } from './wechat.mjs'
import { createSession, dropSession, getSession, read } from './store.mjs'

/**
 * 登录
 * ------------------------------------------------------------------
 * 小程序端只拿到临时 code；服务端用 code + AppSecret 调 code2Session
 * 换 openid 和 session_key，再签发一个自定义登录态（随机 token）返回。
 *
 * 为什么不能把 session_key 给小程序：session_key 是用户态签名密钥，
 * 泄露等于别人可以冒充这个用户签名支付。
 */

function userIdFromOpenid(openid) {
  return `u_${crypto.createHash('sha256').update(openid).digest('hex').slice(0, 16)}`
}

export async function login(code) {
  const { openid, sessionKey } = await code2Session(code)
  const userId = userIdFromOpenid(openid)
  const isNew = !read((s) => Boolean(s.accounts[userId]))

  const session = await createSession({ userId, openid, sessionKey })

  return {
    token: session.token,
    expiresIn: config.sessionTtl,
    user: {
      id: userId,
      openid,
      isNew
    }
  }
}

export async function logout(token) {
  await dropSession(token)
  return { ok: true }
}

function extractToken(req) {
  const header = req.headers.authorization ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1] ?? ''
}

/** 必须登录的接口用这个 */
export function authenticate(req) {
  const token = extractToken(req)
  const session = getSession(token)
  if (!session) throw unauthorized()
  return session
}

/** 可选登录（比如 mock 模式下的调试接口） */
export function optionalSession(req) {
  return getSession(extractToken(req))
}
