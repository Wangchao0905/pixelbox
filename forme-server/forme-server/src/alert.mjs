import { config } from './config.mjs'

/**
 * 告警出口
 * ------------------------------------------------------------------
 * 有些事只写日志等于没写——没人会去翻服务器日志。
 * 典型的是退款缺口：用户把钱退走了，点数已经花掉收不回来，
 * 这是**真实亏损**，必须主动推到人能看到的地方。
 *
 * 设计约束：
 *  1. 告警绝不能影响业务。发失败就发失败，不能把退款流程搞挂，
 *     所以这里吞掉所有异常，且是 fire-and-forget。
 *  2. 必须带超时。告警服务挂了不能把请求挂住。
 *  3. 未配置 webhook 时只打日志，不报错——本地开发和单机部署
 *     不应该因为没配告警就起不来。
 */

const TIMEOUT_MS = 5000

/** 校验配置时只返回原因，不输出含密钥的完整 URL。 */
export function inspectAlertConfig() {
  const { webhookUrl, format } = config.alert
  if (!webhookUrl) return '未配置 ALERT_WEBHOOK_URL'
  if (!['generic', 'wecom', 'dingtalk', 'feishu'].includes(format)) return 'ALERT_WEBHOOK_FORMAT 不受支持'
  try {
    const url = new URL(webhookUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
      return 'ALERT_WEBHOOK_URL 格式不正确'
    }
    if (config.isProduction && url.protocol !== 'https:') return '生产告警地址必须使用 HTTPS'
  } catch {
    return 'ALERT_WEBHOOK_URL 格式不正确'
  }
  return null
}

/** 把告警内容按目标平台的格式包一层 */
function formatBody(level, event, detail) {
  const title = `${level === 'critical' ? '🔴 严重' : '🟡 警告'} [forme] ${event}`
  const lines = Object.entries(detail ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')
  const content = lines ? `${title}\n${lines}` : title

  switch (config.alert.format) {
    // 企业微信 / 钉钉 机器人的 text 消息结构相同
    case 'wecom':
    case 'dingtalk':
      return { msgtype: 'text', text: { content } }
    case 'feishu':
      return { msg_type: 'text', content: { text: content } }
    default:
      return {
        service: 'forme-server',
        level,
        event,
        detail: detail ?? {},
        time: new Date().toISOString()
      }
  }
}

/**
 * 发一条告警。
 * @param {'critical'|'warn'} level
 * @param {string} event 机器可读的事件名，便于在告警平台做规则
 * @param {object} detail 附加上下文，会原样带过去
 */
export async function notify(level, event, detail = {}) {
  const line = `[alert:${level}] ${event} ${JSON.stringify(detail)}`
  if (level === 'critical') console.error(line)
  else console.warn(line)

  const configError = inspectAlertConfig()
  if (configError) {
    if (config.alert.webhookUrl) console.error(`[alert] ${configError}`)
    return { ok: false, reason: configError }
  }

  // 业务调用方不等待此 Promise；测试命令可等待结果。所有发送错误都在这里收敛。
  try {
    const response = await fetch(config.alert.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formatBody(level, event, detail)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error'
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (config.alert.format !== 'generic') {
      let payload
      try { payload = await response.json() } catch { throw new Error('平台响应不是 JSON') }
      const code = config.alert.format === 'feishu' ? (payload?.code ?? payload?.StatusCode) : payload?.errcode
      if (code !== 0) {
        throw new Error(Number.isInteger(code) ? `平台拒绝消息，错误码 ${code}` : '平台响应缺少成功状态码')
      }
    } else {
      await response.body?.cancel()
    }
    return { ok: true, format: config.alert.format }
  } catch (error) {
    // 不打印 fetch 原始异常或平台 errmsg，它们可能回显带密钥的请求地址。
    const reason = /^(HTTP \d{3}|平台响应不是 JSON|平台拒绝消息，错误码 -?\d+|平台响应缺少成功状态码)$/.test(error?.message ?? '')
      ? error.message : '网络连接失败或发送超时'
    console.error(`[alert] 告警发送失败 event=${event} ${reason}`)
    return { ok: false, reason }
  }
}
