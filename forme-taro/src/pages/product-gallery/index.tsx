import { useState } from 'react'
import { Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { AppHeader } from '@/components'
import { productReplacementTemplates } from '@/data/prompt-templates'
import {
  PRODUCT_STUDIO_INTENTS,
  productStudioIntentMeta,
  productStudioOptions,
  productStudioParamName,
  type ProductStudioIntent
} from '@/services/product-studio'

/**
 * 产品工作室
 * ==================================================================
 * 顶层三个**同级**创作意图（交接文件 §「产品工作室的导航与信息架构」）：
 *
 *   产品拍摄 —— 棚拍 / 生活方式 / 人物使用
 *   电商主图 —— 白底主图 / 纯色卖点图 / 细节特写
 *   精选场景 —— 原有 14 个 `productReplacementTemplates`，**一个不删**
 *
 * ⚠️ 不要把三个能力塞成平铺的九宫格（交接文件明写）。前两个是**固定工作流**，
 *    只有一个必填项（产品图）、界面上没有参考图与权利确认；第三个是 14 个
 *    锁定了艺术指导的高级场景。平铺会让用户以为它们是同一种东西。
 *
 * ⚠️ 前两个意图的标题 / 说明从 `PRODUCT_STUDIO_INTENTS` 读，
 *    模式清单从 `productStudioOptions()` 读 —— 这一页**不写第二份**。
 *    各写一份时，加一个模式这一页会静默漏掉它（不报错，只是选不到）。
 *
 * ⚠️ 交接文件写的是「三张大图」。这里落成了**三张大的文字卡**，
 *    原因：仓库里**没有**按模式（棚拍 / 生活方式 / …）分的图，
 *    只有每个工作流一张展示图。凭想象配 6 张图会比文字卡更糟 ——
 *    图会暗示一个并不存在的既有素材。等有了真实的模式样图再换成大图。
 */

/** 顶层 tab。前两个来自服务层的意图表，第三个是原有模板库。 */
type Tab = ProductStudioIntent['kind'] | 'scene'

const TABS: readonly { key: Tab; title: string; description: string }[] = [
  ...PRODUCT_STUDIO_INTENTS.map((item) => ({
    key: item.kind,
    title: item.title,
    description: item.description
  })),
  {
    key: 'scene',
    title: '精选场景',
    description: `${productReplacementTemplates.length} 个锁定艺术指导的高级场景，上传即可替换主体`
  }
]

export default function ProductGallery() {
  const [tab, setTab] = useState<Tab>(PRODUCT_STUDIO_INTENTS[0].kind)

  const activeTab = TABS.find((item) => item.key === tab) ?? TABS[0]
  const studioKind: ProductStudioIntent['kind'] | null = tab === 'scene' ? null : tab

  /**
   * 跳到 composer 并把选中的模式带过去。
   * ⚠️ 参数名走 `productStudioParamName()`，不在这一页写 `'mode'` 字面量 ——
   *    页面那一侧读的是同一个来源。两边各写一份就会漂，
   *    而漂开的表现是「选的是生活方式，进去显示棚拍」，不报错。
   */
  const openMode = (value: string) => {
    if (studioKind === null) return
    const meta = productStudioIntentMeta(studioKind)
    const param = productStudioParamName(studioKind)
    Taro.navigateTo({ url: `${meta.route}?${param}=${value}` })
  }

  return (
    <View className='app-screen page-pad page-enter'>
      <AppHeader title='产品工作室' />

      <View className='result-intro'>
        <Text className='eyebrow'>PRODUCT STUDIO</Text>
        <View className='h1'>
          <Text className='line'>一张产品图，</Text>
          <Text className='line accent'>三种做法。</Text>
        </View>
        <Text className='result-copy'>先选一个方向，再上传你的产品图片。</Text>
      </View>

      {/* ---------------- 顶层三选一 ---------------- */}
      <View className='studio-tabs'>
        {TABS.map((item) => (
          <View
            key={item.key}
            className={`studio-tab ${tab === item.key ? 'is-active' : ''}`}
            hoverClass='press-dim'
            onClick={() => setTab(item.key)}
          >
            {/* 选中态不能只靠颜色 —— 加一个 ✓ 字形，读屏与黑白截图都分得出 */}
            <Text className='studio-tab-title'>
              {tab === item.key ? '✓ ' : ''}
              {item.title}
            </Text>
          </View>
        ))}
      </View>
      <Text className='studio-tab-note'>{activeTab.description}</Text>

      {studioKind === null ? (
        /* ---------------- 精选场景：原有 14 个模板，一字不动 ---------------- */
        <View className='product-template-grid'>
          {productReplacementTemplates.map((item, index) => (
            <View
              key={item.id}
              className='product-template-card'
              hoverClass='is-pressed'
              onClick={() => Taro.navigateTo({ url: `/pages/create-product/index?id=${item.id}` })}
            >
              <View className='product-template-image'>
                <Image className='product-img' src={item.cover} mode='aspectFill' lazyLoad />
                <Text className='product-index'>{String(index + 1).padStart(2, '0')}</Text>
              </View>
              <View className='product-template-copy'>
                <Text className='eyebrow'>{item.skill}</Text>
                <View className='h3'>{item.name}</View>
                <Text className='product-desc'>{item.description}</Text>
              </View>
              <Text className='product-arrow'>›</Text>
            </View>
          ))}
        </View>
      ) : (
        /* ---------------- 固定工作流：三选一，选完再上传 ---------------- */
        <View className='studio-mode-grid'>
          {productStudioOptions(studioKind).map((option, index) => (
            <View
              key={option.value}
              className='studio-mode-card'
              hoverClass='press-dim'
              onClick={() => openMode(option.value)}
            >
              <Text className='studio-mode-index'>{String(index + 1).padStart(2, '0')}</Text>
              <View className='studio-mode-copy'>
                <Text className='studio-mode-title'>{option.label}</Text>
                <Text className='studio-mode-desc'>{option.copy}</Text>
              </View>
              <Text className='studio-mode-arrow'>›</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}
