import Taro from '@tarojs/taro'
import { currentAigcLabel } from './account'

/**
 * 导出时把 AIGC 显式标识合成进像素
 * ------------------------------------------------------------------
 * 《人工智能生成合成内容标识办法》（2025-09-01 施行）第四条末段：
 * 「服务提供者提供生成合成内容下载、复制、导出等功能时，
 *   应当确保文件中含有满足要求的显式标识。」
 *
 * 服务端落盘时写入的是**隐式标识**（文件元数据，见 forme-server/src/aigc.mjs），
 * 元数据不会显示在图上。用户把图存进相册、再发到别处，看图的人什么都看不到，
 * 所以导出这一步必须把可见标识烧进像素。
 *
 * 设计原则：**永不阻断保存**。
 * 合成是「锦上添花」，存图是用户的核心诉求。任何一步失败都退回原图，
 * 而不是抛错让用户存不了图——那比少一个角标严重得多。
 * 代价是失败时导出文件只有隐式标识，所以失败原因要带出去给调用方。
 *
 * 用离屏画布（`createOffscreenCanvas`，基础库 2.16.1+）而不是页面里的
 * `<Canvas>` 节点：这样任何页面都能直接调用，不需要挂载组件、不需要
 * 传 componentInstance、也不会因为页面切换导致画布失效。
 */

export type LabeledExport = {
  /** 可直接交给 saveImageToPhotosAlbum 的本地路径 */
  filePath: string
  /** 是否真的合成了可见标识。false 时文件只有隐式标识 */
  labeled: boolean
  /** 未合成的原因，用于日志与排查 */
  reason?: string
}

/** 字号取短边的比例，保证极端长宽比下水印也不会小到看不见 */
const FONT_RATIO = 0.03
const MIN_FONT_SIZE = 14
/** 徽标内边距与「App 内角标」的视觉比例对齐（10px 字配 3px/7px 内边距） */
const PAD_Y_RATIO = 0.3
const PAD_X_RATIO = 0.7
/** 距图边留白，对齐 App 内角标的 9px inset */
const INSET_RATIO = 0.9

/** 与 .aigc-badge 保持一致的配色：深色胶囊 + 浅色字，不占用强调色 */
const PILL_BG = 'rgba(12, 14, 14, 0.74)'
const PILL_FG = '#eef2e6'

/**
 * 导出格式跟随源文件。
 * 刻意不做「一律转 JPEG 压体积」：生成结果是用户花钱买的成品，
 * 无损重编码不会让它变差。代价是 PNG 体积偏大（1024×1280 约 1.5–2.5MB），
 * 真机上如果发现存图明显变慢，再把这里改成 `{ fileType: 'jpg', quality: 0.92 }`
 * 是一个独立的、低风险的调整。
 */
function exportFormat(sourcePath: string): { fileType: 'png' | 'jpg'; quality?: number } {
  return /\.png$/i.test(sourcePath) ? { fileType: 'png' } : { fileType: 'jpg', quality: 0.92 }
}

/** 画圆角矩形。小程序 canvas 2d 没有 roundRect，用 arcTo 拼 */
function roundedRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/** 载入图片为 canvas 可绘制的对象 */
function loadCanvasImage(canvas: any, src: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片解码失败'))
    image.src = src
  })
}

/**
 * 把显式标识合成到图片左上角，返回新文件路径。
 * 与 App 内 `aigc-badge is-top-left` 的位置一致，做到「所见即所存」。
 *
 * **不会抛错。** 任何环节失败都返回原路径并带上原因。
 */
export async function composeLabeledImage(sourcePath: string, label?: string): Promise<LabeledExport> {
  const text = (label ?? currentAigcLabel()).trim()
  if (!text) {
    return { filePath: sourcePath, labeled: false, reason: '标识文案为空' }
  }

  try {
    const info = await Taro.getImageInfo({ src: sourcePath })
    const width = Math.round(info.width || 0)
    const height = Math.round(info.height || 0)
    if (!width || !height) {
      return { filePath: sourcePath, labeled: false, reason: '拿不到图片尺寸' }
    }

    const canvas: any = Taro.createOffscreenCanvas({ type: '2d', width, height })
    const ctx: any = canvas.getContext('2d')
    if (!ctx) return { filePath: sourcePath, labeled: false, reason: '拿不到画布上下文' }

    const image = await loadCanvasImage(canvas, sourcePath)
    ctx.drawImage(image, 0, 0, width, height)

    const shortSide = Math.min(width, height)
    const fontSize = Math.max(MIN_FONT_SIZE, Math.round(shortSide * FONT_RATIO))
    const padY = Math.round(fontSize * PAD_Y_RATIO)
    const padX = Math.round(fontSize * PAD_X_RATIO)
    const inset = Math.round(fontSize * INSET_RATIO)

    // 中文字形 DM Mono 里没有，直接用系统无衬线，避免落到 tofu 方块
    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.textBaseline = 'middle'

    const textWidth = ctx.measureText(text).width
    const pillW = Math.round(textWidth + padX * 2)
    const pillH = Math.round(fontSize * 1.2 + padY * 2)

    roundedRect(ctx, inset, inset, pillW, pillH, pillH / 2)
    ctx.fillStyle = PILL_BG
    ctx.fill()

    ctx.fillStyle = PILL_FG
    ctx.fillText(text, inset + padX, inset + pillH / 2)

    const { fileType, quality } = exportFormat(sourcePath)
    const result = await Taro.canvasToTempFilePath({
      canvas,
      fileType,
      quality,
      destWidth: width,
      destHeight: height
    } as any)

    if (!result?.tempFilePath) {
      return { filePath: sourcePath, labeled: false, reason: '导出画布返回空路径' }
    }
    return { filePath: result.tempFilePath, labeled: true }
  } catch (error: any) {
    // 只记日志，不打扰用户：存图本身成功了，标识失败是我们要内部关注的事
    console.warn('[aigc] 显式标识合成失败，已回退为保存原图', error?.message ?? error)
    return { filePath: sourcePath, labeled: false, reason: String(error?.message ?? error) }
  }
}

/* ============================================================
   导出路径的统一收口
   ------------------------------------------------------------
   小程序里能把图「拿出去」的路径不止一条，每条都要带显式标识：

   1. 结果页的「保存到相册」—— 见 image-api.ts 的 saveImageToAlbum
   2. 资产页的 `previewImage` —— 微信预览自带长按菜单「保存图片 / 发送给
      朋友」，那是一条我们控制不了的下载路径。所以预览的必须是**已合成
      标识的副本**，而不是原图。第四条把「下载」明确列进了需要标识的场景。
   3. `onShareAppMessage` 的 imageUrl —— 当前工程没有分享入口；
      将来要加的话，同样得用合成后的路径，不要直接把原图塞进去。

   第 2 条容易被忽略，因为它看起来只是「看一眼」。
   ============================================================ */

/** 合成结果缓存：同一次会话内重复预览不再重算。key 带文案，换文案自动失效 */
const composedCache = new Map<string, string>()
/** 上限：临时文件不清理会一直占着存储，超出后按插入顺序淘汰 */
const CACHE_LIMIT = 40

function cacheKey(sourceUrl: string, label: string) {
  return `${label}\u0000${sourceUrl}`
}

/**
 * 拿到「已带显式标识」的本地路径。合成失败或下载失败时退回原地址，
 * 保证预览永远不会因为标识而打不开。
 */
export async function labeledPathFor(sourceUrl: string, label?: string): Promise<string> {
  const text = (label ?? currentAigcLabel()).trim()
  const key = cacheKey(sourceUrl, text)
  const cached = composedCache.get(key)
  if (cached) return cached

  let local = sourceUrl
  if (/^https?:\/\//.test(sourceUrl)) {
    try {
      // ⚠️ 这里**故意不传 timeout**，走 app.config.ts 的 networkTimeout.downloadFile。
      //
      // 下面的 catch / 非 200 都会退回 sourceUrl —— 也就是**不带「AI 生成」标识的原图**。
      // 这个兜底本身是对的（存不下图比标识缺失更糟），但「下载超时」不应该成为
      // 触发它的原因：《标识办法》第四条要求导出时带显式标识，而慢网下 60 秒
      // 下载一张多 MB 的图并不宽裕。所以全局值已经放宽到 120 秒。
      //
      // 改这个超时前先想清楚：缩短它 = 提高用户拿到无标识图片的概率。
      const download = await Taro.downloadFile({ url: sourceUrl })
      if (download.statusCode !== 200) return sourceUrl
      local = download.tempFilePath
    } catch {
      return sourceUrl
    }
  }

  const result = await composeLabeledImage(local, text)
  if (!result.labeled) return sourceUrl

  if (composedCache.size >= CACHE_LIMIT) {
    const oldest = composedCache.keys().next().value
    if (oldest !== undefined) composedCache.delete(oldest)
  }
  composedCache.set(key, result.filePath)
  return result.filePath
}

/**
 * 带显式标识的图片预览。
 *
 * 必须传**同一组**的完整 urls：微信预览支持左右滑动，如果只把当前这张换成
 * 合成版、其余仍是原图，用户滑过去长按保存就绕过了标识。
 */
export async function previewLabeledImages(urls: string[], current?: string): Promise<void> {
  const unique = [...new Set(urls.filter(Boolean))]
  if (!unique.length) return

  const label = currentAigcLabel().trim()
  const needCompose = unique.some((url) => !composedCache.has(cacheKey(url, label)))
  // 首次点开要下载 + 重编码，给个提示；已缓存的直接开，不闪 loading
  if (needCompose) Taro.showLoading({ title: '正在处理', mask: true })

  let labeled: string[]
  try {
    labeled = await Promise.all(unique.map((url) => labeledPathFor(url, label)))
  } finally {
    // 必须在 previewImage 之前关掉：previewImage 要等用户关掉预览才 resolve，
    // 放 finally 里会让 loading 一直挂在整个预览期间
    if (needCompose) Taro.hideLoading()
  }

  const index = current ? unique.indexOf(current) : 0
  await Taro.previewImage({
    current: labeled[index >= 0 ? index : 0],
    urls: labeled
  })
}

