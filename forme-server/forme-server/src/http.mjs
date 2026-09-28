import crypto from 'node:crypto'

/** 业务错误：带 HTTP 状态码与机器可读的 code，路由层直接抛 */
export class ApiError extends Error {
  constructor(status, message, code = 'error', extra = {}) {
    super(message)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

export function badRequest(message, code = 'bad_request') {
  return new ApiError(400, message, code)
}

export function unauthorized(message = '登录态无效或已过期') {
  return new ApiError(401, message, 'unauthorized')
}

export function forbidden(message, code = 'forbidden') {
  return new ApiError(403, message, code)
}

export function notFound(message = '接口不存在') {
  return new ApiError(404, message, 'not_found')
}

export function cors(req, res) {
  // 小程序请求没有 Origin，这里主要服务本地网页调试
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type,Authorization,X-Request-Id'
  )
  res.setHeader('Access-Control-Max-Age', '86400')
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  })
  res.end(body)
}

export function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text)
  })
  res.end(text)
}

export function sendBuffer(res, status, buffer, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Cache-Control': 'public, max-age=31536000, immutable'
  })
  res.end(buffer)
}

const MAX_BODY = 20 * 1024 * 1024 // 上传素材上限 20MB

export async function readRawBody(req, limit = MAX_BODY) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new ApiError(413, '请求体过大', 'payload_too_large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function readJsonBody(req, limit = 1024 * 1024) {
  const raw = await readRawBody(req, limit)
  if (!raw.length) return {}
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw badRequest('请求体不是合法 JSON')
  }
}

/**
 * 极简 multipart/form-data 解析
 * ------------------------------------------------------------------
 * 只实现小程序 wx.uploadFile 会用到的那部分：
 * 普通字段 + 单个文件字段。不做嵌套、不做流式，够用就行。
 * 生产环境如果上传量大，应该换成 busboy 之类的流式解析器。
 */
export function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? '')
  const boundary = (match?.[1] ?? match?.[2] ?? '').trim()
  if (!boundary) throw badRequest('缺少 multipart boundary', 'bad_multipart')

  const delimiter = Buffer.from(`--${boundary}`)
  const fields = {}
  const files = []

  let cursor = buffer.indexOf(delimiter)
  while (cursor !== -1) {
    const start = cursor + delimiter.length
    // 结束标记 --boundary--
    if (buffer.slice(start, start + 2).toString() === '--') break

    const headerEnd = buffer.indexOf('\r\n\r\n', start)
    if (headerEnd === -1) break

    const headerText = buffer.slice(start, headerEnd).toString('utf8')
    const bodyStart = headerEnd + 4
    let next = buffer.indexOf(delimiter, bodyStart)
    if (next === -1) next = buffer.length
    // 去掉 body 与分隔符之间的 \r\n
    const bodyEnd = buffer.slice(next - 2, next).toString() === '\r\n' ? next - 2 : next
    const body = buffer.slice(bodyStart, bodyEnd)

    const name = /name="([^"]*)"/i.exec(headerText)?.[1]
    const filename = /filename="([^"]*)"/i.exec(headerText)?.[1]
    const mime = /Content-Type:\s*([^\r\n;]+)/i.exec(headerText)?.[1]?.trim()

    if (name && filename) {
      files.push({ field: name, filename, mime: mime ?? 'application/octet-stream', buffer: body })
    } else if (name) {
      fields[name] = body.toString('utf8')
    }

    cursor = next
  }

  return { fields, files }
}

export function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex')
}
