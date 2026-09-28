import Taro from '@tarojs/taro'

/**
 * 系统尺寸（px）
 * ------------------------------------------------------------------
 * 小程序改成了 navigationStyle: 'custom'，状态栏/灵动岛那一块要我们自己让位。
 *
 * **不要用 env(safe-area-inset-top)**：安卓上状态栏不是 CSS 安全区，
 * env() 返回 0，内容会直接压到时钟上 —— 而且只在安卓真机上看得到，
 * 开发者工具里一切正常。
 *
 * 缓存一次：这些值在一次运行内不会变，而 getSystemInfoSync 是兼容性更好的同步桥调用。
 * 取不到就给 0 —— 宁可少让一点位，也不要因为一个装饰性数值把整页搞崩。
 */
type SysInfo = {
  statusBarHeight: number
  screenWidth: number
}

let cached: SysInfo | null = null

function sysInfo(): SysInfo {
  if (cached === null) {
    try {
      const info = Taro.getSystemInfoSync()
      cached = {
        statusBarHeight: info.statusBarHeight ?? 0,
        screenWidth: info.screenWidth ?? 0
      }
    } catch {
      cached = { statusBarHeight: 0, screenWidth: 0 }
    }
  }
  return cached
}

/** 状态栏高度（px）。顶部让位用它。 */
export function statusBarHeight(): number {
  return sysInfo().statusBarHeight
}

/**
 * 微信胶囊按钮在屏幕右侧占掉的宽度（px，含一小段间隙）
 * ==================================================================
 * **为什么需要它：首页头像被胶囊压住过（2026-09-22 从截图实测出来的）。**
 *
 * `navigationStyle: 'custom'` 只是**不画原生导航栏**，微信**照样会画胶囊**
 * （「···」+「⊙」）。所以顶栏右侧不是自由空间。
 *
 * 实测：393 宽的屏上胶囊占 x306..384 / y58..81；
 * 而 `.hd-avatar` 是右对齐到 `393 - 20 = 373` 的 34px 圆（x339..373 / y63..97）
 * ⇒ **x 和 y 都重叠**，头像只从胶囊下沿露出一条 13px 的边。
 *
 * ⇒ 顶栏右侧的内容必须让出 `capsuleInsetRight()`。
 *
 * ⚠️ 单位是 **px**，不是 rpx。`getMenuButtonBoundingClientRect()` 返回逻辑 px，
 *    内联样式里的 px 也是同一套空间，**不要**再套 pxTransform。
 *
 * ⚠️ 兜底 108 是**保守**值：取不到胶囊信息时按「375 宽的胶囊 87 + 右边距 7」
 *    折算到 393 再留 8px 间隙。宁可右边多空一点（不影响可用性），
 *    也不要少让（内容被压住 —— 那才是看起来像坏了）。
 */
const CAPSULE_INSET_FALLBACK = 108

export function capsuleInsetRight(gap = 8): number {
  try {
    const rect = Taro.getMenuButtonBoundingClientRect()
    const width = sysInfo().screenWidth
    // 拿不到胶囊时这个 API 会返回全 0，用 width/left 一起挡掉
    if (rect && rect.width > 0 && rect.left > 0 && width > 0) {
      return Math.round(width - rect.left + gap)
    }
  } catch {
    // 落到兜底
  }
  return CAPSULE_INSET_FALLBACK
}
