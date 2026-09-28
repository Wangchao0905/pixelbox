import { useCallback, useState } from 'react'
import { useDidShow } from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { AppHeader } from '@/components'
import { formatPrice, planEyebrow, planVisual } from '@/data/catalog'
import {
  DEMO_BALANCE,
  currentImageCost,
  formatPassExpiry,
  getAccount,
  getCatalog,
  purchasePlan,
  readCachedBalance,
  type Catalog,
  type CatalogPlan
} from '@/services/account'

/**
 * 充值中心
 * ------------------------------------------------------------------
 * 对应原型 RechargeScreen。
 *
 * 方案列表来自服务端 /api/catalog，客户端不写价格：
 *  - 分 → 元 的换算只在这里做一次，避免多处换算不一致；
 *  - 按 kind 分组：pass = 有效期道具，points = 点数档。
 *
 * 关于「包月」：微信虚拟支付的 mode 固定为 short_series_goods，
 * signData 没有续费字段，所以包月做成**一次性购买的 30 天有效期道具**，
 * 不能写成「每月自动续费」——那是做不到的承诺。
 *
 * 到账依据是服务端查单，不是支付组件的 success 回调——
 * 用户付完立刻杀进程会丢回调，只看回调就会漏发货。
 */

/* 深空仪器（2026-09-27）：卡片配色收敛到 CSS（.plan-card.is-selected），
   组件里不再逐套餐算颜色。单价「约 ¥X/张」按当前单价现算，不写死。 */
function PlanCard({
  plan,
  selected,
  onSelect
}: {
  plan: CatalogPlan
  selected: boolean
  onSelect: () => void
}) {
  const visual = planVisual[plan.planId]
  // 每张图均价 = 每点单价 × 单张耗点。points 为 0 的档位不展示（除零保护）。
  const perImage =
    plan.points > 0
      ? `约 ¥${((plan.priceFen / 100 / plan.points) * currentImageCost()).toFixed(2)}/张`
      : null

  return (
    <View
      className={`plan-card ${selected ? 'is-selected' : ''}`}
      onClick={onSelect}
    >
      <View className='plan-card-top'>
        <Text className='eyebrow'>{visual?.eyebrow ?? planEyebrow(plan.planId)}</Text>
        {visual?.badge ? (
          <Text className='plan-badge'>
            {visual.badge}
          </Text>
        ) : null}
      </View>
      <View className='plan-card-main'>
        <View className='plan-copy'>
          <Text className='plan-name'>{plan.name}</Text>
          {perImage ? <Text className='plan-unit'>{perImage}</Text> : null}
          <Text className='plan-detail'>{plan.note}</Text>
        </View>
        <Text className='plan-price'>{formatPrice(plan.priceFen)}</Text>
        {/* ⚠️ 圆点必须留在这一行**流里**（第三个子项），不能拿 `position: absolute`
            甩到卡片右下角 —— 2026-09-24 真机验收时它正压在价格上（见 forme.scss
            里 `.plan-radio` 的注释）。放这一行里，任何字号 / 机型都不会再叠。 */}
        <View className='plan-radio'>
          <Text>{selected ? '✓' : ''}</Text>
        </View>
      </View>
    </View>
  )
}

export default function Recharge() {
  const [balance, setBalance] = useState(() => readCachedBalance() ?? DEMO_BALANCE)
  const [passExpiresAt, setPassExpiresAt] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [selected, setSelected] = useState('')
  const [paying, setPaying] = useState(false)

  const load = useCallback(async () => {
    try {
      const [next, account] = await Promise.all([getCatalog(), getAccount()])
      setCatalog(next)
      setBalance(account.balance)
      setPassExpiresAt(account.passExpiresAt)
      setSelected((prev) => prev || next.plans[1]?.planId || next.plans[0]?.planId || '')
    } catch {
      // 目录拉不到时保持上一次的状态，不要让页面变空
    }
  }, [])

  // 从支付返回、或从别处充完点回来，都要刷新
  useDidShow(() => {
    load()
  })

  const plans = catalog?.plans ?? []
  const passes = plans.filter((plan) => plan.kind === 'pass')
  const points = plans.filter((plan) => plan.kind === 'points')
  const current = plans.find((plan) => plan.planId === selected)
  const passLabel = formatPassExpiry(passExpiresAt)

  const handlePay = async () => {
    if (!current || paying) return
    setPaying(true)
    try {
      const outcome = await purchasePlan(current.planId)

      if (outcome.status === 'delivered') {
        setBalance(outcome.balance)
        setPassExpiresAt(outcome.passExpiresAt)
        const extra = outcome.durationDays > 0 ? `，并开通 ${outcome.durationDays} 天创作权益` : ''
        // 点数换算成"张"：用户对"点"没感觉，对"能画几张"有感觉
        const images = Math.floor(outcome.points / currentImageCost())
        const valueLine = images > 0 ? `约可生成 ${images} 张，` : ''
        const { confirm } = await Taro.showModal({
          title: '已到账',
          content: `+${outcome.points} 点${extra}，${valueLine}当前余额 ${outcome.balance} 点。`,
          showCancel: false,
          confirmText: '去创作'
        })
        // 付完钱情绪最高点，直接送进创作页，别让他自己找入口
        if (confirm) Taro.navigateTo({ url: '/pages/create-freeform/index' })
        return
      }

      if (outcome.status === 'pending') {
        await Taro.showModal({
          title: '支付结果确认中',
          content: '点数到账可能有几秒延迟，稍后可回到本页查看余额。',
          showCancel: false,
          confirmText: '知道了'
        })
        return
      }

      // cancelled：用户主动取消，不打扰
    } catch (error) {
      await Taro.showModal({
        title: '支付未完成',
        content: error instanceof Error ? error.message : '请稍后重试',
        showCancel: false,
        confirmText: '知道了'
      })
    } finally {
      setPaying(false)
      load()
    }
  }

  return (
    <View className='app-screen page-pad page-enter'>
      <AppHeader title='充值中心' />
      <View className='recharge-balance'>
        <View className='balance-main'>
          <Text className='eyebrow'>CURRENT BALANCE</Text>
          <Text className='balance-value'>
            <Text className='balance-mark'>✦</Text> {balance} 点
          </Text>
          {/* 单价从服务端缓存里取，不写死：调价后老版本客户端也能显示对的数 */}
          <Text className='balance-note'>
            每张图片消耗 {currentImageCost()} 点 · 点数以套餐为准
          </Text>
          {passLabel ? <Text className='balance-note'>创作权益 {passLabel}</Text> : null}
        </View>
        <View className='balance-orb'>
          <Text>✦</Text>
        </View>
      </View>

      <View className='recharge-heading'>
        <Text className='eyebrow'>CHOOSE YOUR RHYTHM</Text>
        <View className='h1'>
          <Text className='line'>为下一组想法</Text>
          <Text className='line accent'>补充一点能量。</Text>
        </View>
        <Text className='recharge-copy'>
          每张图片消耗 {currentImageCost()} 点，到账点数以所选套餐为准；创作权益为一次性购买，有效期 30 天。
        </Text>
      </View>

      {passes.length ? (
        <View className='plan-section'>
          <View className='plan-section-title'>
            <View className='h2'>创作权益</View>
            <Text className='plan-caption'>一次性购买 · 30 天内有效</Text>
          </View>
          <View className='plan-list'>
            {passes.map((plan) => (
              <PlanCard
                key={plan.planId}
                plan={plan}
                selected={selected === plan.planId}
                onSelect={() => setSelected(plan.planId)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View className='plan-section'>
        <View className='plan-section-title'>
          <View className='h2'>点数充值</View>
          <Text className='plan-caption'>一次性购买 · 点数不过期</Text>
        </View>
        <View className='plan-list'>
          {points.map((plan) => (
            <PlanCard
              key={plan.planId}
              plan={plan}
              selected={selected === plan.planId}
              onSelect={() => setSelected(plan.planId)}
            />
          ))}
        </View>
      </View>

      <View
        className='primary-cta recharge-cta'
        hoverClass='is-pressed'
        onClick={handlePay}
      >
        <Text>{paying ? '处理中…' : '继续'}</Text>
        <Text className='cta-price'>{current ? formatPrice(current.priceFen) : ''}</Text>
      </View>

      <Text className='recharge-footnote'>点数不过期 · 支付由微信安全保障</Text>
    </View>
  )
}
