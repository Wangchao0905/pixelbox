import Taro from '@tarojs/taro'
import { APP_CONFIG, STORAGE_KEYS } from '@/config'
import { request } from './http'

/**
 * 账户 / 商品目录 / 虚拟支付
 * ------------------------------------------------------------------
 * 价格与时长一律以服务端 /api/catalog 为准，客户端只提供视觉元数据
 * （强调色、角标），避免两边改价不一致。
 *
 * 关于「包月」：微信虚拟支付的 mode 固定为 short_series_goods，
 * 没有续费字段，所以服务端把包月做成**一次性购买的 30 天有效期道具**。
 * 客户端按 kind 分组展示（pass / points），不叫「订阅」也不写「每月自动续费」。
 */

export type Transaction = {
  id: string
  /** generate = 图片生成，edit = 产品替换，recharge = 充值，pass = 权益，refund = 退款回收 */
  type: string
  title: string
  /** 负数=扣费，正数=到账 */
  amount: number
  /**
   * `pending` = 预扣已生效、上游还在跑（界面上要显示成「处理中」，不是「已扣费」）；
   * `done` = 已结算；`released` = 已回滚，不会出现在列表里。
   * 出图最长 180 秒，这段时间拿到的就是 pending —— 不要假设恒为 done。
   */
  status: string
  balanceAfter: number
  createdAt: string
}

export type AccountSnapshot = {
  balance: number
  /** 有效期道具到期时间，null = 没有有效权益 */
  passExpiresAt: string | null
  imageCost: number
  transactions: Transaction[]
}

/**
 * AIGC 显式标识配置（服务端下发）。
 * label = 展示文案，provider = 署名主体。
 * 两个都是合规信息，不写死在客户端。
 */
export type AigcConfig = {
  label: string
  provider: string
}

export type PlanKind = 'pass' | 'points'

export type CatalogPlan = {
  planId: string
  kind: PlanKind
  name: string
  productId: string
  priceFen: number
  points: number
  /** 有效期天数。0 = 纯点数档，不发放权益 */
  durationDays: number
  note: string
}

export type Catalog = {
  plans: CatalogPlan[]
  imageCost: number
  maxBatch: number
  /** 有效期道具的标准天数，展示文案用 */
  passDays: number
  /** AIGC 显式标识文案与署名（《标识办法》第四条），服务端下发 */
  aigc?: AigcConfig
}

/* ================================================================
   余额缓存
   ================================================================
   生成/充值响应里的 balance 都是权威值，随手写进缓存，
   首页就能立刻显示最新点数，不用等下一次请求回来。
   ================================================================ */

export function readCachedBalance(): number | null {
  try {
    const raw = Taro.getStorageSync(STORAGE_KEYS.balance)
    if (raw === '' || raw === undefined || raw === null) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

export function rememberBalance(balance: number) {
  try {
    Taro.setStorageSync(STORAGE_KEYS.balance, String(balance))
  } catch {
    // 缓存失败不影响本次会话
  }
}

/* ================================================================
   单价与消耗预估
   ================================================================
   单价**以服务端为准**：每次拿到 /api/account 或 /api/catalog 都刷新一次。
   本地常量只是没联网时的兜底。

   为什么不让各页面自己写死数字：单价一改就要全局搜数字，
   漏一处就会出现「界面显示 16 点、实际扣 20 点」这种最招投诉的 bug。
   ================================================================ */

let cachedImageCost: number | null = null

/** 当前生效的单张图单价 */
export function currentImageCost(): number {
  return cachedImageCost ?? APP_CONFIG.costPerImage
}

/** 预估 n 张图的消耗，用于生成条上的「预计消耗」 */
export function costForImages(count: number): number {
  return Number((count * currentImageCost()).toFixed(2))
}

/* ================================================================
   AIGC 显式标识
   ================================================================
   《人工智能生成合成内容标识办法》（2025-09-01 施行）第四条要求在图片
   适当位置添加**显著的提示标识**。标识文案与署名主体由服务端下发：
   改了要能立刻全量生效，不能等小程序重新发版审核。

   这里同样只缓存 + 兜底，不在页面上写死「AI 生成」四个字。
   ================================================================ */

let cachedAigc: { label: string; provider: string } | null = null

/** 显式标识文案，例如「AI 生成」 */
export function currentAigcLabel(): string {
  return cachedAigc?.label || APP_CONFIG.aigcLabel
}

/** 署名主体，用于标识的完整表述 */
export function currentAigcProvider(): string {
  return cachedAigc?.provider || APP_CONFIG.aigcProvider
}

/** 带署名的完整标识文案，例如「AI 生成 · 像素盒子」 */
export function aigcBadgeText(): string {
  const label = currentAigcLabel()
  const provider = currentAigcProvider()
  return provider ? `${label} · ${provider}` : label
}

/**
 * 把目录响应里的合规与定价信息收进缓存。
 * /api/catalog 和 /api/account 都可能带这些字段，统一在这里处理，
 * 避免每个调用点各写一份判断。
 */
function absorbServerPolicy(payload: {
  imageCost?: number
  aigc?: { label?: string; provider?: string }
}) {
  if (Number.isFinite(payload?.imageCost) && (payload.imageCost as number) > 0) {
    cachedImageCost = payload.imageCost as number
  }
  const label = payload?.aigc?.label
  const provider = payload?.aigc?.provider
  if (typeof label === 'string' && label.trim()) {
    cachedAigc = { label: label.trim(), provider: (provider ?? '').trim() }
  }
}

/* ================================================================
   有效期道具
   ================================================================ */

/** 权益是否还在有效期内 */
export function isPassActive(passExpiresAt: string | null | undefined): boolean {
  if (!passExpiresAt) return false
  const expires = new Date(passExpiresAt).getTime()
  return Number.isFinite(expires) && expires > Date.now()
}

/** 到期时间的展示文案。返回 '' 表示没有权益 */
export function formatPassExpiry(passExpiresAt: string | null | undefined): string {
  if (!isPassActive(passExpiresAt)) return ''
  const date = new Date(passExpiresAt as string)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} 到期`
}

/* ================================================================
   账户
   ================================================================ */

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * 演示模式下的假余额。
 * ------------------------------------------------------------------
 * **只在 TARO_APP_USE_MOCK=1（完全不连后端）时使用**，
 * 与生产环境的新用户初始点数没有任何关系 ——
 * 生产默认不送点数（服务端 INITIAL_BALANCE=0），新用户余额就是 0。
 *
 * 这里给一个非零值，只是为了在没起后端时能把
 * 「首页 → 创作 → 结果 → 资产库」这条链路点通。
 */
export const DEMO_BALANCE = 40

function mockAccount(): AccountSnapshot {
  return {
    balance: readCachedBalance() ?? DEMO_BALANCE,
    passExpiresAt: null,
    imageCost: APP_CONFIG.costPerImage,
    transactions: []
  }
}

export async function getAccount(): Promise<AccountSnapshot> {
  if (APP_CONFIG.useMockGeneration) {
    await delay(180)
    return mockAccount()
  }
  const payload = await request<AccountSnapshot>('/api/account')
  rememberBalance(payload.balance)
  // 单价与 AIGC 标识跟着账户一起回来，顺手刷新本地缓存
  absorbServerPolicy(payload)
  return payload
}

export async function getAccountBalance(): Promise<number> {
  return (await getAccount()).balance
}

/* ================================================================
   商品目录
   ================================================================ */

/** 演示模式的兜底目录。结构与服务端 /api/catalog 保持一致 */
function mockPlans(): CatalogPlan[] {
  // 「约 N 张图片」按当前单价现算。写死过一次 0.35 时代的 285 张，
  // 单价改成 4 之后文案就成了错的承诺——文案越具体越要能自证。
  const images = (points: number) => Math.floor(points / currentImageCost())
  return [
    {
      planId: 'pass-starter',
      kind: 'pass',
      name: '轻量创作',
      productId: 'forme_pass_30d_30pts',
      priceFen: 3000,
      points: 26,
      durationDays: 30,
      note: `30 天内有效 · 优先生成 · 含 26 点 · 约 ${images(26)} 张图片`
    },
    {
      planId: 'pass-pro',
      kind: 'pass',
      name: '专业创作',
      productId: 'forme_pass_30d_100pts',
      priceFen: 10000,
      points: 88,
      durationDays: 30,
      note: `30 天内有效 · 商用授权 · 含 88 点 · 约 ${images(88)} 张图片`
    },
    {
      planId: 'points-15',
      kind: 'points',
      name: '13 点',
      productId: 'forme_points_15_once',
      priceFen: 1500,
      points: 13,
      durationDays: 0,
      note: `一次性到账 · 约 ${images(13)} 张图片`
    },
    {
      planId: 'points-100',
      kind: 'points',
      name: '88 点',
      productId: 'forme_points_100_once',
      priceFen: 10000,
      points: 88,
      durationDays: 0,
      note: `一次性到账 · 约 ${images(88)} 张图片`
    },
    {
      planId: 'points-500',
      kind: 'points',
      name: '440 点',
      productId: 'forme_points_500_once',
      priceFen: 50000,
      points: 440,
      durationDays: 0,
      note: `一次性到账 · 约 ${images(440)} 张图片`
    }
  ]
}

export async function getCatalog(): Promise<Catalog> {
  if (APP_CONFIG.useMockGeneration) {
    await delay(120)
    return {
      plans: mockPlans(),
      imageCost: APP_CONFIG.costPerImage,
      maxBatch: APP_CONFIG.maxBatch,
      passDays: 30,
      aigc: { label: APP_CONFIG.aigcLabel, provider: APP_CONFIG.aigcProvider }
    }
  }
  const payload = await request<Catalog>('/api/catalog')
  absorbServerPolicy(payload)
  return payload
}

/**
 * 启动时预热目录。
 * ------------------------------------------------------------------
 * AIGC 显式标识文案与单价都来自服务端，但目录原本只在充值页才拉。
 * 结果页和资产库都要显示标识，如果用户从没进过充值页，就只能用
 * 打包时写死的兜底值——服务端改了署名要等到下次发版才生效，
 * 而这是合规信息，不该有这种延迟。
 * 所以启动时静默拉一次，失败也不打扰用户（兜底值本来就是对的）。
 */
export async function warmCatalog(): Promise<void> {
  if (APP_CONFIG.useMockGeneration) return
  try {
    await getCatalog()
  } catch {
    // 静默失败：没有网络时用打包兜底值，不影响任何功能
  }
}

/* ================================================================
   虚拟支付
   ================================================================ */

type PayData = {
  signData: string
  mode: string
  paySig: string
  signature: string
}

type PayOrderResponse = {
  orderId: string
  planId: string
  kind: PlanKind
  points: number
  durationDays: number
  priceFen: number
  payData: PayData
}

type OrderSnapshot = {
  orderId: string
  status: 'pending' | 'delivered' | 'refunded'
  kind: PlanKind
  points: number
  durationDays: number
  priceFen: number
  planId: string
  deliveredAt: string | null
  refundedAt: string | null
}

export type PayOutcome =
  | {
      status: 'delivered'
      points: number
      durationDays: number
      balance: number
      passExpiresAt: string | null
    }
  | { status: 'pending'; orderId: string }
  | { status: 'cancelled' }

/** iOS 端虚拟支付的最低微信版本（官方文档要求） */
const IOS_MIN_VERSION = [8, 0, 68]

/** 逐段比较版本号。返回 1 = a 更新，-1 = a 更旧，0 = 相同 */
function compareVersion(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    if (left !== right) return left > right ? 1 : -1
  }
  return 0
}

/**
 * 平台支付能力校验。
 * ------------------------------------------------------------------
 * iOS 端虚拟支付需要微信 ≥ 8.0.68，且还需在 MP 后台配置小程序简称
 * 才能开通 Apple IAP；版本不够时直接调起会失败。
 *
 * 必须在**下单之前**校验：先下单再校验会留下永远不会支付的垃圾订单，
 * 而虚拟支付的订单在平台侧有记录，清理起来很麻烦。
 *
 * 注：官方文档的示例代码用的是「严格大于」，也就是恰好 8.0.68 会被判为
 * 不通过。这里按文档的**文字**要求（"8.0.68 及以上"）实现为大于等于。
 */
function assertPayablePlatform(): void {
  const system = Taro.getSystemInfoSync()
  if (system.platform !== 'ios') return

  const current = String(system.version ?? '')
    .split('.')
    .map((part) => Number(part) || 0)

  if (compareVersion(current, IOS_MIN_VERSION) >= 0) return

  throw new Error(
    `iOS 端虚拟支付需要微信 ${IOS_MIN_VERSION.join('.')} 及以上版本，请更新微信后重试`
  )
}

/**
 * 调起虚拟支付。
 * ------------------------------------------------------------------
 * 参数必须原样透传，一个字段都不能改：signData / paySig / signature
 * 三者是绑死的，改任何一个都会验签失败。
 */
function requestVirtualPayment(payData: PayData): Promise<void> {
  return new Promise((resolve, reject) => {
    const api = (Taro as any).requestVirtualPayment
    if (typeof api !== 'function') {
      reject(new Error('当前微信基础库不支持虚拟支付，请升级微信后重试'))
      return
    }
    api({
      signData: payData.signData,
      mode: payData.mode,
      paySig: payData.paySig,
      signature: payData.signature,
      success: () => resolve(),
      fail: (error: any) => reject(new Error(error?.errMsg ?? '支付未完成'))
    })
  })
}

/** 轮询订单状态直到发货。返回 null 表示轮询次数用尽仍未发货 */
async function pollOrder(orderId: string, attempts: number): Promise<PayOutcome | null> {
  for (let index = 0; index < attempts; index += 1) {
    const snapshot = await request<OrderSnapshot>(`/api/pay/order/${orderId}`)
    if (snapshot.status === 'delivered') {
      const account = await getAccount()
      return {
        status: 'delivered',
        points: snapshot.points,
        durationDays: snapshot.durationDays,
        balance: account.balance,
        passExpiresAt: account.passExpiresAt
      }
    }
    await delay(1000)
  }
  return null
}

/**
 * 购买一个方案。
 * ------------------------------------------------------------------
 * 到账依据是服务端查单结果，不是支付组件的 success 回调：
 * 用户付完立刻杀进程会丢回调，只看回调就会漏发货。
 */
export async function purchasePlan(planId: string): Promise<PayOutcome> {
  const catalog = await getCatalog()
  const plan = catalog.plans.find((item) => item.planId === planId)
  if (!plan) throw new Error('方案已下架，请刷新后重试')

  if (APP_CONFIG.useMockGeneration) {
    // 演示模式：不发请求，本地模拟一次成功到账，方便点通 UI
    await delay(900)
    const balance = (readCachedBalance() ?? DEMO_BALANCE) + plan.points
    rememberBalance(balance)
    const base = plan.durationDays > 0 ? Date.now() : 0
    return {
      status: 'delivered',
      points: plan.points,
      durationDays: plan.durationDays,
      balance,
      passExpiresAt:
        plan.durationDays > 0 ? new Date(base + plan.durationDays * 86400000).toISOString() : null
    }
  }

  // 下单前先确认这台设备能支付，避免产生永不支付的垃圾订单
  assertPayablePlatform()

  const order = await request<PayOrderResponse>('/api/pay/order', {
    method: 'POST',
    data: { planId }
  })

  try {
    await requestVirtualPayment(order.payData)
  } catch (error) {
    // 用户取消不代表没付成功（比如付完才被杀进程），所以仍查一次单
    const settled = await pollOrder(order.orderId, 2)
    if (settled) return settled

    const message = error instanceof Error ? error.message : ''
    // 主动取消是正常操作，不该当成错误弹窗
    if (/cancel/i.test(message)) return { status: 'cancelled' }
    throw error
  }

  const settled = await pollOrder(order.orderId, 10)
  if (settled) return settled

  // 付了但平台推送还没到：交给服务端兜底查单，让用户稍后自己确认
  return { status: 'pending', orderId: order.orderId }
}

/** 订单列表，用于「点数明细」页 */
export async function listOrders(): Promise<OrderSnapshot[]> {
  if (APP_CONFIG.useMockGeneration) return []
  const payload = await request<{ orders: OrderSnapshot[] }>('/api/pay/orders')
  return payload.orders ?? []
}

/** 单笔订单状态查询，用于「确认中」的订单让用户手动刷新 */
export async function queryOrder(orderId: string): Promise<OrderSnapshot> {
  return request<OrderSnapshot>(`/api/pay/order/${orderId}`)
}
