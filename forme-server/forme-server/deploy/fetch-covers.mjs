#!/usr/bin/env node
/**
 * 把小程序里引用的远程封面图下载到本地，用于放到自有域名下。
 * ==================================================================
 * 用法（在 forme-server 目录下）：
 *   npm run fetch:covers              # 下载到 deploy/media/
 *   npm run fetch:covers -- --force   # 重新下载已存在的
 *   npm run fetch:covers -- --w=900 --q=84
 *
 * 然后 rsync 到服务器：
 *   rsync -av deploy/media/ root@pixeltoy.cn:/opt/forme/media/
 *
 * 配完 nginx 的 /media/ 之后，在 forme-taro/.env.production 里写：
 *   TARO_APP_MEDIA_BASE=https://pixeltoy.cn/media
 * 重新构建即可。`npm run verify:dist` 的「远程图片域名已收口」会转绿。
 *
 * ⚠️ **配 env 之前先跑 `npm run check:media`**：它会把每个文件名 HEAD 一遍，
 *    确认服务器上真有这些文件、而且 content-type 是 image/*。
 *    少了这一步就会变成「门禁转绿但线上全是 404」—— 那种状态下每张封面
 *    都是空白，和「域名没进白名单」长得一模一样，白查很久。
 *
 * ------------------------------------------------------------------
 * 为什么要有这个脚本，而不是手敲几条 wget：
 *
 * 1. **文件名规则必须和 forme-taro/src/data/media.ts 的 `media()` 完全一致**。
 *    规则（含理由）已抽到 `deploy/cover-names.mjs`，这里直接引用 ——
 *    仓库里不再有第二份实现，也就没有「改了一处忘了另一处」。
 *
 * 2. **它是唯一能发现「图床地址已失效」的地方**。这不是假想问题：
 *    设计源里的 photo-1507529955149-8b4b6f9f4f7d 已经**永久 404**（连试三次），
 *    对应的「海岸日光」卡片在真机上永远是一块空白 —— 而没有任何东西会告诉你。
 *    第三方图床删图不会有通知。所以每次跑这个脚本都顺带把所有引用验一遍。
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  CLIENT_SRC,
  MEDIA_DIR,
  collectCoverRefs,
  dedupeByFileName,
  thumbnailUrl
} from './cover-names.mjs'

const force = process.argv.includes('--force')

/** 读 --w=750 / --q=72 这类参数 */
function numericArg(name, fallback) {
  const prefix = `--${name}=`
  const found = process.argv.find((item) => item.startsWith(prefix))
  if (!found) return fallback
  const value = Number(found.slice(prefix.length))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const WIDTH = numericArg('w', 750)
const QUALITY = numericArg('q', 72)

let refs
let byFileName
try {
  refs = collectCoverRefs()
  byFileName = dedupeByFileName(refs)
} catch (error) {
  console.error(`❌ ${error.message}`)
  process.exit(1)
}

if (!refs.length) {
  console.log('没有找到 media(...) 形式的远程图片引用。')
  console.log('如果封面已经改成自有域名，那就没什么要下载的。')
  process.exit(0)
}

console.log(`\n封面下载\n${'─'.repeat(56)}`)
console.log(`来源：${CLIENT_SRC}`)
console.log(`输出：${MEDIA_DIR}`)
console.log(`规格：宽 ${WIDTH} · q${QUALITY} · jpg（缩略图用途，改 --w= --q= 可覆盖）`)
if (byFileName.size < refs.length) {
  console.log(`引用 ${refs.length} 处 → 去重后 ${byFileName.size} 个文件（同名共用，取尺寸更大的）`)
}
console.log('')

fs.mkdirSync(MEDIA_DIR, { recursive: true })

let downloaded = 0
let skipped = 0
let totalBytes = 0
/** 图床说「这张没了」—— 重试没用，必须换图 */
const gone = []
/** 网络抖动之类 —— 重试也没好，但可能下次就好了 */
const failed = []

for (const [name, ref] of byFileName) {
  const target = path.join(MEDIA_DIR, name)

  if (!force && fs.existsSync(target) && fs.statSync(target).size > 0) {
    skipped += 1
    continue
  }

  const url = thumbnailUrl(ref.url, WIDTH, QUALITY)
  let lastError = ''

  // 重试 2 次。实测图床会偶发连接失败（同一张图紧接着重试就 200），
  // 一次失败就报错会让人以为图片坏了，白查半天。
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'forme-cover-fetch/1.0' },
        signal: AbortSignal.timeout(30000)
      })

      if (response.status === 404) {
        gone.push({ name, ...ref })
        lastError = ''
        break
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const buffer = Buffer.from(await response.arrayBuffer())
      if (!buffer.length) throw new Error('响应为空')

      // 防呆：确认拿到的真是图片，别把 HTML 错误页存成 jpg
      const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8
      const isPng = buffer[0] === 0x89 && buffer[1] === 0x50
      if (!isJpeg && !isPng) {
        throw new Error(`不是图片（前两字节 ${buffer[0]?.toString(16)} ${buffer[1]?.toString(16)}）`)
      }

      fs.writeFileSync(target, buffer)
      downloaded += 1
      totalBytes += buffer.length
      console.log(`  ✓ ${name}  ${(buffer.length / 1024).toFixed(0)} KB`)
      lastError = ''
      break
    } catch (error) {
      lastError = error?.message ?? String(error)
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1200 * attempt))
    }
  }

  if (lastError) {
    failed.push({ name, ...ref, reason: lastError })
    console.log(`  ❌ ${name}  ${lastError}`)
  }
}

console.log(`\n${'─'.repeat(56)}`)
console.log(`  新下载 ${downloaded} · 已存在跳过 ${skipped} · 失效 ${gone.length} · 失败 ${failed.length}`)
if (downloaded) console.log(`  本次下载体积 ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)

if (gone.length) {
  console.error('\n❌ 这些图床地址已经**永久失效**（图床返回 404，重试无用）：')
  for (const item of gone) {
    console.error(`   · ${item.name}`)
    console.error(`     引用位置 ${item.where}`)
    console.error(`     原地址   ${item.url}`)
  }
  console.error(`
   第三方图床删图不会有任何通知。留着它的表现是：那张卡片在真机上永远空白，
   而且不会报错 —— 看起来像样式问题。
   处理：去图床换一张**主题相同**的图，把 URL 替换到上面标出的位置。`)
}

if (failed.length) {
  console.error('\n❌ 这些图重试 3 次仍没下下来（可能是网络问题）：')
  for (const item of failed) {
    console.error(`   · ${item.name}  ${item.reason}`)
    console.error(`     引用位置 ${item.where}`)
  }
  console.error('\n   先重跑一次；仍然失败就检查网络或代理。缺图的表现同样是封面空白。')
}

if (gone.length || failed.length) process.exit(1)

console.log(`
下一步：
  1. npm run check:media          ← 先确认服务器那边已经能出图，再配 env
  2. rsync -av deploy/media/ root@pixeltoy.cn:/opt/forme/media/
  3. 确认 nginx 的 /media/ 已生效（见 deploy/nginx.conf）
  4. forme-taro/.env.production 写入
       TARO_APP_MEDIA_BASE=https://pixeltoy.cn/media
  5. cd ../forme-taro && npm run release
`)
