import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.mjs'
import { stampImplicitLabel } from './aigc.mjs'
import { notify } from './alert.mjs'
import { getFileRecord, newId, saveFileRecord } from './store.mjs'
import { notFound } from './http.mjs'

/**
 * 文件存储
 * ------------------------------------------------------------------
 * 参考实现落本地磁盘。上线必须换成对象存储（COS / OSS）：
 *  - 小程序主包 2MB、整包 20MB，图片不可能打包进去；
 *  - 生成结果要能长期访问，本地磁盘随容器重建就没了；
 *  - 多实例部署时本地磁盘不共享。
 * 换存储只需要改本文件的 saveUpload / readStored 两个函数。
 *
 * ⚠️ 换存储时**不要丢掉 AIGC 隐式标识的写入**（见 saveGeneratedImage）。
 * 那是法定义务，不是可选装饰。
 */

const uploadDir = path.join(config.dataDir, 'uploads')
fs.mkdirSync(uploadDir, { recursive: true })

const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
}

export function isSupportedImage(mime) {
  return Boolean(EXT_BY_MIME[mime])
}

export async function saveUpload({ userId, buffer, mime, filename, fileId: givenFileId }) {
  const ext = EXT_BY_MIME[mime] ?? 'png'
  const fileId = givenFileId ?? newId('f')
  const storedName = `${fileId}.${ext}`
  fs.writeFileSync(path.join(uploadDir, storedName), buffer)

  const record = {
    fileId,
    storedName,
    mime: MIME_BY_EXT[ext],
    size: buffer.length,
    originalName: filename ?? storedName,
    userId,
    createdAt: new Date().toISOString()
  }
  await saveFileRecord(record)
  return record
}

/** 已经告警过的格式，避免上游持续返回同一种格式时把告警刷爆 */
const warnedFormats = new Set()

/**
 * 存生成结果。
 * ------------------------------------------------------------------
 * 与 saveUpload 的关键区别：**这里存的图必须带 AIGC 隐式标识**。
 * 用户上传的素材是用户自己的内容，不加标识；
 * 模型生成的结果是「生成合成内容」，按《标识办法》第五条必须加。
 * 所以标识只在这一层做，不要下沉到 saveUpload。
 */
export async function saveGeneratedImage({ userId, buffer, mime = 'image/png', filename = 'generated.png' }) {
  const fileId = newId('f')
  let payload = buffer

  if (config.aigc.metadata) {
    const result = stampImplicitLabel(buffer, mime, {
      contentId: fileId,
      provider: config.aigc.provider
    })
    if (result.stamped) {
      payload = result.buffer
    } else if (!warnedFormats.has(mime)) {
      // 写不进去必须留痕。静默跳过等于「每张图都缺标识但没人知道」，
      // 是典型的合规缺口只在监管检查时才暴露。
      warnedFormats.add(mime)
      notify('warning', 'AIGC 隐式标识写入失败', { mime, reason: result.reason, fileId })
    }
  }

  return saveUpload({ userId, buffer: payload, mime, filename, fileId })
}

export function readStored(fileId) {
  const record = getFileRecord(fileId)
  if (!record) throw notFound('文件不存在')
  const filePath = path.join(uploadDir, record.storedName)
  if (!fs.existsSync(filePath)) throw notFound('文件已被清理')
  return { record, buffer: fs.readFileSync(filePath) }
}

/** 对外访问地址。baseUrl 由请求推断，避免写死域名 */
export function publicUrl(fileId, baseUrl = '') {
  return `${baseUrl.replace(/\/+$/, '')}/api/files/${fileId}`
}
