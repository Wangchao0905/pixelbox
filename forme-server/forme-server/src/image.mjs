import { readFileSync } from 'node:fs'
import path from 'node:path'
import { config } from './config.mjs'
import { ApiError, badRequest } from './http.mjs'
import { guardImage, guardText } from './security.mjs'
import {
  commitCharge,
  getAccount,
  getIdempotent,
  releaseCharge,
  reserveCharge,
  saveAsset,
  saveIdempotent
} from './store.mjs'
import { publicUrl, readStored, saveGeneratedImage } from './files.mjs'
import { assertTransparentPng, createPlaceholderPng, parseSize } from './png.mjs'
import { normalizeSize } from './sizes.mjs'

/**
 * 图片生成 / 编辑
 * ------------------------------------------------------------------
 * 扣费顺序刻意写成「预扣 → 上游调用 → 结算或回滚」，而不是
 * 「先调用 → 成功再扣」：
 *
 *   先扣后调：上游超时/失败时要回滚，回滚失败会多扣用户的钱，但不会超扣。
 *   先调后扣：并发下两个请求可能同时通过余额校验，双双生成后一起扣，
 *             余额被扣成负数——这是真正赔钱的 bug。
 *
 * 所以余额校验必须和扣款在同一次同步写里完成（reserveCharge 内部），
 * 上游失败再把钱还回去。宁可偶发多扣（有流水可查、可补偿），
 * 也不要超扣（用户白拿）。
 */

function clampBatch(n) {
  const value = Math.floor(Number(n) || 1)
  if (value < 1) return 1
  return Math.min(value, config.maxBatch)
}

function idempotencyKey(userId, requestId, kind) {
  return requestId ? `${kind}:${userId}:${requestId}` : ''
}

/**
 * 上游返回可能是远程 URL、data URL，也可能是 b64_json；统一转成 Buffer。
 * ------------------------------------------------------------------
 * 三种都要认：OpenAI 兼容上游在 response_format=b64_json 时只给 b64_json
 * 不给 url（有些实现默认就是这个），只认 url 的话会报「上游未返回图片内容」，
 * 而且看起来像是上游的问题，很难查。
 */
async function toBuffer(item) {
  if (item.b64_json) {
    return { buffer: Buffer.from(item.b64_json, 'base64'), mime: item.mime_type ?? 'image/png' }
  }
  if (item.url?.startsWith('data:')) {
    const match = /^data:([^;]+);base64,(.+)$/.exec(item.url)
    if (!match) throw new ApiError(502, '上游返回了无法解析的 data URL', 'upstream_error')
    return { buffer: Buffer.from(match[2], 'base64'), mime: match[1] }
  }
  if (item.url) {
    let response
    try {
      response = await fetch(item.url, { signal: AbortSignal.timeout(config.llm.timeoutMs) })
    } catch (error) {
      throw new ApiError(502, `下载上游图片失败：${error?.message ?? error}`, 'upstream_unreachable')
    }
    if (!response.ok) throw new ApiError(502, `下载上游图片失败（HTTP ${response.status}）`, 'upstream_error')
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mime: response.headers.get('content-type')?.split(';')[0] ?? 'image/png'
    }
  }
  throw new ApiError(502, '上游未返回图片内容', 'upstream_error')
}

/**
 * 调用上游出图。
 * ------------------------------------------------------------------
 * 网络层的异常（连不上、超时、TLS 失败）必须在这里包成 502：
 * 让它们裸奔出去会被兜底逻辑当成 500（= 我们自己的 bug），
 * 而实际上是上游的问题，运维看错误码应该能一眼分清。
 */
async function callUpstream({ kind, prompt, model, quality, size, n, inputImages, background }) {
  const apiKey = config.llm.apiKey
  if (!apiKey) {
    throw new ApiError(503, '服务端未配置 LLM_API_KEY，无法生成图片', 'upstream_not_configured')
  }

  // 模型名映射（config.llm.modelMap）：网关渠道侧的模型 ID 可能与公开名
  // 不一致（如 llm-api.net 要求 -c 后缀）。在这里统一改名，调用方继续用
  // 公开名；映射表由 LLM_MODEL_MAP 环境变量控制。
  const upstreamModel = config.llm.modelMap[model] ?? model

  const isEdit = kind === 'edit'
  const url = `${config.llm.baseUrl}/v1/images/${isEdit ? 'edits' : 'generations'}`

  let body
  const headers = { Accept: 'application/json', Authorization: `Bearer ${apiKey}` }

  if (isEdit) {
    const form = new FormData()
    form.append('prompt', prompt)
    form.append('model', upstreamModel)
    form.append('n', String(n))
    form.append('size', size)
    form.append('quality', quality)
    // 透明背景：只有「一键抠图」这类模板会带，值在 runImageTask 里已洗成 'transparent'。
    // 上游是 OpenAI 兼容接口（/v1/images/edits），background=transparent + PNG 输出
    // 才会返回真 alpha 通道；纯提示词写法经常只画出假棋盘格。
    if (background) form.append('background', background)
    for (const image of inputImages) {
      form.append('image', new Blob([image.buffer], { type: image.mime }), image.filename)
    }
    body = form
  } else {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify({ model: upstreamModel, prompt, n, size, quality, ...(background ? { background } : {}) })
  }

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(config.llm.timeoutMs)
    })
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    throw new ApiError(
      502,
      timedOut
        ? `图片生成服务响应超时（超过 ${Math.round(config.llm.timeoutMs / 1000)} 秒）`
        : `无法连接图片生成服务：${error?.message ?? error}`,
      timedOut ? 'upstream_timeout' : 'upstream_unreachable'
    )
  }

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const message = payload?.error?.message ?? `上游返回 HTTP ${response.status}`
    throw new ApiError(502, message, 'upstream_error')
  }

  const list = Array.isArray(payload.data) ? payload.data : []
  if (!list.length) throw new ApiError(502, '上游未返回任何图片', 'upstream_error')
  return list
}

/** mock 出图：本地生成占位图并落盘，返回可访问 URL */
async function mockImages({ userId, prompt, size, n, baseUrl }) {
  const { width, height } = parseSize(size)
  const seed = [...String(prompt ?? '')].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  const images = []
  for (let index = 0; index < n; index += 1) {
    const buffer = createPlaceholderPng({
      width,
      height,
      hue: (seed * 0.7 + index * 47) % 360,
      seed: seed / 100 + index
    })
    const record = await saveGeneratedImage({ userId, buffer, mime: 'image/png' })
    images.push({ url: publicUrl(record.fileId, baseUrl), fileId: record.fileId, revisedPrompt: prompt })
  }
  return images
}

/**
 * 生成或编辑图片，含扣费与幂等。
 * @param {object} options
 * @param {string} options.kind 'generate' | 'edit'
 */
export async function runImageTask({
  kind = 'generate',
  userId,
  openid,
  prompt,
  model,
  quality,
  size,
  n,
  requestId,
  inputImages = [],
  asset = null,
  baseUrl = '',
  background = undefined
}) {
  if (!prompt?.trim()) throw badRequest('提示词不能为空', 'missing_prompt')
  // background 只认 'transparent'：这是目前唯一对外暴露的取值，
  // 其他值（opaque/auto）等于没传，不让它进上游。
  const cleanBackground = background === 'transparent' ? 'transparent' : undefined

  const batch = clampBatch(n)
  /**
   * 尺寸必须在**预扣之前**判定。
   * 位置和「限流必须在 reserveCharge 之前」是同一条道理：用户不该为一次
   * 注定失败的请求付钱。放这里还有一个好处 —— 上游拿到的一定是契约内的值，
   * 不会出现「客户端传了 '1:1' 就原样透传出去」。
   */
  const resolvedSize = normalizeSize(size)
  const key = idempotencyKey(userId, requestId, kind)

  // 1. 幂等：网络超时后客户端重试，不应重复出图、重复扣费
  const cached = getIdempotent(key)
  if (cached) {
    return { ...cached.payload, idempotent: true }
  }

  // 2. 内容安全：提示词先过审，避免白扣用户的钱
  await guardText(prompt, openid, kind === 'edit' ? 'edit-prompt' : 'prompt')

  // 3. 预扣（余额校验与扣款在同一次同步写内完成）
  const charge = Number((batch * config.imageCost).toFixed(2))
  const hold = await reserveCharge(userId, charge, {
    type: kind,
    title: kind === 'edit' ? '产品替换' : '图片生成',
    batch,
    model
  })
  if (!hold.ok) {
    throw new ApiError(
      402,
      `点数不足，本次需要 ${charge} 点，当前余额 ${hold.balance} 点`,
      'insufficient_balance',
      { balance: hold.balance, required: charge, imageCost: config.imageCost }
    )
  }

  try {
    let images

    if (config.mockLlm) {
      images = await mockImages({ userId, prompt, size: resolvedSize, n: batch, baseUrl })
    } else {
      const upstream = await callUpstream({
        kind,
        prompt,
        model,
        quality,
        size: resolvedSize,
        n: batch,
        inputImages,
        background: cleanBackground
      })
      images = []
      for (const item of upstream) {
        const { buffer, mime } = await toBuffer(item)
        // 一键抠图兜底：上游必须返回真透明 PNG。白底/不透明的结果在这里
        // 直接判失败 —— 下面的 catch 会自动退还预扣点数，用户看到明确
        // 的失败提示，而不是花了钱拿到一张假的白底图。
        if (cleanBackground === 'transparent') {
          try {
            assertTransparentPng(buffer)
          } catch (error) {
            throw new ApiError(502, `抠图失败：上游未返回透明背景（${error.message}），点数已退回，请重试`, 'transparent_not_returned')
          }
        }
        // 生成结果也回扫一遍：模型有时会产出不适合传播的画面
        await guardImage(buffer, mime, 'generated.png')
        const record = await saveGeneratedImage({ userId, buffer, mime })
        images.push({ url: publicUrl(record.fileId, baseUrl), fileId: record.fileId, revisedPrompt: item.revised_prompt })
      }
    }

    const settled = await commitCharge(hold.holdId)
    if (!settled.ok) {
      // 预扣记录在结算时不见了。正常路径下不可能：commit 紧跟在 reserve 之后，
      // 中间只有一次上游调用，没有任何东西会删掉这个 hold。
      //
      // 这里**绝不能**直接用 settled.balance —— 找不到 hold 时它回退成
      // getBalance(s, '')（空 userId）= 0，会把「余额 0 点」报给一个其实还有
      // 余额的用户。用户看到余额清零会立刻以为钱没了，是比少一次扣费更糟的
      // 事故。所以退回账户的实际值。
      console.warn(`[image] 预扣 ${hold.holdId} 在结算时已不存在，余额改读账户实际值`)
    }
    const balanceAfter = settled.ok ? settled.balance : getAccount(userId).balance

    if (asset?.title) {
      await saveAsset(userId, {
        title: asset.title,
        skill: asset.skill ?? model,
        templateId: asset.templateId ?? '',
        images: images.map((item) => item.url)
      })
    }

    const payload = {
      images,
      balance: balanceAfter,
      charged: charge,
      imageCost: config.imageCost,
      batch
    }
    await saveIdempotent(key, payload)
    return payload
  } catch (error) {
    // 上游失败 / 审核异常 —— 把钱还回去
    await releaseCharge(hold.holdId, error instanceof Error ? error.message : 'unknown')
    throw error
  }
}

/** 预设资源 ID：`preset:model-01`。名字只允许小写字母/数字/连字符，防路径穿越。 */
const PRESET_ID = /^preset:([a-z0-9-]+)$/

/** 读取客户端上传的素材（编辑接口用），或预设资源（preset: 前缀，服务端本地直读） */
export function loadInputImages(fileIds = []) {
  return fileIds.map((fileId) => {
    const preset = PRESET_ID.exec(String(fileId ?? ''))
    if (preset) {
      // 预设模特（试穿功能）：直接读 presetDir 下的同名 png，不走上传接口中转。
      // 用户侧无感，也省一次下载+上传的往返。
      let buffer
      try {
        buffer = readFileSync(path.join(config.presetDir, `${preset[1]}.png`))
      } catch {
        throw badRequest(`预设模特不存在：${preset[1]}`, 'preset_not_found')
      }
      return { buffer, mime: 'image/png', filename: `${preset[1]}.png` }
    }
    const { record, buffer } = readStored(fileId)
    return { buffer, mime: record.mime, filename: record.originalName }
  })
}
