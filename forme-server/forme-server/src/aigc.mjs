import { crc32 } from './png.mjs'

/**
 * AIGC 隐式标识（文件元数据）
 * ==================================================================
 * 依据《人工智能生成合成内容标识办法》（国信办通字〔2025〕2 号，
 * **2025-09-01 起施行**）：
 *
 *   第五条  服务提供者应当…在生成合成内容的**文件元数据**中添加隐式标识，
 *           隐式标识包含生成合成内容属性信息、服务提供者名称或者编码、
 *           内容编号等制作要素信息。
 *
 * 这一条是**对文件本身**的要求，不是界面上写一行字就算数。所以标识必须
 * 在服务端落盘时就写进文件，客户端渲染什么都替代不了。
 *
 * 实现方式刻意选了「纯字节操作」，不引入图像编解码库：
 *  - PNG 是 chunk 结构，往 IHDR 后面插一个 iTXt 块即可；
 *  - JPEG 是 marker segment 结构，往 SOI 后面插一个 COM 段即可。
 * 两者都只是拼接字节，不需要解码像素，所以零依赖的约定得以保持。
 *
 * 注意：本模块只管**隐式标识**（元数据）。第四条要求的**显式标识**
 * （图片上可见的提示）需要合成到像素上，服务端没有解码能力，
 * 由客户端在交互界面与导出时承担——见 API.md 的「AIGC 标识」一节。
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** iTXt 块的关键字。保持短且稳定，方便用工具直接搜到 */
const KEYWORD = 'AIGC'

/**
 * 构造隐式标识正文。
 * 字段对应第五条点名的三要素：
 *   属性信息 = `AIGC=1`
 *   服务提供者名称 = `Provider=`
 *   内容编号 = `ContentId=`
 */
export function buildLabel({ contentId, provider, service = 'forme-server', createdAt } = {}) {
  const parts = [
    'AIGC=1',
    `Provider=${provider || 'unknown'}`,
    `Service=${service}`,
    `ContentId=${contentId || 'unknown'}`,
    `GeneratedAt=${createdAt || new Date().toISOString()}`
  ]
  return parts.join(';')
}

/* ================================================================
   PNG：插入 iTXt 块
   ================================================================ */

/**
 * iTXt 是唯一能安全承载 UTF-8（中文服务商名）的文本块。
 * tEXt 只允许 Latin-1，写中文会乱码。
 * 结构：keyword\0 compressionFlag compressionMethod languageTag\0 translatedKeyword\0 text
 */
function itxtChunk(keyword, text) {
  const data = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0x00]), // keyword 结束
    Buffer.from([0x00]), // compression flag：0 = 不压缩
    Buffer.from([0x00]), // compression method
    Buffer.from([0x00]), // language tag 结束（留空）
    Buffer.from([0x00]), // translated keyword 结束（留空）
    Buffer.from(text, 'utf8')
  ])

  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from('iTXt', 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

function stampPng(buffer, text) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('不是合法的 PNG')
  }
  // 第一个块必须是 IHDR，长度在其 data 前 4 字节
  const ihdrLength = buffer.readUInt32BE(8)
  const insertAt = 8 + 4 + 4 + ihdrLength + 4 // 跳过长/类型/数据/CRC
  if (insertAt > buffer.length) throw new Error('PNG 结构异常：IHDR 长度越界')

  return Buffer.concat([
    buffer.subarray(0, insertAt),
    itxtChunk(KEYWORD, text),
    buffer.subarray(insertAt)
  ])
}

/* ================================================================
   JPEG：插入 COM 段
   ================================================================ */

function stampJpeg(buffer, text) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error('不是合法的 JPEG')
  }
  const payload = Buffer.from(text, 'utf8')
  // 段长度字段含它自己那 2 字节，且上限 65535
  const segmentLength = payload.length + 2
  if (segmentLength > 0xffff) throw new Error('JPEG COM 段过长')

  const segment = Buffer.alloc(4 + payload.length)
  segment.writeUInt16BE(0xfffe, 0) // COM marker
  segment.writeUInt16BE(segmentLength, 2)
  payload.copy(segment, 4)

  // 紧跟在 SOI(FFD8) 之后插入，不破坏后续 marker 顺序
  return Buffer.concat([buffer.subarray(0, 2), segment, buffer.subarray(2)])
}

/* ================================================================
   对外接口
   ================================================================ */

/** 按 mime 判断这个格式能不能写隐式标识 */
export function canStamp(mime) {
  return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg'
}

/**
 * 给图片字节流加上 AIGC 隐式标识，返回新 Buffer（不改原对象）。
 * 不支持的格式**原样返回**并给出 stamped=false，由调用方决定是否告警——
 * 悄悄跳过会让合规缺口不可见。
 */
export function stampImplicitLabel(buffer, mime, meta = {}) {
  const text = buildLabel(meta)
  try {
    if (mime === 'image/png') return { buffer: stampPng(buffer, text), stamped: true, text }
    if (mime === 'image/jpeg' || mime === 'image/jpg') {
      return { buffer: stampJpeg(buffer, text), stamped: true, text }
    }
    return { buffer, stamped: false, text, reason: `不支持的格式 ${mime}` }
  } catch (error) {
    return { buffer, stamped: false, text, reason: error?.message ?? '写入失败' }
  }
}

/**
 * 把隐式标识读回来。冒烟测试靠它验证「标识真的写进文件了」，
 * 而不是只验证函数被调用过。
 */
export function readImplicitLabel(buffer, mime) {
  if (mime === 'image/png') return readPngLabel(buffer)
  if (mime === 'image/jpeg' || mime === 'image/jpg') return readJpegLabel(buffer)
  return null
}

function readPngLabel(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  let offset = 8
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    if (type === 'iTXt') {
      const data = buffer.subarray(offset + 8, offset + 8 + length)
      const firstNull = data.indexOf(0x00)
      if (firstNull > 0 && data.subarray(0, firstNull).toString('latin1') === KEYWORD) {
        // keyword\0 flag method lang\0 translated\0 text
        const afterKeyword = data.subarray(firstNull + 3)
        const secondNull = afterKeyword.indexOf(0x00)
        const thirdNull = afterKeyword.indexOf(0x00, secondNull + 1)
        return afterKeyword.subarray(thirdNull + 1).toString('utf8')
      }
    }
    offset += 12 + length
  }
  return null
}

function readJpegLabel(buffer) {
  let offset = 2
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null
    const marker = buffer[offset + 1]
    if (marker === 0xff) {
      offset += 1
      continue
    }
    const length = buffer.readUInt16BE(offset + 2)
    if (marker === 0xfe) {
      return buffer.subarray(offset + 4, offset + 2 + length).toString('utf8')
    }
    // 扫描数据（SOS）之后就再没有段头了
    if (marker === 0xda) return null
    offset += 2 + length
  }
  return null
}
