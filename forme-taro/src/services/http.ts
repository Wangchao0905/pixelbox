import Taro from '@tarojs/taro'
import { apiUrl, toApiError } from './api-error'
import { clearSession, ensureSession } from './session'

/**
 * HTTP 封装
 * ------------------------------------------------------------------
 * 只做三件事：带登录态、发请求、把错误信封转成 ApiError。
 * 业务分支一律靠 `error.code`，不要去匹配 message 文案——
 * 文案会改，code 不会。
 */

export { ApiError, apiUrl } from './api-error'

type RequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE'
  data?: Record<string, unknown>
  /** 生成类接口要给足，默认 15s 对出图不够 */
  timeout?: number
  /** 内部使用：避免 401 重试无限递归 */
  retried?: boolean
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', data, timeout = 15000, retried = false } = options
  const token = await ensureSession()

  const res = await Taro.request({
    url: apiUrl(path),
    method,
    data,
    timeout,
    header: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    }
  })

  if (res.statusCode >= 200 && res.statusCode < 300) {
    return res.data as T
  }

  // 登录态过期（服务端重启、token 被清）时自动重新登录并重放一次，
  // 让用户感觉不到。只重试一次，避免服务端持续 401 时打成死循环。
  if (res.statusCode === 401 && !retried) {
    clearSession()
    await ensureSession()
    return request<T>(path, { ...options, retried: true })
  }

  throw toApiError(res.statusCode, res.data)
}
