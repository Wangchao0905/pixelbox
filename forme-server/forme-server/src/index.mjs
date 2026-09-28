import http from 'node:http'
import { config, inspectConfig } from './config.mjs'
import { handleRequest } from './router.mjs'
import { flush, reclaimOrphanHolds } from './store.mjs'
import { notify } from './alert.mjs'
import { startSweeper, sweepUndeliveredOrders } from './pay.mjs'
import { startRateLimitSweeper } from './ratelimit.mjs'

/**
 * 服务入口
 * ------------------------------------------------------------------
 * 只用 node:http，不引 express/koa：
 * 路由数量在 20 以内，中间件需求为零，框架带来的只有依赖和升级成本。
 */

const { problems, notices } = inspectConfig()

console.log('forme-server 启动中…')
console.log(
  `  运行环境    ${config.nodeEnv}` +
    (config.isProduction ? '' : '（非生产：MOCK_WECHAT / SECURITY_MODE 等危险配置不会被拦）')
)
console.log(`  端口        ${config.port}`)
console.log(`  数据目录    ${config.dataDir}`)
console.log(`  MOCK_WECHAT ${config.mockWechat ? '1（不会真的调微信接口）' : '0'}`)
console.log(`  MOCK_LLM    ${config.mockLlm ? '1（返回本地占位图）' : '0'}`)
console.log(`  内容安全    ${config.securityMode}`)
console.log(`  接口限流    ${config.rateLimit.enabled ? '开' : '关（生产环境禁止）'}`)

for (const notice of notices) console.warn(`  ⚠️  ${notice}`)
for (const problem of problems) console.error(`  ❌  ${problem}`)

if (problems.length) {
  console.error('\n启动自检未通过。请补齐上面的配置后再启动（本地开发可用 MOCK_WECHAT=1 / MOCK_LLM=1 绕过）。')
  process.exit(1)
}

/**
 * 回收上一次进程留下的孤儿预扣。
 * ------------------------------------------------------------------
 * 必须放在 listen 之前：一旦开始接收请求，就又有新的 hold 在飞，
 * 「启动瞬间不存在有效 hold」这条推理就不再成立了。
 *
 * 上一次进程如果是在「预扣已落盘、上游还在 await」的窗口里死的
 * （滚动发布、OOM、kill -9 都会），用户余额就被永久扣掉了一笔，
 * 而且流水停在 pending —— 用户看到扣费却没拿到图，运维不重启也发现不了。
 */
const reclaimed = await reclaimOrphanHolds()
if (reclaimed.released.length) {
  for (const item of reclaimed.released) {
    console.warn(
      `  ↩️  回收孤儿预扣 ${item.amount} 点 user=${item.userId} hold=${item.holdId}（上一次进程在结算前退出）`
    )
  }
  // 这不是「修好了就完事」的事：它意味着上一次进程是非正常退出的，
  // 每一次发生都在真金白银地吃掉用户余额。必须让人看见，否则会一直发生。
  notify('warn', '回收孤儿预扣', {
    count: reclaimed.released.length,
    total: `${reclaimed.total} 点`,
    reason: '上一次进程在预扣与结算之间退出（发布 / OOM / 强杀）',
    action: '已自动退还给用户。若频繁出现，检查部署方式是否在请求处理中强杀进程'
  })
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    // handleRequest 内部已经兜了业务异常，走到这里说明是兜底逻辑自身出错
    console.error('[server] 请求处理异常', error)
    if (res.headersSent) {
      res.end()
      return
    }
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false, code: 'internal_error', message: '服务端异常' }))
  })
})

server.listen(config.port, config.host, () => {
  const shown = config.host === '0.0.0.0' ? '127.0.0.1' : config.host
  console.log(`\n✅ 监听 http://${shown}:${config.port}${config.host === '0.0.0.0' ? '（全部网卡）' : ''}`)
  console.log(`   健康检查  GET /api/health`)
  console.log(`   支付回调  POST /api/pay/notify`)
})

// 发货推送会丢，兜底查单是必需品而不是优化项
startSweeper()
// 限流计数桶的定期清扫，防止内存无界增长
startRateLimitSweeper()
if (!config.mockWechat) {
  sweepUndeliveredOrders().catch((error) => console.error('[pay] 启动查单失败', error?.message))
}

/**
 * 优雅退出：先停收新连接，再把内存里的数据落盘。
 * 不落盘会丢最近几秒的余额变动——比崩溃更难排查。
 *
 * 等待在飞请求的时长由 SHUTDOWN_GRACE_MS 决定（默认 5 秒）。出图最长可以
 * 跑到 LLM_TIMEOUT_MS（默认 180 秒），所以默认配置下发布时在飞的出图请求
 * 基本都会被砍掉——这是有意的取舍，等满 180 秒才能发布不可接受。
 * 被砍掉的请求留下的孤儿预扣会在下次启动时自动退还给用户。
 */
let closing = false
function shutdown(signal) {
  if (closing) return
  closing = true
  console.log(`\n收到 ${signal}，正在退出…（最多等 ${config.shutdownGraceMs / 1000} 秒在飞请求）`)

  server.close(() => {
    flush()
    console.log('已停止监听，数据已落盘。')
    process.exit(0)
  })

  // 有长连接挂着时 server.close 不会回调，给一个硬超时
  setTimeout(() => {
    flush()
    console.warn('关闭超时，强制退出（数据已落盘）。被中断的请求会留下孤儿预扣，下次启动自动退还。')
    process.exit(0)
  }, config.shutdownGraceMs).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
