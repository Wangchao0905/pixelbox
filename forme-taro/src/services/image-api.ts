import Taro from '@tarojs/taro'
import { APP_CONFIG } from '@/config'
import { apiUrl, toApiError } from './api-error'
import { rememberBalance } from './account'
import { composeLabeledImage, type LabeledExport } from './export-image'
import { ensurePrivacyAuthorized, privacyErrorMessage } from './privacy'
import { createRequestKeyStore, fingerprintOf } from './request-key'
import { ensureSession } from './session'

import mockA from '@/assets/product-gelato-reference.jpg'
import mockB from '@/assets/product-tennis-bag-reference.jpg'
import mockC from '@/assets/product-soda-condensation-reference.jpg'
import mockD from '@/assets/product-vitamin-lemon-reference.jpg'
import mockE from '@/assets/product-herbal-basket-reference.jpg'
import mockF from '@/assets/product-blue-mist-reference.jpg'
import mockG from '@/assets/product-skincare-portrait-reference.jpg'
import mockH from '@/assets/product-perfume-cherry-reference.jpg'

export type GeneratedImage = { url: string; fileId?: string; revisedPrompt?: string }

/** 用户上传的素材：小程序里是本地临时文件路径 */
export type ImageAsset = {
  name: string
  path: string
  size?: number
  /**
   * 服务端已有的 fileId（预设资源用，如 `preset:model-01`）。
   * 有它时 `editImages` 直接透传，不走上传。path 此时为空。
   */
  fileId?: string
}

/** 生成结果入资产库需要的元信息，不传则不入库 */
export type AssetMeta = {
  title: string
  skill?: string
  templateId?: string
}

export type GenerateParams = {
  prompt: string
  model: string
  quality: string
  size: string
  n?: number
  asset?: AssetMeta
}

export type EditParams = GenerateParams & {
  images: ImageAsset[]
  /** 透明背景：只有「一键抠图」模板会传，服务端只认 'transparent' */
  background?: 'transparent'
}

const MOCK_POOL = [mockA, mockB, mockC, mockD, mockE, mockF, mockG, mockH]

function hashSeed(text: string) {
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 100000
  }
  return hash
}

/**
 * 演示模式：按提示词派生一组稳定的本地图片，保证同一提示词结果一致。
 *
 * 注意这里用的是设计稿里的真实产品照做占位。它们**代表**生成结果，
 * 所以导出时同样会被打上「AI 生成」标识 —— 这是刻意的：演示模式的意义
 * 就是预演生产体验。但这些图本身不是 AI 生成的，所以
 * `useMockGeneration` **绝不能在生产包里打开**（`.env.production` 里
 * `TARO_APP_USE_MOCK=0`），否则就是在给真实照片贴 AI 标签，性质比漏标更糟。
 */
function mockResults(prompt: string, n: number): GeneratedImage[] {
  const seed = hashSeed(prompt || 'forme')
  return Array.from({ length: n }, (_, index) => ({
    url: MOCK_POOL[(seed + index * 3) % MOCK_POOL.length],
    revisedPrompt: prompt
  }))
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * 幂等键策略。生成是「按张扣费 + 上游可能超时」的操作，
 * 每次调用都发新 key 的话，用户网络超时后点一次「重试」就会被多扣一次钱。
 *
 * 规则本身抽在 `./request-key`（纯逻辑、不依赖 Taro，可单独验证）；
 * 这里只负责把它接到请求上。
 */
const requestKeys = createRequestKeyStore()

/**
 * 生成类请求的统一出口：自动决定复用还是新发幂等键。
 * 只有生成类接口需要幂等（按张扣费），上传与查询不需要。
 */
async function postGeneration<T>(
  path: string,
  data: Record<string, unknown>,
  timeout = APP_CONFIG.generationTimeoutMs
): Promise<T> {
  const fingerprint = fingerprintOf(path, data)
  const requestId = requestKeys.take(fingerprint)

  const payload = await post<T>(path, { ...data, requestId }, timeout)

  // 走到这里说明成功了。没走到就说明抛错了，take() 记下的
  // failed:true 会留着，下一次同内容调用就会复用同一个 id ——
  // 那正是我们要的「重试」语义。
  requestKeys.settle(fingerprint, requestId)
  return payload
}

/** 服务端返回 { images: [{ url, fileId, revisedPrompt }], balance, charged, ... } */
function normalize(payload: any): GeneratedImage[] {
  const list = payload?.images ?? payload?.data ?? []
  if (!Array.isArray(list)) return []
  return list
    .map((item: any) => {
      if (typeof item === 'string') return { url: item }
      const url = item?.url ?? (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : '')
      return { url, fileId: item?.fileId, revisedPrompt: item?.revised_prompt ?? item?.revisedPrompt }
    })
    .filter((item: GeneratedImage) => Boolean(item.url))
}

/**
 * 上传素材，拿到服务端 fileId。
 * ------------------------------------------------------------------
 * 产品替换接口只接受 fileId，不接受本地临时路径——
 * 本地路径出了这台手机就不存在了，服务端拿不到图。
 */
export async function uploadAsset(asset: ImageAsset): Promise<{ fileId: string; url: string }> {
  const token = await ensureSession()

  const res = await Taro.uploadFile({
    url: apiUrl('/api/upload'),
    filePath: asset.path,
    name: 'file',
    // 与 app.config.ts 的 networkTimeout.uploadFile 保持一致（那里有理由说明）。
    // 手机大图在慢网下 60 秒偏紧，而上传失败用户就得重来一次。
    timeout: 120000,
    header: { authorization: `Bearer ${token}` }
  })

  // 注意：wx.uploadFile 的 res.data 是字符串，不像 wx.request 会自动 parse
  let body: any = {}
  try {
    body = JSON.parse(res.data)
  } catch {
    body = {}
  }

  if (res.statusCode < 200 || res.statusCode >= 300 || !body?.fileId) {
    throw toApiError(res.statusCode, body)
  }

  return { fileId: body.fileId, url: body.url }
}

async function post<T>(path: string, data: Record<string, unknown>, timeout = APP_CONFIG.generationTimeoutMs): Promise<T> {
  const token = await ensureSession()
  const res = await Taro.request<T>({
    url: apiUrl(path),
    method: 'POST',
    data,
    timeout,
    header: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    }
  })

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw toApiError(res.statusCode, res.data)
  }
  return res.data
}

/** 响应里的 balance 是权威值，写进缓存让首页立刻同步 */
function syncBalance(payload: any) {
  if (typeof payload?.balance === 'number') rememberBalance(payload.balance)
}

export async function generateImages(params: GenerateParams): Promise<GeneratedImage[]> {
  const n = params.n ?? 1
  if (APP_CONFIG.useMockGeneration) {
    await delay(1200)
    return mockResults(params.prompt, n)
  }

  const payload = await postGeneration<any>('/api/generate-image', {
    prompt: params.prompt,
    model: params.model,
    quality: params.quality,
    size: params.size,
    n,
    asset: params.asset
  })

  syncBalance(payload)
  const images = normalize(payload)
  if (!images.length) throw new Error('服务端未返回图片')
  return images
}

export async function editImages(params: EditParams): Promise<GeneratedImage[]> {
  const n = params.n ?? 1

  if (APP_CONFIG.useMockGeneration) {
    await delay(1200)
    // 演示模式：直接把用户上传的素材作为首个结果，让「替换」的语义可见
    const uploaded = params.images.filter((item) => Boolean(item?.path)).map((item) => ({ url: item.path }))
    const rest = mockResults(params.prompt, Math.max(0, n - uploaded.length))
    return [...uploaded, ...rest].slice(0, n)
  }

  // 先拿到 fileIds 再去生成。预设资源（fileId 如 preset:model-01）直接透传，
  // 不走上传；顺序与 params.images 一致，调用方靠这个顺序写提示词里的图一/图二。
  const fileIds = await Promise.all(
    params.images.filter(Boolean).map((item) =>
      item?.fileId ? Promise.resolve(item.fileId) : uploadAsset(item).then((uploaded) => uploaded.fileId)
    )
  )
  if (!fileIds.length) throw new Error('请先上传产品图片')

  const payload = await postGeneration<any>('/api/edit-image', {
    prompt: params.prompt,
    model: params.model,
    quality: params.quality,
    size: params.size,
    n,
    fileIds,
    asset: params.asset,
    ...(params.background ? { background: params.background } : {})
  })

  syncBalance(payload)
  const images = normalize(payload)
  if (!images.length) throw new Error('服务端未返回图片')
  return images
}

/** 选择一张本地图片作为素材 */
export async function pickImage(
  { sourceType = ['album', 'camera'] }: { sourceType?: Array<'album' | 'camera'> } = {}
): Promise<ImageAsset | undefined> {
  // 隐私授权检查放在这里而不是调用方：wx.chooseMedia 是隐私接口，
  // 没同意就调用会直接失败。放在源头可以保证任何新的上传入口都不会漏。
  if (!(await ensurePrivacyAuthorized())) {
    throw new Error('需要同意隐私协议才能选择图片')
  }

  const res = await Taro.chooseMedia({
    count: 1,
    mediaType: ['image'],
    sourceType,
    sizeType: ['compressed']
  })
  const file = res?.tempFiles?.[0]
  if (!file) return undefined
  const path = (file as any).tempFilePath as string
  return {
    name: path.split('/').pop() ?? '素材',
    path,
    size: (file as any).size
  }
}

/**
 * 保存生成结果到相册，含授权失败后的引导
 * ------------------------------------------------------------------
 * 合规：《人工智能生成合成内容标识办法》第四条末段要求「提供下载、复制、
 * 导出等功能时，应当确保文件中含有满足要求的显式标识」。
 *
 * 服务端落盘时写入的隐式标识（文件元数据）在图上不可见，用户把图发出去
 * 别人什么都看不到，所以导出前必须先合成可见标识 —— 见
 * `services/export-image.ts`（用离屏画布，任何页面都能调）。
 *
 * 合成是「锦上添花」，存图是用户的核心诉求：合成失败会**退回原图**而不是抛错，
 * 保证用户永远存得下图。失败时返回值里 `labeled: false` 并带原因，
 * 调用方可以记日志；不要为了这个弹窗打扰用户。
 */
export async function saveImageToAlbum(url: string): Promise<LabeledExport> {
  // 写入相册同样是隐私接口，先确认授权
  if (!(await ensurePrivacyAuthorized())) {
    throw new Error('需要同意隐私协议才能保存图片')
  }

  let filePath = url
  if (/^https?:\/\//.test(url)) {
    const download = await Taro.downloadFile({ url })
    if (download.statusCode !== 200) throw new Error('图片下载失败')
    filePath = download.tempFilePath
  }

  // 先把显式标识烧进像素，再走保存。失败会自动退回原图。
  const composed = await composeLabeledImage(filePath)
  filePath = composed.filePath
  if (!composed.labeled) {
    console.warn('[aigc] 本次导出未带上可见标识', composed.reason)
  }

  try {
    await Taro.saveImageToPhotosAlbum({ filePath })
  } catch (error: any) {
    // 隐私类错误（未同意 / 未声明）先翻译成人话，否则用户看到的是
    // 「saveImageToPhotosAlbum:fail privacy permission is not authorized」
    const privacyMessage = privacyErrorMessage(error)
    if (privacyMessage) throw new Error(privacyMessage)

    const message = String(error?.errMsg ?? '')
    if (message.includes('auth deny') || message.includes('authorize')) {
      const setting = await Taro.showModal({
        title: '需要相册权限',
        content: '保存图片需要访问你的相册，去设置里打开？',
        confirmText: '去设置'
      })
      if (setting.confirm) {
        const auth = await Taro.openSetting()
        if (auth.authSetting?.['scope.writePhotosAlbum']) {
          await Taro.saveImageToPhotosAlbum({ filePath })
          return composed
        }
      }
      throw new Error('未获得相册权限，图片未保存')
    }
    throw new Error(message || '保存失败')
  }

  return composed
}
