import Taro from '@tarojs/taro'
import { STORAGE_KEYS } from '@/config'

export type HistoryItem = {
  id: string
  title: string
  skill: string
  /**
   * 生成这条作品的模板 id，形如 `poster-xxx` / `product-xxx` / `avatar-xxx` / `freeform`。
   * ------------------------------------------------------------------
   * ⚠️ **这个字段必须一路带到底。** 资产库的分类筛选（`assetMatchesFilter`）靠它的前缀判定。
   * 曾经它在 `services/assets.ts` 的 `normalizeAsset` 里被白名单式重建丢掉，于是筛选
   * 只能退化成「拿 title/skill 猜关键词」—— 猜错不报错，只是「海报」「产品」两个
   * 筛选项**永远是空列表**，而界面照常渲染、门禁全绿。
   *
   * 服务端一直存着也回传着它（`forme-server/src/image.mjs` 的 `saveAsset`），
   * 丢的只是客户端这一侧。所以补回来之后，**历史作品也能被正确分类**。
   *
   * 可选：只写在本地缓存里、且在这次修复之前存下的记录没有它 ——
   * 所以 `assetMatchesFilter` 必须保留关键词兜底，不能只认前缀。
   */
  templateId?: string
  createdAt: string
  images: string[]
}

/**
 * 生成历史（本地缓存）
 * ------------------------------------------------------------------
 * **本地缓存只是离线兜底，不是作品的唯一存储。**
 * 权威列表在服务端（`GET /api/assets`，见 `services/assets.ts`）——
 * 小程序本地缓存上限约 10MB、卸载即丢、换手机不同步，
 * 而这些图是用户花钱生成的，丢了就是客服工单。
 *
 * 所以：在线时以服务端列表整体覆盖本地；离线时才回退到这里。
 */

const MAX_ITEMS = 12

export function readHistory(): HistoryItem[] {
  try {
    const raw = Taro.getStorageSync(STORAGE_KEYS.history)
    if (!raw) return []
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * 整体覆盖本地缓存。服务端拉取成功后调用。
 * ------------------------------------------------------------------
 * 刻意做成「覆盖」而不是「合并」：合并会让用户在别的设备上删掉的
 * 作品在本机复活，用户会认为删除没生效。
 */
export function writeHistory(items: HistoryItem[]): void {
  try {
    Taro.setStorageSync(STORAGE_KEYS.history, JSON.stringify(items.slice(0, MAX_ITEMS)))
  } catch {
    // 缓存写满时忽略：界面已经拿到了服务端数据，不写缓存不影响本次展示
  }
}

export function rememberResult(item: HistoryItem): HistoryItem[] {
  const next = [item, ...readHistory().filter((entry) => entry.id !== item.id)].slice(0, MAX_ITEMS)
  writeHistory(next)
  return next
}

export function clearHistory() {
  try {
    Taro.removeStorageSync(STORAGE_KEYS.history)
  } catch {
    // ignore
  }
}

export function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
