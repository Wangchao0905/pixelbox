import { PropsWithChildren } from 'react'
import { useLaunch } from '@tarojs/taro'
import { warmCatalog } from './services/account'
import { loadBrandFonts } from './services/fonts'
import { ensureSession } from './services/session'
import './app.scss'

function App({ children }: PropsWithChildren<any>) {
  useLaunch(() => {
    // 1. 换取自定义登录态（服务端用 code + AppSecret 调 code2Session）
    ensureSession().catch(() => undefined)
    // 2. 品牌字体：仅在配置了 CDN 域名时才加载，否则回落到系统字体。
    //    样式表里已经写好完整字体栈，加载失败不会影响排版。
    loadBrandFonts().catch(() => undefined)
    // 3. 预热商品目录：把服务端的单价与 AIGC 标识文案收进缓存。
    //    结果页/资产库都要显示标识，而目录原本只在充值页才拉，
    //    不预热的话没进过充值页的用户会一直用打包时的兜底文案。
    warmCatalog().catch(() => undefined)
  })

  return children
}

export default App
