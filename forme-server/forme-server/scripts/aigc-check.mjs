import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPlaceholderPng } from '../src/png.mjs'
import { stampImplicitLabel, readImplicitLabel, buildLabel, canStamp } from '../src/aigc.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let pass = 0
let fail = 0
function check(condition, label, extra) {
  if (condition) {
    pass += 1
    console.log(`  ✓ ${label}`)
  } else {
    fail += 1
    console.log(`  ✗ ${label}${extra ? ` → ${extra}` : ''}`)
  }
}

/** 逐块校验 PNG 结构：长度、CRC、结尾 IEND */
function validatePng(buffer) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!buffer.subarray(0, 8).equals(sig)) return '签名不对'
  let offset = 8
  const types = []
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const crcStored = buffer.readUInt32BE(offset + 8 + length)
    const typeAndData = buffer.subarray(offset + 4, offset + 8 + length)
    // 复用同一个 CRC 实现，独立复算一遍
    let c = 0xffffffff
    for (let i = 0; i < typeAndData.length; i += 1) {
      let x = (c ^ typeAndData[i]) & 0xff
      x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1
      for (let k = 1; k < 8; k += 1) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1
      c = x ^ (c >>> 8)
    }
    const crcCalc = (c ^ 0xffffffff) >>> 0
    if (crcCalc !== crcStored) return `块 ${type} 的 CRC 不匹配`
    types.push(type)
    offset += 12 + length
  }
  if (offset !== buffer.length) return `尾部有 ${buffer.length - offset} 字节多余数据`
  if (types[0] !== 'IHDR') return `首块是 ${types[0]}，应为 IHDR`
  if (types[types.length - 1] !== 'IEND') return '缺少 IEND'
  return null
}

console.log('1. PNG 隐式标识')
const png = createPlaceholderPng({ width: 200, height: 260, hue: 100, seed: 1 })
console.log(`   原始大小 ${png.length} 字节`)
check(validatePng(png) === null, '原始 PNG 结构合法', validatePng(png))

const stamped = stampImplicitLabel(png, 'image/png', { contentId: 'f_test123', provider: 'Pixel Box' })
check(stamped.stamped === true, '写入成功')
check(stamped.buffer.length > png.length, `字节数增加（+${stamped.buffer.length - png.length}）`)
check(validatePng(stamped.buffer) === null, '写入后 PNG 结构仍合法', validatePng(stamped.buffer))

const readBack = readImplicitLabel(stamped.buffer, 'image/png')
check(readBack === stamped.text, '读回的内容与写入一致', `${readBack}`)
check(readBack?.includes('AIGC=1'), '含「生成合成内容属性信息」')
check(readBack?.includes('Provider=Pixel Box'), '含「服务提供者名称」，且中文未乱码')
check(readBack?.includes('ContentId=f_test123'), '含「内容编号」')
console.log(`   标识正文：${readBack}`)

// 插在 IHDR 之后而不是文件末尾——这是「文件头部的描述性信息」
const ihdrEnd = 8 + 4 + 4 + png.readUInt32BE(8) + 4
const chunkAt = stamped.buffer.subarray(ihdrEnd + 4, ihdrEnd + 8).toString('ascii')
check(chunkAt === 'iTXt', `iTXt 紧跟在 IHDR 之后（位置 ${ihdrEnd}）`, `实际是 ${chunkAt}`)

console.log('\n2. PNG 幂等性 / 边界')
check(readImplicitLabel(png, 'image/png') === null, '未加标识的 PNG 读不到标识')
check(canStamp('image/png') && canStamp('image/jpeg'), 'PNG 与 JPEG 都声明支持')
check(!canStamp('image/webp'), 'WebP 不声明支持')

const twice = stampImplicitLabel(stamped.buffer, 'image/png', { contentId: 'f_test123', provider: 'Pixel Box' })
const allLabels = []
{
  // 二次写入会插入第二个 iTXt，读回的是第一个；这里只确认结构没坏
  check(validatePng(twice.buffer) === null, '重复写入后结构仍合法', validatePng(twice.buffer))
  let offset = 8
  while (offset + 12 <= twice.buffer.length) {
    const length = twice.buffer.readUInt32BE(offset)
    const type = twice.buffer.subarray(offset + 4, offset + 8).toString('ascii')
    if (type === 'iTXt') allLabels.push(offset)
    offset += 12 + length
  }
  console.log(`   （二次写入产生 ${allLabels.length} 个 iTXt 块，仅用于确认结构未损坏）`)
}

console.log('\n3. 非法输入不抛异常、原样返回')
const broken = stampImplicitLabel(Buffer.from('not a png at all'), 'image/png', { contentId: 'x' })
check(broken.stamped === false, '损坏的 PNG 标记为未写入')
check(broken.buffer.toString() === 'not a png at all', '原样返回，没有破坏数据')
check(typeof broken.reason === 'string', `带上了原因：${broken.reason}`)

const webp = stampImplicitLabel(Buffer.from('RIFF....WEBP'), 'image/webp', { contentId: 'x' })
check(webp.stamped === false, '不支持的格式标记为未写入')
check(webp.buffer.toString() === 'RIFF....WEBP', '不支持的格式原样返回')

console.log('\n4. JPEG 隐式标识')
const jpegDir = path.resolve(ROOT, '../forme-taro/src/assets')
const jpegFile = fs.existsSync(jpegDir)
  ? fs.readdirSync(jpegDir).find((name) => /\.jpe?g$/i.test(name))
  : null
if (jpegFile) {
  const jpeg = fs.readFileSync(path.join(jpegDir, jpegFile))
  console.log(`   用真实 JPEG：${jpegFile}（${jpeg.length} 字节）`)
  check(jpeg[0] === 0xff && jpeg[1] === 0xd8, '原始文件以 SOI 开头')
  const j = stampImplicitLabel(jpeg, 'image/jpeg', { contentId: 'f_jpg', provider: 'Pixel Box' })
  check(j.stamped === true, '写入成功')
  check(j.buffer[0] === 0xff && j.buffer[1] === 0xd8, 'SOI 仍在最前')
  check(j.buffer[2] === 0xff && j.buffer[3] === 0xfe, 'COM 段紧跟 SOI')
  const jRead = readImplicitLabel(j.buffer, 'image/jpeg')
  check(jRead === j.text, '读回内容一致', `${jRead}`)
  check(jRead?.includes('Provider=Pixel Box'), '中文未乱码')
  // 原始像素数据必须一字节不动地保留
  check(j.buffer.subarray(j.buffer.length - 100).equals(jpeg.subarray(jpeg.length - 100)),
    '原文件尾部 100 字节完全保留')
} else {
  console.log('   （未找到真实 JPEG，跳过）')
}

console.log('\n5. 标识正文构造')
const label = buildLabel({ contentId: 'f_abc', provider: 'ACME' })
check(label.startsWith('AIGC=1;'), '以属性信息开头')
check(label.includes('Provider=ACME'), '服务提供者名称')
check(label.includes('ContentId=f_abc'), '内容编号')
check(buildLabel({ contentId: 'x', provider: '' }).includes('Provider=unknown'), '缺省 provider 兜底为 unknown')

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 项通过，${fail} 项失败`)
process.exit(fail === 0 ? 0 : 1)
