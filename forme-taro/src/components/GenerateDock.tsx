import Taro from '@tarojs/taro'
import { View, Text } from '@tarojs/components'

type Props = {
  metaLabel: string
  cost: number
  loading?: boolean
  /**
   * 前置条件没齐时禁用主按钮（缺素材、缺确认）。
   * ⚠️ 与 `loading` 分开：`loading` 是「正在跑」，`disabled` 是「还轮不到你跑」。
   * 两者视觉上都是灰按钮，但**原因不同、文案不同**，混成一个 prop 会让
   * 页面没法把「为什么不能点」说清楚。
   */
  disabled?: boolean
  /**
   * 未就绪时的说明，中性色。
   * ⚠️ 不是 `error`：前置条件没齐是**正常状态**，不是出错。
   * 用报错色会让用户以为自己操作错了。
   */
  hint?: string
  error?: string
  /**
   * 点数不足：传「本次需要多少点」，dock 渲染整行可点的「去充值」行，
   * 替代干巴巴的报错文字。null/undefined = 没这回事，走 error/hint。
   */
  shortfall?: number | null
  onGenerate: () => void
}

/**
 * 底部固定生成条：消耗点数 + 主按钮 + 提示 / 错误。
 *
 * ⚠️ 按钮上**只有「生成」两个字**（2026-09-24 真机验收后改）。
 * 原来是「✦ 生成 N 张 ✦ N」—— 一颗按钮里塞了图标、张数、单价三样东西，
 * 而这三样在**按钮上方那一行**（`metaLabel` + `cost`）已经各有一份。
 * 同一件事在一屏里印两遍，按钮读起来就不像按钮，像一句说明。
 * 视觉上同时改成苹果风胶囊（见 `forme.scss` 的 `.generate-cta`）。
 *
 * 因此 `count` 这个 prop 也一并删掉了：它唯一的消费者就是那句按钮文案。
 * 张数仍由页面自己表达（`BATCH_SIZE` 照旧进请求体，价格也照旧按它算）。
 *
 * 「为什么不能点」依旧由 `hint` 承担，**不往按钮里塞状态文案** ——
 * 把文案改成「请先上传」会让用户以为这是一句提示而不是按钮。
 * 「生成中…」是例外：它是**这颗按钮自己的状态**，不是提示。
 */
export default function GenerateDock({
  metaLabel,
  cost,
  loading,
  disabled,
  hint,
  error,
  shortfall,
  onGenerate
}: Props) {
  const inert = Boolean(loading || disabled)

  return (
    <View className='generate-dock'>
      {shortfall != null ? (
        <View
          className='generate-recharge'
          onClick={() => Taro.navigateTo({ url: '/pages/recharge/index' })}
        >
          <Text className='recharge-text'>点数不足，还需 {shortfall} 点</Text>
          <Text className='recharge-go'>去充值 →</Text>
        </View>
      ) : null}
      {shortfall == null && error ? <Text className='generate-error'>{error}</Text> : null}
      {shortfall == null && !error && hint ? <Text className='generate-hint'>{hint}</Text> : null}
      <View className='dock-meta'>
        <Text>{metaLabel}</Text>
        <Text className='dock-cost'>
          <Text className='cost-mark'>✦</Text> {cost} 点
        </Text>
      </View>
      <View
        className={`primary-cta generate-cta ${inert ? 'is-disabled' : ''} ${loading ? 'is-loading' : ''}`}
        hoverClass={inert ? 'none' : 'is-pressed'}
        onClick={() => {
          if (!inert) onGenerate()
        }}
      >
        {loading ? <View className='spinner' /> : null}
        <Text>{loading ? '生成中…' : '生成'}</Text>
      </View>
    </View>
  )
}
