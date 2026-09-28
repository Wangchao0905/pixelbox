import { config } from './config.mjs'
import { imgSecCheck, msgSecCheck } from './wechat.mjs'
import { ApiError } from './http.mjs'

/**
 * 内容安全闸门
 * ------------------------------------------------------------------
 * SECURITY_MODE：
 *   off     —— 完全不调用微信接口（本地开发用）
 *   log     —— 调用并把命中结果打到日志，但不拦截（灰度/联调期用）
 *   enforce —— 命中即拦截（上线必须用这个）
 *
 * 上线前必须切到 enforce：不做内容审核，小程序审核过不了；
 * 而且生成类应用一旦出现违规内容，是直接封小程序的风险。
 */

function enabled() {
  return config.securityMode !== 'off'
}

function blocking() {
  return config.securityMode === 'enforce'
}

/** 文本检查，用于用户输入的提示词 */
export async function guardText(content, openid, scene = 'prompt') {
  if (!content?.trim()) return { allowed: true }
  if (!enabled()) return { allowed: true, skipped: true }

  let result
  try {
    result = await msgSecCheck(content.slice(0, 2500), openid)
  } catch (error) {
    // 审核服务抖动不应该让正常用户用不了；记日志放行，由人工抽查兜底
    console.error(`[security] 文本检查失败 scene=${scene}`, error?.message)
    return { allowed: true, degraded: true }
  }

  const suggest = result?.suggest ?? 'pass'
  if (suggest !== 'pass') {
    console.warn(`[security] 文本命中 scene=${scene} suggest=${suggest} label=${result?.label ?? '-'} content=${content.slice(0, 80)}`)
  }

  if (suggest === 'risky' && blocking()) {
    throw new ApiError(400, '输入内容包含违规信息，请修改后重试', 'content_rejected')
  }
  return { allowed: suggest === 'pass', suggest }
}

/** 图片检查，用于用户上传的素材 */
export async function guardImage(buffer, mime, filename = 'image.png') {
  if (!buffer?.length) return { allowed: true }
  if (!enabled()) return { allowed: true, skipped: true }

  let result
  try {
    result = await imgSecCheck(buffer, mime, filename)
  } catch (error) {
    console.error('[security] 图片检查失败', error?.message)
    return { allowed: true, degraded: true }
  }

  if (!result?.ok) {
    console.warn(`[security] 图片命中 filename=${filename} reason=${result?.reason}`)
    if (blocking()) {
      throw new ApiError(400, '上传图片含违规内容，请更换后重试', 'content_rejected')
    }
  }
  return result
}
