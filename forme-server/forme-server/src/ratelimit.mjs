import { config } from './config.mjs'
import { ApiError } from './http.mjs'

/**
 * 接口限流
 * ------------------------------------------------------------------
 * 为什么必须要有：/api/generate-image 每调一次就真金白银花一次模型钱。
 * 没有限流的话，一个脚本循环调用就能把账户刷爆，
 * 而且扣的是用户自己的点数——用户会觉得是产品在骗他。
 *
 * 算法用「滑动窗口」而不是固定窗口：
 * 固定窗口在窗口边界能瞬间放行 2 倍流量（59 秒打满 + 61 秒再打满），
 * 对「限制模型花费」这种场景不够。滑动窗口按上一窗口的剩余权重折算，
 * 精度够用且每个 key 只占 O(1) 内存。
 *
 * 为什么不用 Redis：这一版是单进程部署（data/state.json 也是单进程假设），
 * 内存计数就够了。将来要多实例，把 buckets 换成 Redis 的 INCR + EXPIRE 即可，
 * 上层调用点不用改。
 */

/** key -> { windowStart, current, previous } */
const buckets = new Map()

/** 超过这个年龄的桶一定是死的，清掉防止内存无界增长 */
const SWEEP_MAX_AGE_MS = 5 * 60 * 1000
let sweepTimer = null

/**
 * 滑动窗口计数。
 * @returns {{ ok: boolean, retryAfter?: number, remaining?: number }}
 */
export function hit(key, limit, windowMs) {
  const now = Date.now()
  const windowStart = Math.floor(now / windowMs) * windowMs

  let entry = buckets.get(key)
  if (!entry) {
    entry = { windowStart, current: 0, previous: 0 }
    buckets.set(key, entry)
  } else if (entry.windowStart !== windowStart) {
    // 跨窗口：只有紧邻的上一个窗口计入权重，隔了多代直接丢弃
    const consecutive = windowStart - entry.windowStart === windowMs
    entry.previous = consecutive ? entry.current : 0
    entry.current = 0
    entry.windowStart = windowStart
  }

  // 上一个窗口的计数按时间线性衰减
  const elapsed = (now - windowStart) / windowMs
  const estimated = entry.previous * (1 - elapsed) + entry.current

  if (estimated >= limit) {
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000))
    }
  }

  entry.current += 1
  return { ok: true, remaining: Math.max(0, Math.floor(limit - estimated - 1)) }
}

/**
 * 判定是否内网/回环地址。
 * 用于决定「能不能信 X-Forwarded-For」。
 */
function isPrivateAddress(address) {
  if (!address) return false
  // IPv6 映射的 IPv4，形如 ::ffff:127.0.0.1
  const value = address.startsWith('::ffff:') ? address.slice(7) : address

  if (value === '::1' || value === '127.0.0.1') return true
  if (value.startsWith('127.')) return true
  if (value.startsWith('10.')) return true
  if (value.startsWith('192.168.')) return true
  if (value.startsWith('169.254.')) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(value)) return true
  if (value.startsWith('fc') || value.startsWith('fd')) return true
  if (value.startsWith('fe80:')) return true
  return false
}

/**
 * 取客户端 IP。
 * ------------------------------------------------------------------
 * 只有当直连方是我们自己的反代（回环/内网地址）时才采信 X-Forwarded-For。
 * 否则任何人都能随手加一个 `X-Forwarded-For: 1.2.3.4` 头，
 * 每次请求都换一个「IP」，限流直接形同虚设。
 *
 * 反过来说：部署在 nginx 后面时，peer 一定是 127.0.0.1，
 * 所以这里会自动改用 XFF，不需要额外配置。
 */
export function clientIp(req) {
  const peer = req.socket?.remoteAddress ?? ''

  if (isPrivateAddress(peer)) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    const first = forwarded.split(',')[0].trim()
    if (first) return first
  }
  return peer || 'unknown'
}

/** 启动定期清扫。定时器 unref，不阻止进程退出 */
export function startRateLimitSweeper() {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    const cutoff = Date.now() - SWEEP_MAX_AGE_MS
    for (const [key, entry] of buckets) {
      if (entry.windowStart < cutoff) buckets.delete(key)
    }
  }, 60 * 1000)
  sweepTimer.unref?.()
}

/** 测试用：清空所有计数 */
export function resetRateLimits() {
  buckets.clear()
}

/**
 * 限额校验，超限抛 429。
 * @param {string} scope 业务名，拼进 key 避免不同接口互相影响
 * @param {string} identity 用户 id 或 IP
 * @param {{limit:number, windowMs:number}} rule
 */
export function assertWithinLimit(scope, identity, rule) {
  if (!config.rateLimit.enabled) return

  const result = hit(`${scope}:${identity}`, rule.limit, rule.windowMs)
  if (result.ok) return

  throw new ApiError(
    429,
    `操作太频繁，请 ${result.retryAfter} 秒后再试`,
    'rate_limited',
    { retryAfter: result.retryAfter }
  )
}
