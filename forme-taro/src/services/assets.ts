import { APP_CONFIG } from '@/config'
import { ApiError } from './api-error'
import { readHistory, writeHistory, type HistoryItem } from './history'
import { request } from './http'

/**
 * 资产库（服务端为准）
 * ------------------------------------------------------------------
 * 服务端在出图结算成功时就把结果写进了资产库（见 `image.mjs` 的 `saveAsset`），
 * 所以这里只需要读回来。
 *
 * 为什么不能只读本地缓存：本地缓存上限约 10MB、卸载即丢、换手机不同步，
 * 而这些图是用户花了钱生成的。丢作品 = 客服工单 + 退款。
 *
 * 策略：**在线以服务端为准，失败才回退本地缓存**，并把降级原因带回界面，
 * 让用户知道「现在看到的是本机残留，不是全部」。
 */

/** server = 服务端权威列表；cache = 服务端不可达，降级成本地缓存 */
export type AssetSource = 'server' | 'cache'

export type AssetsResult = {
  items: HistoryItem[]
  source: AssetSource
  /** 仅降级时非空，用于界面提示 */
  degradedReason: string | null
}

/** 服务端资产记录：{ id, title, skill, templateId, images, createdAt } */
type ServerAsset = {
  id?: string
  title?: string
  skill?: string
  templateId?: string
  images?: unknown
  createdAt?: string
}

function normalizeAsset(raw: ServerAsset, index: number): HistoryItem {
  const images = Array.isArray(raw?.images) ? raw.images.filter((url): url is string => Boolean(url)) : []
  return {
    id: String(raw?.id ?? `asset-${index}`),
    title: raw?.title || '未命名作品',
    skill: raw?.skill || 'image',
    /**
     * ⚠️ 这一行不能少。服务端一直存着也回传着 `templateId`
     * （`forme-server/src/image.mjs` 的 `saveAsset`），是这里白名单式重建时把它丢掉的。
     * 丢了之后资产库的分类筛选只能拿 title/skill 猜关键词，而真实写入的
     * `title='轨道圆场' skill='CIRCULAR EDITORIAL'` 一个关键词都不含 ——
     * 于是「海报」「产品」两个筛选项永远是空列表，不报错。
     *
     * 空串要归一成 undefined，否则下游 `id.startsWith(prefix)` 会拿空串去比。
     */
    templateId: typeof raw?.templateId === 'string' && raw.templateId ? raw.templateId : undefined,
    createdAt: raw?.createdAt || new Date().toISOString(),
    images
  }
}

export async function loadAssets(): Promise<AssetsResult> {
  // 演示模式没有服务端可连，直接用本地缓存，且不算「降级」
  if (APP_CONFIG.useMockGeneration) {
    return { items: readHistory(), source: 'cache', degradedReason: null }
  }

  try {
    const payload = await request<{ assets?: ServerAsset[] }>('/api/assets')
    const items = (payload?.assets ?? [])
      .map(normalizeAsset)
      .filter((item) => item.images.length > 0)

    // 服务端是权威列表，成功一次就整体覆盖本地缓存。
    // 不做合并：合并会让用户在别处删掉的作品在本机复活。
    writeHistory(items)
    return { items, source: 'server', degradedReason: null }
  } catch (error) {
    return {
      items: readHistory(),
      source: 'cache',
      degradedReason: error instanceof Error ? error.message : '无法连接服务端'
    }
  }
}

export async function deleteAsset(assetId: string): Promise<void> {
  if (!APP_CONFIG.useMockGeneration) {
    try {
      await request(`/api/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' })
    } catch (error) {
      // 404 = 服务端已经没有这条记录了，对调用方而言等同于删除成功。
      // 本地缓存与服务端不一致时（换过设备、在别处删过），这里必须幂等，
      // 否则用户会陷入「点了删除但它一直在」的状态。
      if (!(error instanceof ApiError && error.status === 404)) throw error
    }
  }

  writeHistory(readHistory().filter((item) => item.id !== assetId))
}
