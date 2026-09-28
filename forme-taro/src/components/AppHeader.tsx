import type { CSSProperties } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { capsuleInsetRight, statusBarHeight } from '@/services/system'

type Props = {
  title: string
}

/**
 * 顶部栏（返回 + 标题）
 * ------------------------------------------------------------------
 * 对应原型的 <Header>。原型右侧那个齿轮是装饰（`<Header>` 里没绑任何行为），
 * 这里不画 —— 一个点了没反应的按钮比没有按钮更糟。
 *
 * **为什么必须自己画**：小程序用 navigationStyle: 'custom' 换来了全屏
 * （app 背景一直铺到屏幕最上沿，盖住状态栏/灵动岛），代价是微信不再提供
 * 导航栏，**也不再提供返回箭头**。所以每个非首页页面都必须渲染这个组件，
 * 否则用户进去就出不来。
 *
 * ⚠️ 这条不变量已钉进 `scripts/verify-dist.mjs`：逐个检查每个非首页产物里
 * 有没有这个组件（用各页自己的标题做锚点）。删掉某页的 <AppHeader> 会
 * 直接构建失败 —— 因为那是「用户出不去」，不是样式问题。
 *
 * 状态栏让位由组件自己负责（内联注入 --safe-t，样式表里消费），
 * 页面不需要知道这件事。
 *
 * ⚠️ 但**胶囊**要让页面知道（内联注入 --capsule-r）：
 * `navigationStyle: 'custom'` 只是不画原生导航栏，微信照样画胶囊。
 * 实测 393 宽屏上胶囊占 x306..384 / y58..81，而顶栏的内容带是 y0..(safe-t+54)，
 * **竖直方向完全压在胶囊那一行里**。
 *
 * 这里和首页的处理**不一样，是刻意的**：
 *   · 首页 .hd-topline 是「品牌行贴左 + 头像贴右」，右对齐的实心内容
 *     ⇒ 必须真的把 padding-right 让出去，否则头像被压住。
 *   · 顶栏是 `space-between`，左「✕」+ 中标题 + 右**空白占位**。
 *     右侧占位本来就是空的，胶囊压在上面不产生任何视觉损失；
 *     而如果照搬首页把 padding-right 也加宽，标题会被**整体左移 54px**，
 *     看起来像没居中 —— 修一个不存在的问题，造一个真的问题。
 *   ⇒ 所以这里只做一件事：给标题**封顶**，让它永远伸不进胶囊的领地
 *     （见 forme.scss 的 .header-title max-width）。当前最长的标题是 5 字，
 *     离封顶还差一半，所以这个改动**今天不改变任何渲染**，它是一道闸。
 */
export default function AppHeader({ title }: Props) {
  const goBack = () => {
    // 从分享卡片/扫码直接进到二级页时页面栈里只有一层，navigateBack 会静默失败
    if (Taro.getCurrentPages().length > 1) {
      Taro.navigateBack()
      return
    }
    Taro.reLaunch({ url: '/pages/home/index' })
  }

  return (
    <View
      className='app-header'
      style={
        {
          '--safe-t': `${statusBarHeight()}px`,
          // 给标题封顶用（见上方注释）：只在 .header-title 的 max-width 里被消费，
          // 不参与 .app-header 的 padding —— 那会把标题挤得不居中。
          '--capsule-r': `${capsuleInsetRight()}px`
        } as CSSProperties
      }
    >
      <View className='header-back' hoverClass='is-pressed' onClick={goBack}>
        <Text>✕</Text>
      </View>
      <Text className='header-title'>{title}</Text>
      {/* 与左侧等宽的占位：让标题真正居中 */}
      <View className='header-side' />
    </View>
  )
}
