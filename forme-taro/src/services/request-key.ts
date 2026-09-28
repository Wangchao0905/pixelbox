/**
 * 生成类请求的幂等键策略
 * ==================================================================
 * 纯逻辑，**不 import Taro、不发请求**，所以能脱离小程序运行时单独验证
 * （见 `scripts/check-request-key.mjs`）。
 *
 * 为什么需要这层策略：服务端的幂等是 **requestId 维度**的 —— 同一个 id
 * 重放会返回缓存结果且**不再扣费**（`forme-server/src/image.mjs` 的
 * `idempotencyKey`，键是 `kind:userId:requestId`）。
 *
 * 但「网络超时后重试」和「再生成一批」的**请求体一模一样**，服务端分不出来，
 * 只能由客户端决定给不给新 id。判定规则：
 *
 *   上一次失败 → 用户是在**重试**   → 复用同一个 id，服务端幂等兜住，不重复扣费
 *   上一次成功 → 用户是想要**新的一批** → 换新 id，正常扣费
 *   内容变了   → 新的创作意图       → 换新 id
 *
 * 如果每次调用都发新 id，服务端的幂等保护就被彻底架空：用户网络超时后
 * 点一次「重试」就会被多扣一次钱。
 */

export type Attempt = { requestId: string; failed: boolean }

/**
 * 请求内容指纹。内容变了必须换新幂等键，否则用户改了提示词再生成，
 * 会被服务端当成上一次的重放，拿回旧图（而且不扣费，账也对不上）。
 *
 * 用 `JSON.stringify` 而不是自己拼分隔符：
 * - **类型不含糊**。自己拼的话 `n: 2` 与 `n: '2'` 都是字符串 `"2"`，
 *   会被当成同一次请求；JSON 给出 `2` 与 `"2"`，区分得开。
 * - **可读**。排查时能直接把指纹打进日志看懂。
 * - 顺带避开一个坑：控制字符（如 `\u0000`）会被压缩器改写成别的转义形式，
 *   任何在产物里按字面量找它的检查都会莫名其妙失效。
 */
export function fingerprintOf(path: string, data: Record<string, unknown>): string {
  const fileIds = Array.isArray(data.fileIds) ? (data.fileIds as unknown[]).join(',') : ''
  return JSON.stringify([path, data.prompt, data.model, data.quality, data.size, data.n, fileIds])
}

function defaultMint(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export type RequestKeyStore = {
  /** 取本次请求要用的幂等键；同时乐观地把它记为「尚未成功」 */
  take(fingerprint: string): string
  /** 请求成功后调用，标记这次意图已经完成 */
  settle(fingerprint: string, requestId: string): void
  /** 当前记录条数，供测试与排查 */
  size(): number
}

/**
 * @param options.limit 记录上限。提示词是用户输入的，理论上可以有很多条，
 *   加个上限避免长时间使用后无限增长。超出后按插入顺序淘汰最旧的。
 * @param options.mint  幂等键生成器，测试时可注入确定性实现
 */
export function createRequestKeyStore(options?: {
  limit?: number
  mint?: () => string
}): RequestKeyStore {
  const limit = options?.limit ?? 50
  const mint = options?.mint ?? defaultMint
  const attempts = new Map<string, Attempt>()

  return {
    take(fingerprint: string): string {
      const previous = attempts.get(fingerprint)
      // 上一次没成功 → 这是重试，必须复用，否则会重复扣费
      if (previous && previous.failed) return previous.requestId

      const requestId = mint()
      // 先记成 failed:true。请求抛错时不会有人来改它，
      // 下一次同内容调用就会走到上面的分支复用这个 id。
      if (attempts.size >= limit) {
        const oldest = attempts.keys().next().value
        if (oldest !== undefined) attempts.delete(oldest)
      }
      attempts.set(fingerprint, { requestId, failed: true })
      return requestId
    },

    settle(fingerprint: string, requestId: string): void {
      attempts.set(fingerprint, { requestId, failed: false })
    },

    size(): number {
      return attempts.size
    }
  }
}
