import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '..')

/** 极简 .env 解析：够用即可，不引依赖 */
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const out = {}
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index <= 0) continue
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

// .env.local 覆盖 .env，两者都被真实环境变量覆盖
const fileEnv = {
  ...parseEnvFile(path.join(ROOT, '.env')),
  ...parseEnvFile(path.join(ROOT, '.env.local'))
}

function read(key, fallback = '') {
  const value = process.env[key] ?? fileEnv[key]
  return value === undefined || value === '' ? fallback : value
}

function flag(key, fallback = false) {
  const value = read(key, fallback ? '1' : '0')
  return value === '1' || value.toLowerCase() === 'true'
}

/**
 * 模型名映射表。环境变量 LLM_MODEL_MAP 是 JSON（如
 * '{"gpt-image-2.5-sunburst":"gpt-image-2.5-sunburst-c"}'）；没配时用
 * 2026-09-28 实测的 llm-api.net 默认映射。解析失败时退回默认映射，
 * 不让一次配错的环境变量把所有生图请求打挂。
 */
function parseModelMap(raw) {
  const fallback = {
    'gpt-image-2.5-sunburst': 'gpt-image-2.5-sunburst-c',
    'gpt-image-2': 'gpt-image-2-c',
    'gpt-image-2.5-flare': 'gpt-image-2.5-flare-c'
  }
  if (!raw || !raw.trim()) return fallback
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const clean = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && value.trim()) clean[key] = value.trim()
      }
      return clean
    }
  } catch {
    // 故意吞掉：见函数头注释
  }
  return fallback
}

/**
 * 运行环境。**必须和别的配置走同一条取值链**（process.env → .env → .env.local）。
 * ------------------------------------------------------------------
 * 这里踩过一个很隐蔽的坑：生产拦截原本全部直接读 `process.env.NODE_ENV`，
 * 而 `.env.local` 是放其它所有配置的地方，往里写 `NODE_ENV=production`
 * 是再自然不过的事 —— 写了却**完全不生效**，8 条拦截一条都不会触发。
 *
 * 后果不是「配置没生效」这么轻：
 *   MOCK_WECHAT=1   → 任何人构造一个 code 就能登录任意账号
 *   SECURITY_MODE=log → 违规内容不被拦截，小程序会被下架
 *   HOST=0.0.0.0    → 伪造 X-Forwarded-For 即可绕过全部限流
 * 而运维以为自己已经设成 production 了，还觉得自检是绿的。
 *
 * 所以别处一律用 `config.isProduction`，不要再直接读 process.env.NODE_ENV。
 */
const nodeEnv = read('NODE_ENV', 'development')

export const config = {
  nodeEnv,
  /** 生产环境。所有「只在生产拦截」的判断都用它 */
  isProduction: nodeEnv === 'production',

  port: Number(read('PORT', '8787')),

  /**
   * 监听地址。
   * ------------------------------------------------------------------
   * 生产环境**必须**设成 127.0.0.1，只让本机 nginx 能连进来。
   *
   * 原因：限流按 IP 计数，而「直连方是回环/内网地址时采信
   * X-Forwarded-For」是限流能拿到真实客户端 IP 的前提。
   * 如果服务直接暴露在公网，攻击者随手加一个
   * `X-Forwarded-For: 1.2.3.4` 就能每次换一个「IP」，限流形同虚设。
   *
   * 默认 0.0.0.0 是为了本地开发方便（模拟器/局域网真机调试要能连上）。
   */
  host: read('HOST', '0.0.0.0'),

  /**
   * 显式确认「我知道服务在 0.0.0.0 上」。
   * ------------------------------------------------------------------
   * 只有 Docker 场景才需要：容器内绑 0.0.0.0、但 compose 里不 publish 端口，
   * 服务只能被同一内网里的 nginx 容器访问，实际并未暴露到公网。
   * 这种情况无法从进程内部自动判断，所以要求手动确认一次。
   */
  allowPublicBind: flag('ALLOW_PUBLIC_BIND', false),

  dataDir: path.resolve(ROOT, read('DATA_DIR', 'data')),

  /**
   * 预设模特图目录（模特试穿功能用）。
   * ------------------------------------------------------------------
   * 前端传 fileId `preset:model-01` 时，loadInputImages 直接读这里的
   * `model-01.png`，不走「下载-上传」中转：省一次往返、用户无感更快。
   * 图片由 scripts/gen-tryon-models.mjs 生成后部署进来，不进 git
   *（二进制进仓库会变重，参考封面图 fetch-covers.mjs 的做法）。
   */
  presetDir: path.resolve(ROOT, read('PRESET_DIR', 'preset-models')),

  mockWechat: flag('MOCK_WECHAT', true),
  mockLlm: flag('MOCK_LLM', true),
  securityMode: read('SECURITY_MODE', 'log'),

  wechat: {
    appId: read('WECHAT_APPID'),
    appSecret: read('WECHAT_APP_SECRET'),
    offerId: read('WECHAT_OFFER_ID'),
    appKey: read('WECHAT_APP_KEY'),
    env: Number(read('WECHAT_ENV', '0')),
    notifyUrl: read('WECHAT_PAY_NOTIFY_URL'),
    /**
     * MP 后台【开发与服务 → 开发管理 → 消息推送】里自己填的那个 Token。
     * 用于 URL 验证 GET 及 POST 消息签名校验；发货另外主动查单核对支付状态。
     */
    msgToken: read('WECHAT_MSG_TOKEN')
  },

  /**
   * 临时 1 元真实支付验收。默认关闭；开启时必须填写正式道具 ID 和测试用户 OpenID 白名单。
   * 测试商品只在白名单用户的目录中出现，关闭开关后新订单立即不可创建。
   */
  testPayment: {
    enabled: flag('TEST_PAYMENT_ENABLED', false),
    productId: read('TEST_PAYMENT_PRODUCT_ID', 'forme_test'),
    openids: read('TEST_PAYMENT_OPENIDS')
      .split(/[\s,;]+/)
      .map((value) => value.trim())
      .filter(Boolean)
  },

  llm: {
    apiKey: read('LLM_API_KEY'),
    baseUrl: read('LLM_BASE_URL', 'https://llm-api.net').replace(/\/+$/, ''),
    /**
     * 上游超时。必须设：图片生成可能挂住几分钟，
     * 没有超时的话预扣的 hold 会一直占着用户点数，且连接不会释放。
     */
    timeoutMs: Number(read('LLM_TIMEOUT_MS', '180000')),
    /**
     * 模型名映射：网关渠道侧的模型 ID 与公开名不一致时用。
     * ------------------------------------------------------------------
     * 2026-09-28 用生产 Key 实锤：llm-api.net 的 /v1/models 只返回带 `-c`
     * 后缀的 ID（gpt-image-2.5-sunburst-c 等），代码与前端默认的无后缀名
     * （gpt-image-2.5-sunburst）直调必报 model_not_found。
     * 这里在发往上游前做一次改名，前端与调用方继续用公开名，不用改。
     * 换网关时改环境变量 LLM_MODEL_MAP（JSON）即可，不用改代码。
     */
    modelMap: parseModelMap(read('LLM_MODEL_MAP', ''))
  },

  /**
   * 告警出口。留空则只写日志。
   * 生产环境建议配上——退款缺口这类真实亏损没人翻日志就发现不了。
   */
  alert: {
    webhookUrl: read('ALERT_WEBHOOK_URL'),
    /** generic | wecom | dingtalk | feishu，决定消息体格式 */
    format: read('ALERT_WEBHOOK_FORMAT', 'generic')
  },

  /**
   * 接口限流。默认开启——关掉它意味着任何人都能刷爆模型额度。
   * 阈值全部可用环境变量覆盖，压测时把 RATE_LIMIT_ENABLED 设成 0。
   */
  rateLimit: {
    enabled: flag('RATE_LIMIT_ENABLED', true),
    /** 出图：每用户每分钟。模型调用是真花钱的，压得最紧 */
    generatePerMinute: Number(read('RATE_LIMIT_GENERATE_PER_MINUTE', '20')),
    /** 上传：每用户每分钟 */
    uploadPerMinute: Number(read('RATE_LIMIT_UPLOAD_PER_MINUTE', '30')),
    /** 下单：每用户每分钟。防刷单号 */
    orderPerMinute: Number(read('RATE_LIMIT_ORDER_PER_MINUTE', '10')),
    /** 登录：每 IP 每分钟。登录不需要凭据，是最容易被刷的入口 */
    loginPerMinute: Number(read('RATE_LIMIT_LOGIN_PER_MINUTE', '30')),
    /** 兜底：每 IP 每分钟，覆盖没单独配的接口 */
    globalPerMinute: Number(read('RATE_LIMIT_GLOBAL_PER_MINUTE', '300'))
  },

  /**
   * 每张图消耗的点数。与小程序端展示必须一致。
   * 放在环境变量里是因为这是定价参数，调价不该需要改代码 + 重新部署。
   * 客户端不写死这个值，一律以 /api/catalog 返回的 imageCost 为准。
   *
   * 当前定价：**单张图 0.4 点，充值点数以套餐为准**。
   * 是小数，所以全程按「点」而不是「张」记账——余额、扣费、退款回收
   * 都保留两位小数（见 store.mjs 的 toFixed(2)）。
   */
  imageCost: Number(read('IMAGE_COST', '0.4')),
  /**
   * 新用户初始点数。默认 **0** —— 不赠送，注册进来余额就是 0。
   * 想搞拉新活动再调大，但要注意「白送的点数 ÷ IMAGE_COST」才是真正送出去的
   * 张数：按当前单价 0.4 点/张，送 10 点等于白送 25 张图。
   * 这个换算不要写死——改单价后写死的数字会立刻变成错的（见 catalog.imageCount）。
   * 冒烟测试不依赖这个默认值，各实例都显式传自己的值。
   */
  initialBalance: Number(read('INITIAL_BALANCE', '0')),
  /** 会话有效期（秒） */
  sessionTtl: 7 * 24 * 3600,
  /** 单次最多出图数 */
  maxBatch: 4,

  /**
   * 退出时等待在飞请求的宽限期（毫秒）。
   * ------------------------------------------------------------------
   * 收到 SIGTERM 后先停收新连接，再等已有连接结束，最多等这么久，
   * 到点就落盘退出。
   *
   * 这个值决定了**发布时会不会砍掉正在生成的请求**。出图最长可以跑到
   * LLM_TIMEOUT_MS（默认 180 秒），默认宽限期只有 5 秒，所以每次发布
   * 基本都会砍掉在飞的出图请求。这是有意的取舍：等满 180 秒才能发布
   * 是不可接受的。
   *
   * 被砍掉的请求会留下一个孤儿预扣，由下次启动时的 reclaimOrphanHolds
   * 自动退还给用户（见 store.mjs），所以**不会资损**，用户重试即可。
   *
   * 想改成「排空再退出」就调大这个值，但必须同时调大 systemd 的
   * TimeoutStopSec（默认 15 秒），否则 systemd 会先 SIGKILL，等于没配。
   */
  shutdownGraceMs: Number(read('SHUTDOWN_GRACE_MS', '5000')),

  /**
   * AIGC 标识（《人工智能生成合成内容标识办法》，2025-09-01 起施行）
   * ------------------------------------------------------------------
   * metadata：是否在生成的图片文件里写入隐式标识（第五条）。
   *   默认开启。**生产环境关掉会阻止启动** —— 这是法定义务，
   *   不是可选的运营开关。
   * provider：隐式标识里的「服务提供者名称」，也是界面上显式标识
   *   展示的署名。要改成你的主体名称就在这里改。
   * explicitLabel：客户端交互界面上的显式标识文案（第四条）。
   *   服务端只负责下发给客户端，渲染由客户端做。
   */
  aigc: {
    metadata: flag('AIGC_METADATA', true),
    provider: read('AIGC_PROVIDER', '像素盒子'),
    explicitLabel: read('AIGC_EXPLICIT_LABEL', 'AI 生成')
  }
}

/** 启动自检：把「会导致线上事故但不会立刻报错」的配置挑出来 */
export function inspectConfig() {
  const problems = []
  const notices = []

  if (config.mockWechat && config.isProduction) {
    problems.push('MOCK_WECHAT=1 不能用于生产环境：任何人构造一个 code 就能登录任意账号')
  }
  if (config.mockLlm && config.isProduction) {
    problems.push('MOCK_LLM=1 不能用于生产环境：不会真正出图')
  }
  if (!config.wechat.appSecret && !config.mockWechat) {
    problems.push('缺少 WECHAT_APP_SECRET，无法调用 code2Session')
  }
  if (!config.wechat.appKey && !config.mockWechat) {
    problems.push('缺少 WECHAT_APP_KEY，无法计算虚拟支付签名')
  }
  if (!config.wechat.offerId && !config.mockWechat) {
    problems.push('缺少 WECHAT_OFFER_ID，无法下单')
  }
  if (!config.wechat.notifyUrl && !config.mockWechat) {
    problems.push(
      '缺少 WECHAT_PAY_NOTIFY_URL：发货推送与退款推送都收不到。' +
        '发货还有定时查单兜底，但退款没有兜底 —— 用户退了钱仍留着点数，是直接资损'
    )
  }
  if (!config.wechat.msgToken && !config.mockWechat) {
    problems.push(
      '缺少 WECHAT_MSG_TOKEN：MP 后台「消息推送」点保存时微信会发一个验签 GET ' +
        '到 /api/pay/notify，没有这个 Token 就答不上来，配置根本存不下去。' +
        '发货还有 5 分钟查单兜底，退款推送没有兜底 —— 配不上就是用户退了钱仍留着点数'
    )
  }
  if (!config.llm.apiKey && !config.mockLlm) {
    problems.push('缺少 LLM_API_KEY，图片生成会返回 503')
  }
  if (config.securityMode === 'off') {
    notices.push('SECURITY_MODE=off：内容安全审核已关闭，上线前必须改回 enforce')
  }
  // log 模式不拦截内容，只在日志里留痕。生产环境用它等于没有审核：
  // 一旦出现违规内容，是直接封小程序的风险，所以按 problem 处理而不是 notice。
  if (config.securityMode === 'log' && config.isProduction) {
    problems.push(
      'SECURITY_MODE=log 不能用于生产环境：内容审核只记录不拦截，' +
        '出现违规内容会导致小程序被下架。请改为 enforce'
    )
  }
  if (config.isProduction && !config.rateLimit.enabled) {
    problems.push('RATE_LIMIT_ENABLED=0 不能用于生产环境：接口无限制，模型额度会被刷爆')
  }
  if (config.testPayment.enabled) {
    if (!config.testPayment.productId || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(config.testPayment.productId)) {
      problems.push('TEST_PAYMENT_PRODUCT_ID 不合法：临时测试商品必须使用已在 MP 后台发布的道具 ID')
    }
    if (config.testPayment.openids.length === 0) {
      problems.push('TEST_PAYMENT_OPENIDS 为空：临时 1 元支付必须限制到明确的测试用户')
    }
    if (config.wechat.env !== 0) problems.push('TEST_PAYMENT_ENABLED 只支持正式环境 WECHAT_ENV=0')
    notices.push(`临时 1 元支付已开启，仅 ${config.testPayment.openids.length} 个测试用户可见；验收后必须关闭并删除 MP 道具`)
  }
  if (config.isProduction && config.host === '0.0.0.0' && !config.allowPublicBind) {
    problems.push(
      'HOST=0.0.0.0 在裸机上不能用于生产环境：服务直接暴露在公网，' +
        '攻击者伪造 X-Forwarded-For 即可绕过全部限流。' +
        '裸机请设为 127.0.0.1 并由 nginx 反代；' +
        '若用 Docker 且只在内网暴露（compose 里不写 ports，只写 expose），' +
        '请显式设置 ALLOW_PUBLIC_BIND=1 表示已知悉'
    )
  }
  if (config.initialBalance > 10 && config.isProduction) {
    // 张数按当前单价现算，不写死：单价一调，写死的数字立刻变成错的，
    // 而这条提示恰恰是用来判断「送得是不是太多了」的，算错就没意义了。
    const freeImages = config.imageCost > 0 ? Math.floor(config.initialBalance / config.imageCost) : '—'
    notices.push(
      `INITIAL_BALANCE=${config.initialBalance}：新用户白送的点数偏多，` +
        `按当前单价相当于白送约 ${freeImages} 张图，` +
        '确认这是有意的运营策略（每个新账号都会领到）'
    )
  }

  // 《人工智能生成合成内容标识办法》第五条是法定义务，不是运营开关。
  // 关掉它不会报错、不会有任何外部信号，只会让每一张出图都缺隐式标识——
  // 属于「没人发现就一直违规」的那类问题，所以按 problem 拦在启动阶段。
  if (!config.aigc.metadata && config.isProduction) {
    problems.push(
      'AIGC_METADATA=0 不能用于生产环境：《人工智能生成合成内容标识办法》' +
        '（2025-09-01 施行）第五条要求生成合成内容的文件元数据中必须含隐式标识。' +
        '确需提供无标识内容（第九条）时，应在用户协议中明确用户标识义务与使用责任，' +
        '并保留相关日志不少于六个月，而不是简单关掉这个开关'
    )
  }
  if (!config.aigc.provider.trim()) {
    problems.push('AIGC_PROVIDER 为空：隐式标识缺少「服务提供者名称」，第五条的三要素不完整')
  }

  // 单价配错是「静默资损」：0 等于白送，NaN 会把余额算成 NaN 且再也修不回来。
  // 两种都不会报错，只会一直悄悄跑下去，所以必须在启动阶段拦住。
  if (!Number.isFinite(config.imageCost) || config.imageCost <= 0) {
    const message =
      `IMAGE_COST=${config.imageCost} 不合法：必须是正数。` +
      '0 会导致出图完全免费，NaN 会把用户余额算成 NaN 且无法恢复'
    if (config.isProduction) problems.push(message)
    else notices.push(message)
  }

  // 宽限期配得比 systemd 的 TimeoutStopSec 还长时，systemd 会先 SIGKILL，
  // 应用自己那套「等完再落盘」根本没机会跑完——配了个看起来生效、实际无效的值
  // 比不配更糟：运维会以为自己已经排空了。
  if (Number.isFinite(config.shutdownGraceMs) && config.shutdownGraceMs > 15000) {
    notices.push(
      `SHUTDOWN_GRACE_MS=${config.shutdownGraceMs} 超过了 systemd 默认的 ` +
        'TimeoutStopSec=15s：systemd 会先 SIGKILL，这个值等于没生效。' +
        '要排空在飞请求，请同时调大 deploy/forme-server.service 里的 TimeoutStopSec'
    )
  }

  return { problems, notices }
}
