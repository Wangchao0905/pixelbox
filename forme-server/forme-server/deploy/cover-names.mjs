/**
 * 封面图文件名规则的**唯一实现**
 * ==================================================================
 * 为什么单独抽一个模块：
 *
 * 这条规则原本散在三个地方 —— 客户端运行时（`forme-taro/src/data/media.ts`
 * 的 `media()`）、下载器（`deploy/fetch-covers.mjs`）、以及现在的校验器。
 * 三份实现只要有一份漂了，表现是**封面全 404**，而它和「域名没进白名单」
 * 长得一模一样，能查很久。规则只留一份，其余引用它。
 *
 * ⚠️ 改动本文件时必须同步 `forme-taro/src/data/media.ts` 的 `media()`：
 *   那边是 TypeScript、要打进小程序包，没法直接 import 这个 .mjs，
 *   所以那一份是**刻意的重复**，两边注释互相指认。改一处 = 改两处。
 *
 * 规则：取原 URL 去掉查询串后的最后一段。
 *   https://images.unsplash.com/photo-1549490349-8643362247b5?auto=format&w=900
 *   → photo-1549490349-8643362247b5
 * **没有扩展名** —— 所以 nginx 那边必须 `default_type image/jpeg`，
 * 否则会按 application/octet-stream 发出去。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 仓库根（deploy/ 的上两级） */
export const REPO_ROOT = path.resolve(HERE, '..', '..')
/** 客户端源码根 */
export const CLIENT_SRC = path.join(REPO_ROOT, 'forme-taro', 'src')
/** 下载输出目录 */
export const MEDIA_DIR = path.join(HERE, 'media')

/** 与 `forme-taro/src/data/media.ts` 的 `media()` 保持一致的命名规则 */
export function coverFileName(url) {
  return url.split('?')[0].split('/').pop() ?? ''
}

/**
 * 从客户端源码里找出所有 `media('https://...')` 引用。
 * 带上**文件与行号** —— 图床地址失效时要能一眼找到改哪一行，
 * 否则得在 20 多个引用里翻。
 */
export function collectCoverRefs() {
  if (!fs.existsSync(CLIENT_SRC)) {
    throw new Error(`找不到客户端源码：${CLIENT_SRC}`)
  }

  const refs = []
  const pattern = /media\(\s*['"](https?:\/\/[^'"]+)['"]\s*\)/g

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      const code = fs.readFileSync(full, 'utf8')
      code.split('\n').forEach((line, index) => {
        for (const matched of line.matchAll(pattern)) {
          refs.push({ url: matched[1], where: `${path.relative(REPO_ROOT, full)}:${index + 1}` })
        }
      })
    }
  }

  walk(CLIENT_SRC)
  return refs
}

/**
 * 按文件名去重，同一个文件名只保留一份。
 *
 * 这不是「冲突」，是正常的：文件名就是照片 id，同一张照片在两处被引用
 * （实测 photo-1556228578 同时出现在 catalog.ts 的 w=800 和
 * prompt-templates.ts 的 w=900）本来就该共用一个文件。
 *
 * 但尺寸参数不同时得挑一个：取 `w` 最大的那个 —— 大图缩小没问题，
 * 小图放大会糊。所以「哪个 URL 先出现」不该决定结果。
 */
export function dedupeByFileName(refs) {
  const byFileName = new Map()
  for (const ref of refs) {
    const name = coverFileName(ref.url)
    if (!name) throw new Error(`算不出文件名：${ref.url}（${ref.where}）`)
    let width = 0
    try {
      width = Number(new URL(ref.url).searchParams.get('w') ?? 0)
    } catch {
      width = 0
    }
    const existing = byFileName.get(name)
    if (!existing || width > existing.width) byFileName.set(name, { ...ref, width })
  }
  return byFileName
}

/**
 * 把 URL 归一化成「稳定的、适合做缩略图的」jpg。
 *
 * 三件事，每件都有理由：
 *
 * 1. **去掉 `auto=format`**。那个参数会让图床按请求头协商成 webp / avif，
 *    下载到的可能是 webp，而 nginx 那边按 image/jpeg 发 —— 类型和内容对不上。
 * 2. **显式给 `w` / `q`**。设计稿里写的是 `w=900&q=84`，那是原型阶段的取值：
 *    这些图只用在**卡片缩略图**上，实测单张 335KB，23 张约 7.7MB ——
 *    用户首次进入就要拉这么多，移动网络下很慢，也白烧流量。
 *    缩略图按 750 宽 / q72 足够清晰（393 设计宽 × 2 倍屏），体积约为原来的四成。
 * 3. **固定参数顺序**。同一张图在不同地方可能带着不同的查询串，
 *    归一化之后缓存键才稳定。
 */
export function thumbnailUrl(url, width, quality) {
  try {
    const parsed = new URL(url)
    parsed.searchParams.delete('auto')
    parsed.searchParams.set('fm', 'jpg')
    parsed.searchParams.set('fit', 'crop')
    parsed.searchParams.set('w', String(width))
    parsed.searchParams.set('q', String(quality))
    parsed.searchParams.sort()
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * 读 forme-taro/.env.production 里某个键的值。
 * 用不着 dotenv：这个文件是我们自己维护的简单 KEY=VALUE。
 * 取最后一个定义（dotenv 的语义），并去掉包裹引号。
 */
export function readClientEnv(key) {
  const file = path.join(REPO_ROOT, 'forme-taro', '.env.production')
  if (!fs.existsSync(file)) return ''
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  let value = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    if (trimmed.slice(0, eq).trim() !== key) continue
    value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return value
}
