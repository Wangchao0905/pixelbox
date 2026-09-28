import { Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { AppHeader } from '@/components'
import { avatarTemplates } from '@/data/prompt-templates'

/**
 * 头像模板库
 * ------------------------------------------------------------------
 * 与「产品工作室」同一套骨架：模板已锁定绘画规格，用户只需上传一张图。
 *
 * ⚠️ 这里复用了 `product-template-*` 那组样式类。它们其实是通用的
 *    「单列模板卡」（`flex-direction: column` + 112px 缩略图 + 文案 + 箭头），
 *    跟「产品」没有关系。**没有另写一套 avatar-template-\* 是刻意的** ——
 *    两份长得一样、只差前缀的样式迟早会漂移，而漂移是静默的。
 *    真正的清理是把它们改名成中性的 `template-grid-*`，但那要同时动
 *    product-gallery 和 styles/forme.scss，属于独立的改动，不夹在这里做。
 */
export default function AvatarGallery() {
  return (
    <View className='app-screen page-pad page-enter'>
      <AppHeader title='头像模板' />
      <View className='result-intro'>
        <Text className='eyebrow'>REIMAGINE YOUR FACE</Text>
        <View className='h1'>
          <Text className='line'>上传一张照片，</Text>
          <Text className='line accent'>变成图标。</Text>
        </View>
        <Text className='result-copy'>
          每个模板的绘画规格已锁定，只需上传要改编的图像参考。
        </Text>
      </View>

      <View className='product-template-grid'>
        {avatarTemplates.map((item, index) => (
          <View
            key={item.id}
            className='product-template-card'
            hoverClass='is-pressed'
            onClick={() => Taro.navigateTo({ url: `/pages/create-avatar/index?id=${item.id}` })}
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
    </View>
  )
}
