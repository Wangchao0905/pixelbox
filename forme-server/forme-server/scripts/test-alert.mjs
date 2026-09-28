import crypto from 'node:crypto'
import { inspectAlertConfig, notify } from '../src/alert.mjs'

if (!process.argv.includes('--send')) {
  console.error('此命令会向已配置的接收方发送一条测试消息。运行：npm run test:alert -- --send')
  process.exit(2)
}
const problem = inspectAlertConfig()
if (problem) {
  console.error(problem)
  process.exit(1)
}
const testId = `forme-alert-${crypto.randomUUID().slice(0, 8)}`
const result = await notify('warn', '告警通道测试（无需处理）', {
  testId,
  time: new Date().toISOString(),
  message: 'Pixel Box 退款异常与退款缺口将通过此渠道通知；本消息不会产生交易或退款。'
})
if (!result.ok) {
  console.error(`告警测试失败：${result.reason}`)
  process.exit(1)
}
console.log(`告警平台已接受测试消息：${testId}。请在目标渠道核对该编号，平台接受不等于收件人已读。`)
