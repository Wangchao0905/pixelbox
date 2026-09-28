/**
 * 商品目录（服务端为准）
 * ------------------------------------------------------------------
 * 这里的 productId / 价格必须与 MP 后台【虚拟支付 → 道具管理】里
 * 创建的道具完全一致：productId 对不上会支付失败，goodsPrice 对不上
 * 平台会拒绝。改价时两边都要改。
 *
 * 金额单位一律是「分」，全程不要换算成元——虚拟支付的金额字段就是分，
 * 中间换算一次就多一次出错机会。
 *
 * 关于「包月」：
 * ------------------------------------------------------------------
 * 微信虚拟支付的 mode 固定为 short_series_goods（道具直购），signData
 * 的字段是写死的（offerId / buyQuantity / env / currencyType / productId /
 * goodsPrice / outTradeNo / attach），没有任何续费相关字段。
 * 官方文档「Agent 注意事项」第 2 条：只做道具直购，不引入代币等额外功能。
 *
 * 所以「包月」不能做成自动续费，只能做成**一次性购买的 N 天有效期道具**：
 * 用户买一次，权益有效 30 天，到期自己再买。能卖、合规，只是不自动扣款。
 * 权益与点数在发货时一起发放（见 store.settleOrder）。
 */

import { config } from './config.mjs'

/** 有效期道具的天数 */
export const PASS_DAYS = 30

/**
 * 「这些点能出几张图」——**必须按 IMAGE_COST 现算，不能写死**。
 * ------------------------------------------------------------------
 * 这里踩过坑：单价从 0.35 调走之后，写死的「约 285 张图片」还留在响应里，
 * 而实际张数早就不是那个数了。文案错得越具体，用户越容易当成承诺去投诉，
 * 所以改成从 config.imageCost 推导，单价再调也不会漂。
 */
function imageCount(points) {
  const cost = config.imageCost
  if (!Number.isFinite(cost) || cost <= 0) return '—'
  return String(Math.floor(points / cost))
}

/**
 * note 允许写成函数，入参是「算张数」的工具，出参是最终文案。
 * 写成函数是为了延迟到「响应时」才算，这样测试里改 IMAGE_COST
 * 起的实例能拿到属于自己的文案，而不是模块加载那一刻的快照。
 */
// 售价不变，按 12% 支付渠道费预留后向下取整点数。
// productId / planId 保留历史标识；旧订单继续按下单快照发货。
const PLANS = [
  {
    planId: 'pass-starter',
    kind: 'pass',
    name: '轻量创作',
    productId: 'forme_pass_30d_30pts',
    priceFen: 3000,
    points: 26,
    durationDays: PASS_DAYS,
    note: (points) => `30 天内有效 · 优先生成 · 含 ${points} 点 · 约 ${imageCount(points)} 张图片`
  },
  {
    planId: 'pass-pro',
    kind: 'pass',
    name: '专业创作',
    productId: 'forme_pass_30d_100pts',
    priceFen: 10000,
    points: 88,
    durationDays: PASS_DAYS,
    note: (points) => `30 天内有效 · 商用授权 · 含 ${points} 点 · 约 ${imageCount(points)} 张图片`
  },
  {
    planId: 'points-15',
    kind: 'points',
    name: '13 点',
    productId: 'forme_points_15_once',
    priceFen: 1500,
    points: 13,
    durationDays: 0,
    note: (points) => `一次性到账 · 约 ${imageCount(points)} 张图片`
  },
  {
    planId: 'points-100',
    kind: 'points',
    name: '88 点',
    productId: 'forme_points_100_once',
    priceFen: 10000,
    points: 88,
    durationDays: 0,
    note: (points) => `一次性到账 · 约 ${imageCount(points)} 张图片`
  },
  {
    planId: 'points-500',
    kind: 'points',
    name: '440 点',
    productId: 'forme_points_500_once',
    priceFen: 50000,
    points: 440,
    durationDays: 0,
    note: (points) => `一次性到账 · 约 ${imageCount(points)} 张图片`
  }
]

const TEST_PLAN = {
  planId: 'test-1yuan-20260924',
  kind: 'points',
  name: '支付验收（1 元）',
  productId: config.testPayment.productId,
  priceFen: 100,
  points: 1,
  durationDays: 0,
  note: '临时测试商品 · 仅白名单用户可见 · 测试完成后下架'
}

/** 把 note 函数求值成字符串。对外的 plan 对象永远是纯数据，不泄漏函数 */
function materialize(plan) {
  const { note, ...rest } = plan
  return { ...rest, note: typeof note === 'function' ? note(plan.points) : note }
}

export function findPlan(planId) {
  const plan = [...PLANS, ...(config.testPayment.enabled ? [TEST_PLAN] : [])]
    .find((item) => item.planId === planId) ?? null
  return plan ? materialize(plan) : null
}

/** 当前可售方案。留成函数是为了以后要下架某个方案时只改这里 */
export function sellablePlans({ includeTest = false } = {}) {
  return [...PLANS, ...(config.testPayment.enabled && includeTest ? [TEST_PLAN] : [])].map(materialize)
}

export function isTestPlan(planId) {
  return planId === TEST_PLAN.planId
}

export function isTestPaymentOpenid(openid) {
  return Boolean(openid) && config.testPayment.openids.includes(openid)
}
