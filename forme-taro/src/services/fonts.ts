import Taro from '@tarojs/taro'
import { APP_CONFIG } from '@/config'

/**
 * 品牌字体
 * ------------------------------------------------------------------
 * 原型用的是 Space Grotesk + DM Mono，小程序没有内置。
 * 两种做法：
 *  1. 配置 APP_CONFIG.brandFontBase，用 wx.loadFontFace 从 CDN 拉取
 *     （域名必须加入「downloadFile 合法域名」）。
 *  2. 不配置，回落到系统字体（苹方 / 思源黑体）。
 *
 * 样式表里所有字体声明都写成完整字体栈（'Space Grotesk', …, 'PingFang SC'），
 * 所以加载失败或未配置时浏览器会自动回落到系统字体，不需要切换任何 class。
 */

const FONT_FILES = [
  { family: 'Space Grotesk', file: 'SpaceGrotesk-Medium.ttf', weight: '500' },
  { family: 'Space Grotesk', file: 'SpaceGrotesk-SemiBold.ttf', weight: '600' },
  { family: 'DM Mono', file: 'DMMono-Regular.ttf', weight: '400' }
]

let loaded = false

export async function loadBrandFonts(): Promise<boolean> {
  if (loaded || !APP_CONFIG.brandFontBase) return false
  if (process.env.TARO_ENV !== 'weapp') return false

  const base = APP_CONFIG.brandFontBase.replace(/\/+$/, '')

  try {
    await Promise.all(
      FONT_FILES.map((font) =>
        Taro.loadFontFace({
          global: true,
          family: font.family,
          source: `url("${base}/${font.file}")`,
          desc: { weight: font.weight }
        } as any)
      )
    )
    loaded = true
    return true
  } catch {
    // 拉取失败就保持系统字体，不阻断启动
    return false
  }
}
