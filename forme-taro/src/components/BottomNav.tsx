import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { APP_NAV_ITEMS, type AppNavKey } from '@/data/app-nav'

type Props = {
  active?: AppNavKey
}

/**
 * 底部导航
 * ------------------------------------------------------------------
 * 没有用小程序原生 tabBar，原因：
 *  1. 原生 tabBar 无法做半透明毛玻璃与自定义选中样式，会和设计语言脱节；
 *  2. 资产库需要带参数（筛选、滚动位置），tabBar 页面不支持带参跳转。
 * 代价是需要自己用 reLaunch 切换，跳转时页面栈会重置——对这四个一级入口是合理的。
 */
export default function BottomNav({ active = 'create' }: Props) {
  const handleTap = (key: AppNavKey, path: string) => {
    if (key === active) return
    Taro.reLaunch({ url: path })
  }

  return (
    <View className='bottom-nav'>
      {APP_NAV_ITEMS.map((item) => (
        <View
          key={item.key}
          className={`nav-item ${active === item.key ? 'is-active' : ''}`}
          onClick={() => handleTap(item.key, item.path)}
        >
          <Text className='nav-icon'>{item.icon}</Text>
          <Text>{item.label}</Text>
        </View>
      ))}
    </View>
  )
}
