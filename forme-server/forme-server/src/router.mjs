import { config, inspectConfig } from './config.mjs'
import { PASS_DAYS, isTestPaymentOpenid, sellablePlans } from './catalog.mjs'
import {
  ApiError,
  badRequest,
  cors,
  notFound,
  parseMultipart,
  readJsonBody,
  readRawBody,
  sendBuffer,
  sendJson,
  sendText
} from './http.mjs'
import { authenticate, login, logout } from './session.mjs'
import { guardImage } from './security.mjs'
import { isSupportedImage, publicUrl, readStored, saveUpload } from './files.mjs'
import {
  deleteAsset,
  getAccount,
  getOrder,
  listAssets,
  listTransactions
} from './store.mjs'
import { loadInputImages, runImageTask } from './image.mjs'
import { DEFAULT_SIZE } from './sizes.mjs'
import { assertWithinLimit, clientIp } from './ratelimit.mjs'
import {
  createPayOrder,
  handleXpayNotify,
  listOrders,
  mockPaidAndDeliver,
  mockRefundOrder,
  msgPushSignature,
  queryUserOrder,
  safeEqual
} from './pay.mjs'

/**
 * 路由层
 * ------------------------------------------------------------------
 * 只做三件事：解析参数 → 调领域模块 → 输出响应。
 * 业务规则一律放在 store / image / pay 里，路由保持可一眼扫完的薄。
 */

/** 对外可访问的绝对地址。用请求头推断，避免写死域名 */
function baseUrlOf(req) {
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || 'http'
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? `127.0.0.1:${config.port}`
  return `${proto}://${host}`
}

/* ================================================================
   系统
   ================================================================ */

async function handleHealth() {
  const { problems, notices } = inspectConfig()
  return {
    ok: problems.length === 0,
    service: 'forme-server',
    time: new Date().toISOString(),
    mock: { wechat: config.mockWechat, llm: config.mockLlm },
    securityMode: config.securityMode,
    imageCost: config.imageCost,
    // 上线后最常要确认的一件事就是「不送点数」有没有真的生效。
    // 放这里是为了能一条 curl 看到，不用去翻服务器上的 env 文件。
    // 不是机密（和 imageCost 一样属于定价策略），所以不鉴权也无所谓。
    initialBalance: config.initialBalance,
    rateLimitEnabled: config.rateLimit.enabled,
    problems,
    notices
  }
}

/* ================================================================
   登录态
   ================================================================ */

/** 每分钟窗口。所有限流规则共用 */
const MINUTE = 60 * 1000

async function handleLogin(ctx) {
  // 登录不需要任何凭据（拿 code 换 token），是最容易被脚本刷的入口，按 IP 限
  assertWithinLimit('login', clientIp(ctx.req), {
    limit: config.rateLimit.loginPerMinute,
    windowMs: MINUTE
  })

  const body = await readJsonBody(ctx.req)
  const code = String(body.code ?? '').trim()
  if (!code) throw badRequest('缺少 code', 'missing_code')
  return login(code)
}

async function handleLogout(ctx) {
  const session = authenticate(ctx.req)
  return logout(session.token)
}

async function handleProfile(ctx) {
  const session = authenticate(ctx.req)
  const account = getAccount(session.userId)
  return {
    user: { id: session.userId, openid: session.openid },
    balance: account.balance,
    passExpiresAt: account.passExpiresAt,
    imageCost: config.imageCost
  }
}

/* ================================================================
   账户
   ================================================================ */

async function handleAccount(ctx) {
  const session = authenticate(ctx.req)
  const account = getAccount(session.userId)
  return {
    balance: account.balance,
    passExpiresAt: account.passExpiresAt,
    imageCost: config.imageCost,
    transactions: listTransactions(session.userId, 50)
  }
}

/** 商品目录：价格以服务端为准，客户端不参与定价 */
async function handleCatalog(ctx) {
  let includeTest = false
  try {
    includeTest = isTestPaymentOpenid(authenticate(ctx.req).openid)
  } catch {
    // 目录仍可匿名读取；临时测试商品只出现在白名单登录用户的目录中。
  }
  return {
    plans: sellablePlans({ includeTest }),
    imageCost: config.imageCost,
    maxBatch: config.maxBatch,
    /** 有效期道具的标准天数，客户端展示文案用 */
    passDays: PASS_DAYS,
    /**
     * AIGC 显式标识文案（《人工智能生成合成内容标识办法》第四条）。
     * 由服务端下发而不是客户端写死：署名主体、文案口径属于合规信息，
     * 改了要能立刻全量生效，不能等发版。
     */
    aigc: {
      label: config.aigc.explicitLabel,
      provider: config.aigc.provider
    }
  }
}

/* ================================================================
   素材
   ================================================================ */

/** wx.uploadFile 走 multipart/form-data，只取第一个文件字段 */
async function handleUpload(ctx) {
  const session = authenticate(ctx.req)
  assertWithinLimit('upload', session.userId, {
    limit: config.rateLimit.uploadPerMinute,
    windowMs: MINUTE
  })
  const raw = await readRawBody(ctx.req)
  const { files } = parseMultipart(raw, ctx.req.headers['content-type'])

  const file = files[0]
  if (!file) throw badRequest('没有收到文件', 'no_file')
  if (!isSupportedImage(file.mime)) {
    throw badRequest(`不支持的图片格式：${file.mime}`, 'unsupported_type')
  }

  // 上传即过审：把违规素材挡在生成之前，避免用户白扣点数
  await guardImage(file.buffer, file.mime, file.filename)

  const record = await saveUpload({
    userId: session.userId,
    buffer: file.buffer,
    mime: file.mime,
    filename: file.filename
  })

  return {
    fileId: record.fileId,
    url: publicUrl(record.fileId, ctx.baseUrl),
    size: record.size,
    mime: record.mime
  }
}

/** 静态读文件。生产环境应换成 CDN 直出，这里只是参考实现 */
async function handleFile(ctx) {
  const { record, buffer } = readStored(ctx.params.fileId)
  sendBuffer(ctx.res, 200, buffer, record.mime)
}

/* ================================================================
   生成
   ================================================================ */

function batchOf(body) {
  const value = Math.floor(Number(body.n) || 1)
  if (value < 1) return 1
  return Math.min(value, config.maxBatch)
}

function requestIdOf(ctx, body) {
  return String(body.requestId ?? ctx.req.headers['x-request-id'] ?? '').trim()
}

async function handleGenerate(ctx) {
  const session = authenticate(ctx.req)
  // 限流放在 authenticate 之后：按 userId 限比按 IP 准，
  // 同一 NAT 出口下的多个用户不会互相挤掉额度
  assertWithinLimit('generate', session.userId, {
    limit: config.rateLimit.generatePerMinute,
    windowMs: MINUTE
  })
  const body = await readJsonBody(ctx.req)

  return runImageTask({
    kind: 'generate',
    userId: session.userId,
    openid: session.openid,
    prompt: body.prompt,
    model: body.model ?? 'gpt-image-1',
    quality: body.quality ?? 'high',
    size: body.size ?? DEFAULT_SIZE,
    n: batchOf(body),
    requestId: requestIdOf(ctx, body),
    asset: body.asset ?? null,
    baseUrl: ctx.baseUrl
  })
}

async function handleEdit(ctx) {
  const session = authenticate(ctx.req)
  // 与 generate 共用一个额度池：两者都调模型，分开算等于额度翻倍
  assertWithinLimit('generate', session.userId, {
    limit: config.rateLimit.generatePerMinute,
    windowMs: MINUTE
  })
  const body = await readJsonBody(ctx.req)

  const fileIds = Array.isArray(body.fileIds) ? body.fileIds.filter(Boolean) : []
  if (!fileIds.length) {
    throw badRequest('产品替换至少需要一张素材图', 'missing_source_image')
  }

  return runImageTask({
    kind: 'edit',
    userId: session.userId,
    openid: session.openid,
    prompt: body.prompt,
    model: body.model ?? 'gpt-image-1',
    quality: body.quality ?? 'high',
    size: body.size ?? DEFAULT_SIZE,
    n: batchOf(body),
    requestId: requestIdOf(ctx, body),
    inputImages: loadInputImages(fileIds),
    asset: body.asset ?? null,
    baseUrl: ctx.baseUrl,
    // 只有 'transparent' 会被透传给上游，其他值在 runImageTask 里洗掉
    background: body.background
  })
}

/* ================================================================
   资产库
   ================================================================ */

async function handleAssets(ctx) {
  const session = authenticate(ctx.req)
  return { assets: listAssets(session.userId, 50) }
}

async function handleDeleteAsset(ctx) {
  const session = authenticate(ctx.req)
  const result = await deleteAsset(session.userId, ctx.params.assetId)
  if (!result.ok) throw notFound('资产不存在')
  return result
}

/* ================================================================
   虚拟支付
   ================================================================ */

async function handlePayOrder(ctx) {
  const session = authenticate(ctx.req)
  assertWithinLimit('order', session.userId, {
    limit: config.rateLimit.orderPerMinute,
    windowMs: MINUTE
  })
  const body = await readJsonBody(ctx.req)
  return createPayOrder({
    userId: session.userId,
    openid: session.openid,
    sessionKey: session.sessionKey,
    planId: body.planId
  })
}

async function handlePayQuery(ctx) {
  const session = authenticate(ctx.req)
  return queryUserOrder({ userId: session.userId, outTradeNo: ctx.params.outTradeNo })
}

async function handlePayOrders(ctx) {
  const session = authenticate(ctx.req)
  return { orders: listOrders(session.userId, 30) }
}

/**
 * 平台推送总入口（发货 + 退款）。公开接口（微信服务器直接调），不校验登录态。
 * 安全性靠「wx_order_id 幂等 + 发货路径主动查单交叉确认」，见 pay.mjs 注释。
 * 响应体必须是 XML，且必须用 200 返回，否则平台会一直重试（最多 15 次）。
 *
 * 同一个 URL 的 GET 是另一件事：后台保存配置时的 URL 验证，见 handleNotifyVerify。
 */
async function handleNotify(ctx) {
  const token = config.wechat.msgToken
  const signature = ctx.query.get('signature') ?? ''
  const timestamp = ctx.query.get('timestamp') ?? ''
  const nonce = ctx.query.get('nonce') ?? ''
  if (!token || !signature || !/^\d+$/.test(timestamp) || !nonce ||
      !safeEqual(msgPushSignature({ token, timestamp, nonce }), signature)) {
    console.warn('[msgpush] POST 推送签名缺失或不匹配')
    sendText(ctx.res, 403, 'invalid signature\n')
    return
  }
  const raw = (await readRawBody(ctx.req)).toString('utf8')
  const reply = await handleXpayNotify(raw)
  sendText(ctx.res, 200, reply, 'application/xml; charset=utf-8')
}

/**
 * 消息推送的 URL 验证握手（GET，同一个 URL）。
 * ------------------------------------------------------------------
 * MP 后台「消息推送」点保存时，微信会发 GET 带 signature/timestamp/nonce/
 * echostr，验签通过后必须**原样返回 echostr**，否则后台报「配置失败」，
 * 发货推送与退款推送都配不上。
 *
 * 这里只证明「这个 URL 是我们自己的」。发货推送本身的安全性不靠它 ——
 * 靠 handleDeliverNotify 的主动查单（见 pay.mjs）。
 */
async function handleNotifyVerify(ctx) {
  const token = config.wechat.msgToken
  const signature = ctx.query.get('signature') ?? ''
  const timestamp = ctx.query.get('timestamp') ?? ''
  const nonce = ctx.query.get('nonce') ?? ''
  const echostr = ctx.query.get('echostr')

  if (!token) {
    // 不是 404：让在后台点保存的人（以及 curl 的人）能直接看到该补什么。
    sendText(
      ctx.res,
      503,
      '服务器未配置 WECHAT_MSG_TOKEN，无法应答微信的 URL 验证。\n' +
        '请把「消息推送」页面里填的那个 Token 写进 forme-server/.env.local，然后重启服务。\n'
    )
    return
  }

  if (echostr === null) {
    sendText(
      ctx.res,
      400,
      '缺少 echostr：这是微信「消息推送」保存配置时的 URL 验证入口，不能直接访问。\n'
    )
    return
  }

  if (!signature || !timestamp || !nonce) {
    sendText(ctx.res, 400, '缺少 signature / timestamp / nonce\n')
    return
  }

  if (!safeEqual(msgPushSignature({ token, timestamp, nonce }), signature)) {
    console.warn(
      '[msgpush] URL 验证签名不匹配：核对 WECHAT_MSG_TOKEN 与后台「消息推送」里填的 Token 是否一致'
    )
    sendText(ctx.res, 403, 'signature 校验失败\n')
    return
  }

  console.log('[msgpush] URL 验证通过')
  // 必须原样返回：不加引号、不加换行、不加 CDATA
  sendText(ctx.res, 200, echostr)
}

/** 模拟支付成功，仅 MOCK_WECHAT=1 时存在 */
async function handleMockPay(ctx) {
  const session = authenticate(ctx.req)
  const body = await readJsonBody(ctx.req)
  const outTradeNo = String(body.orderId ?? '').trim()
  if (!outTradeNo) throw badRequest('缺少 orderId', 'missing_order_id')

  const order = getOrder(outTradeNo)
  if (!order) throw notFound('订单不存在')
  if (order.userId !== session.userId) throw new ApiError(403, '无权操作该订单', 'forbidden')

  return mockPaidAndDeliver(outTradeNo)
}

/**
 * 模拟退款，仅 MOCK_WECHAT=1 时存在。
 * 真实的退款推送无法在本地复现，没有这个入口退款回收逻辑就完全测不到。
 */
async function handleMockRefund(ctx) {
  const session = authenticate(ctx.req)
  const body = await readJsonBody(ctx.req)
  const outTradeNo = String(body.orderId ?? '').trim()
  if (!outTradeNo) throw badRequest('缺少 orderId', 'missing_order_id')

  const order = getOrder(outTradeNo)
  if (!order) throw notFound('订单不存在')
  if (order.userId !== session.userId) throw new ApiError(403, '无权操作该订单', 'forbidden')

  return mockRefundOrder(outTradeNo, body.reason)
}

/* ================================================================
   路由表
   ================================================================ */

const ROUTES = [
  ['GET', '/api/health', handleHealth],
  ['GET', '/api/catalog', handleCatalog],

  ['POST', '/api/login', handleLogin],
  ['POST', '/api/logout', handleLogout],
  ['GET', '/api/profile', handleProfile],
  ['GET', '/api/account', handleAccount],

  ['POST', '/api/upload', handleUpload],
  ['GET', '/api/files/:fileId', handleFile],

  ['POST', '/api/generate-image', handleGenerate],
  ['POST', '/api/edit-image', handleEdit],

  ['GET', '/api/assets', handleAssets],
  ['DELETE', '/api/assets/:assetId', handleDeleteAsset],

  ['POST', '/api/pay/order', handlePayOrder],
  ['GET', '/api/pay/orders', handlePayOrders],
  ['GET', '/api/pay/order/:outTradeNo', handlePayQuery],
  ['POST', '/api/pay/notify', handleNotify],
  // 同一个 URL 还要应答 GET：MP 后台保存「消息推送」配置时的 URL 验证。
  // 少了这一条，后台点保存会拿到 404，配置根本存不下去 —— 发货推送永远配不上。
  ['GET', '/api/pay/notify', handleNotifyVerify],

  // mock 入口只在 MOCK_WECHAT=1 时注册。
  // 这两条能凭空给订单发货/退款，生产环境绝不能可达 ——
  // pay.mjs 里已有 `if (!config.mockWechat) throw 403` 兜底，
  // 这里连路由都不注册，做到「不存在」而不是「存在但拒绝」：
  // 万一以后有人重构把内层守卫删了，也不会直接变成免费发点数的洞。
  ...(config.mockWechat
    ? [
        ['POST', '/api/pay/mock-pay', handleMockPay],
        ['POST', '/api/pay/mock-refund', handleMockRefund]
      ]
    : [])
]

/** 把 '/api/files/:fileId' 编译成正则 + 参数名列表，启动时算一次 */
function compile(path) {
  const names = []
  const source = path.replace(/:([A-Za-z0-9_]+)/g, (_, name) => {
    names.push(name)
    return '([^/]+)'
  })
  return { pattern: new RegExp(`^${source}$`), names }
}

const COMPILED = ROUTES.map(([method, path, handler]) => ({
  method,
  handler,
  ...compile(path)
}))

function sendError(res, error, req) {
  const status = error instanceof ApiError ? error.status : 500
  const code = error instanceof ApiError ? error.code : 'internal_error'
  const message = error instanceof ApiError ? error.message : '服务端异常'

  // 5xx 一定是我们的 bug，必须留日志；4xx 是客户端用法问题，不刷屏
  if (status >= 500) {
    console.error(`[router] ${req.method} ${req.url} -> ${status}`, error)
  }

  if (res.headersSent) {
    res.end()
    return
  }
  // 429 带上标准 Retry-After，客户端和网关都能据此退避
  if (status === 429 && error?.extra?.retryAfter) {
    res.setHeader('Retry-After', String(error.extra.retryAfter))
  }
  sendJson(res, status, { ok: false, code, message, ...(error?.extra ?? {}) })
}

export async function handleRequest(req, res) {
  cors(req, res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://127.0.0.1:${config.port}`)
  // 容忍尾部斜杠：/api/account/ 与 /api/account 等价
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  const baseUrl = baseUrlOf(req)

  // 兜底限流：按 IP 限制总请求量，挡住没单独配规则的接口。
  // 以下三类必须放行，否则会误伤：
  //   /api/health     —— 监控与容器健康检查，被限流会导致误判服务挂掉
  //   /api/pay/notify —— 微信平台的支付回调，被限流会导致发货/退款丢失
  //   /api/files/*    —— 图片静态读取，资产库滚动时会瞬间几十个请求
  const skipGlobalLimit =
    pathname === '/api/health' ||
    pathname === '/api/pay/notify' ||
    pathname.startsWith('/api/files/')

  if (!skipGlobalLimit) {
    try {
      assertWithinLimit('global', clientIp(req), {
        limit: config.rateLimit.globalPerMinute,
        windowMs: MINUTE
      })
    } catch (error) {
      sendError(res, error, req)
      return
    }
  }

  for (const route of COMPILED) {
    if (route.method !== req.method) continue
    const match = route.pattern.exec(pathname)
    if (!match) continue

    const params = {}
    route.names.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1])
    })

    try {
      const payload = await route.handler({
        req,
        res,
        params,
        query: url.searchParams,
        baseUrl
      })
      // 自己写了响应的处理器返回 undefined，其余统一包成 200 JSON
      if (payload !== undefined && !res.headersSent) sendJson(res, 200, payload)
    } catch (error) {
      sendError(res, error, req)
    }
    return
  }

  sendError(res, notFound(`接口不存在：${req.method} ${pathname}`), req)
}
