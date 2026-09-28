import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config.mjs'

/**
 * 持久化
 * ------------------------------------------------------------------
 * 单进程内存状态 + JSON 原子落盘。
 *
 * 为什么不用数据库：这是一版可运行的参考实现，目标是让小程序能真的跑通，
 * 而不是先引入一套需要运维的东西。换成 Postgres/MySQL 时，只需替换本文件
 * 导出的这些函数，路由层不用动。
 *
 * 并发约定（重要）：
 *   mutate() 接收的函数必须是**同步**的，且不得 await。
 *   Node 单线程 + 同步执行 = 读-改-写天然原子，不会出现两个请求同时
 *   通过余额校验然后一起扣费。需要等待外部 IO 的操作，一律拆成
 *   reserve → (await 外部调用) → commit / release 三段。
 */

const statePath = path.join(config.dataDir, 'state.json')

fs.mkdirSync(config.dataDir, { recursive: true })
fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true })

function emptyState() {
  return {
    accounts: {},
    sessions: {},
    orders: {},
    assets: {},
    idempotency: {},
    files: {},
    holds: {}
  }
}

function load() {
  if (!fs.existsSync(statePath)) {
    if (config.isProduction) {
      throw new Error(`生产数据文件 ${statePath} 不存在；已阻止用空账户启动。首次部署请运行 npm run init:data`)
    }
    return emptyState()
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('状态文件根节点不是对象')
    }
    if (!parsed.accounts || !parsed.orders) throw new Error('状态文件缺少账户或订单')
    for (const key of Object.keys(emptyState())) {
      if (parsed[key] !== undefined && (!parsed[key] || typeof parsed[key] !== 'object' || Array.isArray(parsed[key]))) {
        throw new Error(`${key} 不是对象`)
      }
    }
    return { ...emptyState(), ...parsed }
  } catch (error) {
    throw new Error(`无法读取数据文件 ${statePath}；已阻止用空账户启动`, { cause: error })
  }
}

let state = load()
let writeChain = Promise.resolve()

function persistNow() {
  const tmp = `${statePath}.tmp`
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, JSON.stringify(state, null, 2), 'utf8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, statePath)
}

/**
 * 串行化的读-改-写。落盘完成后才确认成功；失败时恢复内存快照。
 * @template T
 * @param {(s: ReturnType<typeof emptyState>) => T} fn
 * @returns {Promise<T>}
 */
export function mutate(fn) {
  const run = writeChain.then(() => {
    const before = structuredClone(state)
    try {
      const result = fn(state)
      persistNow()
      return result
    } catch (error) {
      state = before
      throw error
    }
  })
  // 让链条不因为一次失败而断掉
  writeChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/** 同步快照读取，用于纯查询 */
export function read(fn) {
  return fn(state)
}

/** 进程退出前把内存状态刷到磁盘 */
export function flush() {
  persistNow()
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`
}

/* ================================================================
   账户与点数
   ================================================================ */

function ensureAccount(s, userId) {
  if (!s.accounts[userId]) {
    s.accounts[userId] = {
      userId,
      balance: config.initialBalance,
      /** 有效期道具到期时间。null = 没有有效权益 */
      passExpiresAt: null,
      createdAt: new Date().toISOString(),
      transactions: []
    }
  }
  const account = s.accounts[userId]
  // 兼容旧数据：加了新字段后老账号没有这个 key
  if (account.passExpiresAt === undefined) account.passExpiresAt = null
  return account
}

export function getAccount(userId) {
  return read((s) => {
    const account = ensureAccount(s, userId)
    return {
      balance: account.balance,
      passExpiresAt: account.passExpiresAt,
      createdAt: account.createdAt
    }
  })
}

export function listTransactions(userId, limit = 20) {
  return read((s) => {
    const account = ensureAccount(s, userId)
    return account.transactions.filter((item) => item.status !== 'released').slice(0, limit)
  })
}

/**
 * 预扣点数。成功即已从余额扣除，但流水处于 pending。
 * 上游调用成功 → commitCharge；失败 → releaseCharge 把钱还回去。
 */
export function reserveCharge(userId, amount, meta = {}) {
  return mutate((s) => {
    const account = ensureAccount(s, userId)
    const value = Number(amount.toFixed(2))
    if (account.balance < value) {
      return { ok: false, reason: 'insufficient', balance: account.balance, required: value }
    }
    account.balance = Number((account.balance - value).toFixed(2))
    const holdId = newId('hold')
    s.holds[holdId] = {
      holdId,
      userId,
      amount: value,
      createdAt: new Date().toISOString(),
      meta
    }
    const transaction = {
      id: holdId,
      type: meta.type ?? 'generate',
      title: meta.title ?? '图片生成',
      amount: -value,
      status: 'pending',
      balanceAfter: account.balance,
      meta,
      createdAt: new Date().toISOString()
    }
    account.transactions.unshift(transaction)
    account.transactions = account.transactions.slice(0, 200)
    return { ok: true, holdId, balance: account.balance }
  })
}

export function commitCharge(holdId) {
  return mutate((s) => {
    const hold = s.holds[holdId]
    if (!hold) return { ok: false, balance: getBalance(s, '') }
    delete s.holds[holdId]
    const account = ensureAccount(s, hold.userId)
    const transaction = account.transactions.find((item) => item.id === holdId)
    if (transaction) transaction.status = 'done'
    return { ok: true, balance: account.balance }
  })
}

/**
 * 回滚的**同步**核心。
 * ------------------------------------------------------------------
 * 抽出来是为了让「单笔回滚」和「启动对账」共用同一段逻辑。
 * 不能直接在 mutate 里调 releaseCharge：它自己也要 mutate，而 mutate 是
 * 挂在 writeChain 上的 Promise，内层那个不会被外层 await，回滚会晚一拍发生，
 * 外层拿到的余额也是旧的。
 */
function releaseHoldIn(s, holdId, reason) {
  const hold = s.holds[holdId]
  if (!hold) return null
  delete s.holds[holdId]
  const account = ensureAccount(s, hold.userId)
  account.balance = Number((account.balance + hold.amount).toFixed(2))
  const transaction = account.transactions.find((item) => item.id === holdId)
  if (transaction) {
    transaction.status = 'released'
    transaction.releaseReason = reason
  }
  return { hold, balance: account.balance }
}

export function releaseCharge(holdId, reason = '') {
  return mutate((s) => {
    const result = releaseHoldIn(s, holdId, reason)
    if (!result) return { ok: false }
    // 回滚 = 收了钱又退回去，属于异常路径（上游在抖，或我们有 bug）。
    // 这条流水会被 listTransactions 过滤掉，用户看不到，所以必须在这里留日志，
    // 否则只能等用户投诉才发现上游一直在失败。
    console.warn(
      `[store] 回滚预扣 ${result.hold.amount} 点 user=${result.hold.userId} 原因=${reason || '未说明'}`
    )
    return { ok: true, balance: result.balance }
  })
}

/**
 * 回收「孤儿预扣」——必须在启动阶段、开始接收请求之前调用。
 * ------------------------------------------------------------------
 * 为什么需要它：
 *   runImageTask 是「预扣 → await 上游 → 结算或回滚」。预扣一落盘，钱就已经
 *   离开用户余额了。如果进程在这个 await 窗口里死掉（滚动发布、OOM、kill -9），
 *   commit 和 release 都不会跑，磁盘上就留下一个永远没人处理的 hold：
 *
 *     - 用户余额被永久扣掉，且流水停在 pending（= 用户看到一笔扣费却没拿到图）；
 *     - 没有任何告警，运维不重启就永远发现不了；
 *     - 每次发布都可能再吃掉一笔。
 *
 * 为什么「启动时全部回收」是可证的：
 *   hold 的生命周期完全等于一个 HTTP 请求的生命周期。进程重启意味着上一个
 *   进程里所有在飞的请求都已经死了，所以**启动那一刻，磁盘上不可能存在
 *   仍然有效的 hold**——每一个都是孤儿。因此这里不需要按时间判断。
 *
 * 为什么加 once 闸门：
 *   这个推理只在「启动时」成立。如果将来有人把它挂到定时器上，带着「全回收」
 *   的语义跑，就会把正在生成的请求的预扣退掉（用户白拿图）。所以用一次性的
 *   闸门把「只能在启动时调」从注释变成机制，误用会变成安全的无操作。
 *
 * @returns {Promise<{released: Array<{holdId: string, userId: string, amount: number}>, total: number, skipped?: boolean}>}
 */
let orphanSweepDone = false

export function reclaimOrphanHolds() {
  if (orphanSweepDone) {
    return Promise.resolve({ released: [], total: 0, skipped: true })
  }
  orphanSweepDone = true

  return mutate((s) => {
    const released = []
    for (const holdId of Object.keys(s.holds)) {
      const result = releaseHoldIn(s, holdId, 'orphan: 进程在结算前退出')
      if (result) {
        released.push({ holdId, userId: result.hold.userId, amount: result.hold.amount })
      }
    }
    return {
      released,
      total: Number(released.reduce((sum, item) => sum + item.amount, 0).toFixed(2))
    }
  })
}

function getBalance(s, userId) {
  return s.accounts[userId]?.balance ?? 0
}

/* ================================================================
   登录态
   ================================================================ */

export function createSession({ userId, openid, sessionKey }) {
  return mutate((s) => {
    const token = crypto.randomBytes(32).toString('hex')
    s.sessions[token] = {
      token,
      userId,
      openid,
      sessionKey,
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + config.sessionTtl * 1000
    }
    return s.sessions[token]
  })
}

export function getSession(token) {
  if (!token) return null
  return read((s) => {
    const session = s.sessions[token]
    if (!session) return null
    if (session.expiresAt < Date.now()) return null
    return session
  })
}

export function dropSession(token) {
  return mutate((s) => {
    delete s.sessions[token]
    return { ok: true }
  })
}

export function findUserByOpenid(openid) {
  return read((s) => {
    for (const session of Object.values(s.sessions)) {
      if (session.openid === openid) return session.userId
    }
    return null
  })
}

/* ================================================================
   幂等
   ================================================================ */

export function getIdempotent(key) {
  if (!key) return null
  return read((s) => s.idempotency[key] ?? null)
}

export function saveIdempotent(key, payload) {
  if (!key) return
  return mutate((s) => {
    s.idempotency[key] = { key, payload, createdAt: new Date().toISOString() }
    // 简单清理：只保留最近 500 条
    const keys = Object.keys(s.idempotency)
    if (keys.length > 500) {
      for (const stale of keys.slice(0, keys.length - 500)) delete s.idempotency[stale]
    }
    return { ok: true }
  })
}

/* ================================================================
   资产库
   ================================================================ */

export function saveAsset(userId, asset) {
  return mutate((s) => {
    const list = s.assets[userId] ?? []
    const record = { ...asset, id: asset.id ?? newId('asset'), createdAt: asset.createdAt ?? new Date().toISOString() }
    s.assets[userId] = [record, ...list.filter((item) => item.id !== record.id)].slice(0, 100)
    return record
  })
}

export function listAssets(userId, limit = 20) {
  return read((s) => (s.assets[userId] ?? []).slice(0, limit))
}

export function deleteAsset(userId, assetId) {
  return mutate((s) => {
    const list = s.assets[userId] ?? []
    const next = list.filter((item) => item.id !== assetId)
    const removed = next.length !== list.length
    s.assets[userId] = next
    return { ok: removed }
  })
}

/* ================================================================
   上传文件
   ================================================================ */

export function saveFileRecord(record) {
  return mutate((s) => {
    s.files[record.fileId] = record
    return record
  })
}

export function getFileRecord(fileId) {
  return read((s) => s.files[fileId] ?? null)
}

/* ================================================================
   支付订单
   ================================================================ */

export function createOrder(order) {
  return mutate((s) => {
    s.orders[order.outTradeNo] = order
    return order
  })
}

export function getOrder(outTradeNo) {
  return read((s) => s.orders[outTradeNo] ?? null)
}

/** 未发货订单，供定时查单兜底。用白名单而不是「排除已发货」，新增状态时不会漏 */
export function listUndeliveredOrders() {
  return read((s) => Object.values(s.orders).filter((order) => order.status === 'pending'))
}

export function listUnconfirmedDeliveries() {
  return read((s) => Object.values(s.orders).filter((order) => order.status === 'delivered' && order.providerAckPending))
}

export function confirmDelivery(outTradeNo) {
  return mutate((s) => {
    const order = s.orders[outTradeNo]
    if (order?.status === 'delivered') order.providerAckPending = false
  })
}

export function listUserOrders(userId, limit = 20) {
  return read((s) =>
    Object.values(s.orders)
      .filter((order) => order.userId === userId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit)
  )
}

/* ================================================================
   发货与退款（必须是单次原子写入）
   ================================================================
   发货要同时做三件事：点数到账、发放权益、把订单标成已发货。
   如果拆成三次独立写入，进程在中间崩掉时订单仍是 pending，
   平台重试就会**重复加点**——用户白拿，且流水看起来完全正常。

   所以这里把所有副作用收进一次 mutate()。mutate 的回调是同步函数，
   Node 单线程下读-改-写天然原子，要么全做完要么全不做。
   ================================================================ */

/**
 * 订单发货（幂等）。
 * @returns {{ok: boolean, already?: boolean, reason?: string, balance?: number, passExpiresAt?: string|null, points?: number, durationDays?: number}}
 */
export function settleOrder({ outTradeNo, wxOrderId = '', source = '' }) {
  return mutate((s) => {
    const order = s.orders[outTradeNo]
    if (!order) return { ok: false, reason: 'unknown_order' }

    if (order.status === 'delivered') {
      return { ok: true, already: true, points: order.points, durationDays: order.durationDays ?? 0 }
    }
    if (order.status === 'refunded') {
      // 已退款的单子不再发货，否则等于白送
      return { ok: false, reason: 'already_refunded' }
    }

    // 平台单号只能绑一笔订单，撞号说明对账出问题了
    if (wxOrderId) {
      for (const other of Object.values(s.orders)) {
        if (other.wxOrderId === wxOrderId && other.outTradeNo !== outTradeNo) {
          return { ok: false, reason: 'wx_order_id_conflict' }
        }
      }
    }

    const account = ensureAccount(s, order.userId)
    const now = new Date().toISOString()
    const points = Number(Number(order.points ?? 0).toFixed(2))
    const durationDays = Number(order.durationDays ?? 0)

    // 1. 点数到账
    if (points > 0) {
      account.balance = Number((account.balance + points).toFixed(2))
      account.transactions.unshift({
        id: newId('recharge'),
        type: 'recharge',
        title: `${order.planId} 充值`,
        amount: points,
        status: 'done',
        balanceAfter: account.balance,
        meta: { outTradeNo, wxOrderId, source },
        createdAt: now
      })
    }

    // 2. 有效期道具：未过期则从原到期时间顺延，已过期则从现在起算。
    //    这样用户提前续买不会白白损失剩余天数。
    if (durationDays > 0) {
      const current = account.passExpiresAt ? new Date(account.passExpiresAt).getTime() : 0
      const base = current > Date.now() ? current : Date.now()
      account.passExpiresAt = new Date(base + durationDays * 86400000).toISOString()
      account.transactions.unshift({
        id: newId('pass'),
        type: 'pass',
        title: `${durationDays} 天创作权益`,
        amount: 0,
        status: 'done',
        balanceAfter: account.balance,
        meta: { outTradeNo, wxOrderId, source, passExpiresAt: account.passExpiresAt },
        createdAt: now
      })
    }

    account.transactions = account.transactions.slice(0, 200)

    // 3. 订单状态
    order.status = 'delivered'
    if (wxOrderId) order.wxOrderId = wxOrderId
    order.deliveredAt = now
    order.deliverSource = source
    order.providerAckPending = source === 'query-sweep'
    order.updatedAt = now

    return {
      ok: true,
      balance: account.balance,
      passExpiresAt: account.passExpiresAt,
      points,
      durationDays
    }
  })
}

/**
 * 订单退款（幂等）。
 * ------------------------------------------------------------------
 * 退款回收点数必须**下限为 0**：用户可能已经把点花掉了，
 * 强行扣成负数会破坏「余额永不为负」这条不变量（出图扣费逻辑依赖它）。
 * 收不回来的部分记在 shortfall 里返回，由调用方告警，人工追。
 *
 * 权益不自动撤销：用户可能已经用权益做了合法创作，
 * 是否收回属于业务决策，这里只记录并让运维看得见。
 */
export function refundOrder({ outTradeNo, wxOrderId = '', reason = '' }) {
  return mutate((s) => {
    const order = s.orders[outTradeNo]
    if (!order) return { ok: false, reason: 'unknown_order' }
    if (order.status === 'refunded') return { ok: true, already: true }

    const account = ensureAccount(s, order.userId)
    const now = new Date().toISOString()
    const points = Number(Number(order.points ?? 0).toFixed(2))
    const wasDelivered = Boolean(order.deliveredAt)

    // 只回收「本单发放过且还没被花掉」的部分
    const clawedBack = wasDelivered ? Math.min(account.balance, points) : 0
    const shortfall = wasDelivered ? Number((points - clawedBack).toFixed(2)) : 0

    if (clawedBack > 0) {
      account.balance = Number((account.balance - clawedBack).toFixed(2))
      account.transactions.unshift({
        id: newId('refund'),
        type: 'refund',
        title: `${order.planId} 退款回收`,
        amount: -clawedBack,
        status: 'done',
        balanceAfter: account.balance,
        meta: { outTradeNo, wxOrderId, reason, shortfall },
        createdAt: now
      })
      account.transactions = account.transactions.slice(0, 200)
    }

    order.status = 'refunded'
    order.refundedAt = now
    order.refundReason = reason
    order.refundShortfall = shortfall
    order.updatedAt = now

    return { ok: true, clawedBack, shortfall, balance: account.balance, wasDelivered }
  })
}
