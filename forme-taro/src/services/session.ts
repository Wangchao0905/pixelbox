import Taro from '@tarojs/taro'
import { APP_CONFIG, STORAGE_KEYS } from '@/config'
import { apiUrl, toApiError } from './api-error'

/**
 * 登录态
 * ------------------------------------------------------------------
 * wx.login() 只拿到临时 code，必须由服务端用 code + AppSecret 调
 * code2Session 换取 openid / session_key，再签发自定义登录态。
 * AppSecret 绝不能出现在小程序代码包里。
 */

export type SessionUser = {
  id: string
  openid: string
  isNew?: boolean
}

let tokenCache = ''
let inFlight: Promise<string> | null = null

export function getToken(): string {
  if (tokenCache) return tokenCache
  try {
    tokenCache = Taro.getStorageSync(STORAGE_KEYS.token) || ''
  } catch {
    tokenCache = ''
  }
  return tokenCache
}

function persist(token: string) {
  tokenCache = token
  try {
    Taro.setStorageSync(STORAGE_KEYS.token, token)
  } catch {
    // 缓存写不进去不影响本次会话，内存里的 token 仍然可用
  }
}

async function doLogin(): Promise<string> {
  const loginRes = await Taro.login()
  const code = loginRes?.code
  if (!code) throw new Error('wx.login 未返回 code')

  if (APP_CONFIG.useMockGeneration) {
    // 本地演示模式：不发请求，用 code 派生一个假 token，方便直接点通流程
    const mockToken = `demo-${code.slice(0, 10)}`
    persist(mockToken)
    return mockToken
  }

  const res = await Taro.request<{ token: string; user: SessionUser }>({
    url: apiUrl('/api/login'),
    method: 'POST',
    data: { code },
    timeout: 15000,
    header: { 'content-type': 'application/json' }
  })

  if (res.statusCode !== 200 || !res.data?.token) {
    throw toApiError(res.statusCode, res.data)
  }

  persist(res.data.token)
  return res.data.token
}

/**
 * 保证有登录态。
 * ------------------------------------------------------------------
 * 并发去重很重要：首页与充值页可能同时挂载，各自调一次 ensureSession，
 * 没有这个 inFlight 就会触发两次 wx.login、两次 code2Session。
 * 微信对 code2Session 有频率限制，且并发登录会互相覆盖 token。
 */
export function ensureSession(): Promise<string> {
  const cached = getToken()
  if (cached) return Promise.resolve(cached)
  if (inFlight) return inFlight

  inFlight = doLogin().finally(() => {
    inFlight = null
  })
  return inFlight
}

/** 强制重新登录，忽略本地缓存 */
export async function relogin(): Promise<string> {
  clearSession()
  return ensureSession()
}

export function clearSession() {
  tokenCache = ''
  inFlight = null
  try {
    Taro.removeStorageSync(STORAGE_KEYS.token)
  } catch {
    // ignore
  }
}
