import zlib from 'node:zlib'

/**
 * 极简 PNG 编码器
 * ------------------------------------------------------------------
 * 用途只有一个：MOCK_LLM=1 时生成占位图，让整条链路（上传 → 生成 →
 * 扣费 → 结果页 → 资产库）在没有图片模型 key 的情况下也能真的跑通，
 * 而不是返回一张假的远程图片地址。
 *
 * 只支持 8bit RGB、无隔行、filter 0，够用。
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

/** 导出给 aigc.mjs 复用：PNG 加元数据块时要用同一套 CRC 算法 */
export function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let rgb = [0, 0, 0]
  if (hp < 1) rgb = [c, x, 0]
  else if (hp < 2) rgb = [x, c, 0]
  else if (hp < 3) rgb = [0, c, x]
  else if (hp < 4) rgb = [0, x, c]
  else if (hp < 5) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  const m = l - c / 2
  return rgb.map((value) => Math.round((value + m) * 255))
}

/**
 * 生成一张带渐变的占位图。
 * @param {{width?: number, height?: number, hue?: number, seed?: number}} options
 * @returns {Buffer}
 */
export function createPlaceholderPng({ width = 640, height = 800, hue = 80, seed = 0 } = {}) {
  const w = Math.max(16, Math.min(1024, Math.round(width)))
  const h = Math.max(16, Math.min(1366, Math.round(height)))

  const raw = Buffer.alloc((w * 3 + 1) * h)
  let offset = 0

  for (let y = 0; y < h; y += 1) {
    raw[offset] = 0 // filter type: none
    offset += 1
    const ny = y / h
    for (let x = 0; x < w; x += 1) {
      const nx = x / w
      // 对角渐变 + 一点正弦扰动，让每张图看起来不一样
      const wave = Math.sin((nx * 6 + ny * 4 + seed) * Math.PI) * 0.06
      const lightness = Math.max(0.08, Math.min(0.72, 0.16 + (nx * 0.35 + ny * 0.22) + wave))
      const saturation = 0.28 + (ny * 0.32)
      const [r, g, b] = hslToRgb(hue + nx * 40 - ny * 18, saturation, lightness)
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
      offset += 3
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/**
 * 校验 PNG 真的有透明像素**和**不透明像素 —— 给「一键抠图」兜底用。
 * ------------------------------------------------------------------
 * 背景：上游是 OpenAI 兼容接口，只有 `background=transparent` 参数真的
 * 生效时才会返回带 alpha 通道的 PNG。如果网关吞掉这个参数（比如服务端
 * 没升级、渠道不支持），模型会照常出一张白底/影棚底的普通图 —— 用户为
 * 一次失败的抠图付了钱，看到的却是白底，这是最糟的静默错误。
 *
 * 所以透明请求的结果在这里做一次像素级验货：不通过就抛错，上层
 * runImageTask 的 catch 会自动退还预扣的点数，用户看到的是明确的失败
 * 提示而不是一张假的白底图。
 *
 * 判定标准（严格但合理）：
 * - 必须是 PNG，8bit，非隔行，颜色类型 4（灰+alpha）或 6（RGBA）；
 * - 透明像素（alpha<=10）与不透明像素（alpha>=245）都至少占 0.5%。
 *   全透明（模型崩了）或全不透明（参数没生效）都算失败。
 * 满足任一早退条件即返回，不满足则抛错。
 */
export function assertTransparentPng(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error('不是 PNG 文件')
  }

  let offset = 8
  let width, height, bitDepth, colorType, interlace
  const idatParts = []
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    if (offset + 12 + length > buffer.length) throw new Error('PNG 块长度越界')
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idatParts.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (width == null) throw new Error('缺少 IHDR 块')
  if (!idatParts.length) throw new Error('缺少图像数据块')
  if (bitDepth !== 8) throw new Error(`位深=${bitDepth}，只接受 8bit`)
  if (interlace !== 0) throw new Error('不支持隔行扫描 PNG')
  if (colorType !== 4 && colorType !== 6) {
    throw new Error(`颜色类型=${colorType}，没有 alpha 通道（透明参数未生效）`)
  }

  const channels = colorType === 6 ? 4 : 2
  const stride = width * channels
  let raw
  try {
    raw = zlib.inflateSync(Buffer.concat(idatParts))
  } catch {
    throw new Error('图像数据解压失败')
  }

  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }

  const total = width * height
  const need = Math.max(1, Math.floor(total * 0.005)) // 透明/不透明各至少 0.5%
  let transparent = 0
  let opaque = 0
  let pos = 0
  const prev = Buffer.alloc(stride)
  const cur = Buffer.alloc(stride)
  for (let y = 0; y < height; y += 1) {
    if (pos + 1 + stride > raw.length) throw new Error('图像数据长度与尺寸不符')
    const filter = raw[pos]
    pos += 1
    raw.copy(cur, 0, pos, pos + stride)
    pos += stride
    switch (filter) {
      case 0:
        break
      case 1: // Sub
        for (let i = channels; i < stride; i += 1) cur[i] = (cur[i] + cur[i - channels]) & 0xff
        break
      case 2: // Up
        for (let i = 0; i < stride; i += 1) cur[i] = (cur[i] + prev[i]) & 0xff
        break
      case 3: // Average
        for (let i = 0; i < stride; i += 1) {
          const a = i >= channels ? cur[i - channels] : 0
          cur[i] = (cur[i] + ((a + prev[i]) >> 1)) & 0xff
        }
        break
      case 4: // Paeth
        for (let i = 0; i < stride; i += 1) {
          const a = i >= channels ? cur[i - channels] : 0
          const b = prev[i]
          const c = i >= channels ? prev[i - channels] : 0
          cur[i] = (cur[i] + paeth(a, b, c)) & 0xff
        }
        break
      default:
        throw new Error(`未知的行过滤器=${filter}`)
    }
    for (let i = channels - 1; i < stride; i += channels) {
      const alpha = cur[i]
      if (alpha <= 10) transparent += 1
      else if (alpha >= 245) opaque += 1
    }
    if (transparent >= need && opaque >= need) return
    cur.copy(prev)
  }
  if (transparent < need) throw new Error('没有检测到透明像素（透明参数可能未生效）')
  throw new Error('没有检测到不透明像素（全透明不是正常的抠图结果）')
}

/** 把 "1024x1536" 解析成 { width, height }，解析失败回落到默认值 */
export function parseSize(size, fallback = { width: 640, height: 800 }) {
  const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(String(size ?? ''))
  if (!match) return fallback
  const width = Number(match[1])
  const height = Number(match[2])
  if (!width || !height) return fallback
  // 占位图不需要真那么大，等比缩到长边 800 以内，省时间也省磁盘
  const scale = Math.min(1, 800 / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}
