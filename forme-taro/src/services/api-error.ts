import { APP_CONFIG } from '@/config'

/**
 * 接口错误与地址拼接
 * ------------------------------------------------------------------
 * 单独成一个模块（不 import session / http）是为了打断循环依赖：
 * session 需要 ApiError，http 需要 session，如果错误类型也放在 http 里
 * 就会形成 http ⇄ session 的环。webpack 下循环依赖的表现是
 * 「某个导出在运行时是 undefined」，很难排查，所以这里主动拆开。
 */

export type ApiErrorInit = {
  code: string
  message: string
  status: number
  balance?: number
  required?: number
  imageCost?: number
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly balance?: number
  readonly required?: number
  readonly imageCost?: number

  constructor(init: ApiErrorInit) {
    super(init.message)
    this.name = 'ApiError'
    this.code = init.code
    this.status = init.status
    this.balance = init.balance
    this.required = init.required
    this.imageCost = init.imageCost
  }

  /** 点数不足：调用方应该引导充值，并把 required 展示给用户 */
  get isInsufficientBalance() {
    return this.code === 'insufficient_balance'
  }
  /** 登录态问题：http 层已经自动重试过一次，还失败就是真失败 */
  get isAuthError() {
    return this.status === 401
  }

  /** 上游抖动：可以提示用户重试 */
  get isRetryable() {
    return (
      this.code === 'upstream_error' ||
      this.code === 'upstream_unreachable' ||
      this.code === 'upstream_timeout' ||
      this.status >= 500
    )
  }
}

/**
 * 点数不足时返回「本次需要多少点」，否则返回 null。
 * ------------------------------------------------------------------
 * 调用方用它把 402 从普通错误里摘出来：不足走「去充值」行（可点跳充值页），
 * 而不是一句干巴巴的报错文字 —— 注册不送点之后，新用户第一次生成就会撞上
 * 余额不足，这里是第一个转化闭环，不能留死路。
 * 服务端没带 required 时按调用方传的 fallback（本次消耗）兜底。
 */
export function shortfallOf(cause: unknown, fallback: number): number | null {
  if (cause instanceof ApiError && cause.isInsufficientBalance) {
    if (typeof cause.required === 'number' && cause.required > 0) {
      // 服务端同时返回 required 和 balance：有部分余额时，真实差额 = required - balance
      const balance = typeof cause.balance === 'number' && cause.balance > 0 ? cause.balance : 0
      const shortfall = Number((cause.required - balance).toFixed(2))
      return shortfall > 0 ? shortfall : fallback
    }
    return fallback
  }
  return null
}

/**
 * 拼接口地址。
 * ------------------------------------------------------------------
 * path 必须自带开头的 `/`；apiBaseUrl 的结尾斜杠已在 config 里归一化掉
 * （否则会拼出 `https://a.com//api/health`，nginx 的 `location /api/` 匹配不到，
 * 表现为整站 404）。这里再兜一次是因为这个函数的失败代价太大：
 * 它一坏，**每一个**请求都 404，而且看起来像后端挂了。
 */
export function apiUrl(path: string) {
  const base = APP_CONFIG.apiBaseUrl.replace(/\/+$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

/** 把服务端的错误信封解析成 ApiError */
export function toApiError(statusCode: number, body: any): ApiError {
  return new ApiError({
    code: body?.code ?? 'unknown_error',
    message: body?.message ?? `服务端返回 HTTP ${statusCode}`,
    status: statusCode,
    balance: typeof body?.balance === 'number' ? body.balance : undefined,
    required: typeof body?.required === 'number' ? body.required : undefined,
    imageCost: typeof body?.imageCost === 'number' ? body.imageCost : undefined
  })
}
