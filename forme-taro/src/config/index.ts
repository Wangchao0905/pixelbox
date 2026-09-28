/**
 * 全局配置
 * ------------------------------------------------------------------
 * 值来自环境变量，切环境不用改代码。
 *
 * Taro 在构建时读取这些文件（后者覆盖前者）：
 *   .env → .env.local → .env.{mode} → .env.{mode}.local
 * 只把 TARO_APP_ 前缀的变量注入客户端代码。
 *
 *   npm run dev:weapp   → mode=development → 读 .env.development
 *   npm run build:weapp → mode=production  → 读 .env.production
 *
 * 个人覆盖写 .env.development.local（已 gitignore）。
 * 别用 .env.local——它对 dev 和 prod 都生效，容易把 localhost 打进生产包。
 *
 * ⚠️ 必须写成 process.env.TARO_APP_XXX 这样的**静态成员访问**。
 * Taro 的注入靠 webpack DefinePlugin 做文本替换，只认字面量：
 *   process.env.TARO_APP_API_BASE   ✅ 会被替换成字符串字面量
 *   process.env[key]                ❌ 动态取值，替换不了，运行时是 undefined
 */

export const APP_CONFIG = {
  /**
   * 服务端 API 地址。必须是 HTTPS 且加入「request 合法域名」。
   *
   * 结尾斜杠会被去掉：拼接处是 `${apiBaseUrl}${path}`，而 path 以 `/` 开头，
   * 所以 `https://a.com/` + `/api/health` 会拼成 `https://a.com//api/health`。
   * 双斜杠在多数服务端能容忍，但 nginx 的 `location /api/` **匹配不到** `//api/`，
   * 表现为整站 404 —— 而配置里多一个斜杠太容易发生了（手输、从浏览器地址栏复制）。
   * 所以在读进来的地方就归一化，让这个错误不可能出现。
   */
  apiBaseUrl: (process.env.TARO_APP_API_BASE || 'https://YOUR_API_DOMAIN').replace(/\/+$/, ''),

  /**
   * 图片 CDN 域名。
   * 留空 = 直接使用原型里的 Unsplash 地址（开发者工具勾选「不校验合法域名」即可预览）。
   * 填上之后，所有远程封面会改成 `${mediaBase}/{文件名}`，便于整体切到自己的 CDN / 云存储。
   */
  mediaBase: process.env.TARO_APP_MEDIA_BASE || '',

  /**
   * 是否使用本地演示数据。
   * ------------------------------------------------------------------
   * true  = 完全不请求后端：生成返回本地演示图，余额用 DEMO_BALANCE，
   *         充值走本地模拟。用于零配置看 UI。
   * false = 真实调用后端（接口契约见 forme-server/API.md）。
   *
   * 判定规则**刻意做成不对称的**：
   *
   * - **生产构建（build:weapp，NODE_ENV=production）强制关闭。**
   *   设了 TARO_APP_USE_MOCK=1 也不认。理由：演示模式返回的是本地占位图，
   *   不是真出图——用户付了钱却拿到假结果，而且导出时会给设计稿里的
   *   **真实照片**贴上「AI 生成」标签，性质比漏标更糟。付费产品不能留
   *   「一个环境变量没加载就静默跑假数据」这种后门。
   * - **开发构建（dev:weapp）变量缺失时默认开启**，保证一个新克隆的工程
   *   不做任何配置也能跑起来；要连真后端就显式写 TARO_APP_USE_MOCK=0。
   *
   * NODE_ENV 同样由 DefinePlugin 静态替换，所以生产包里这个分支会被
   * 常量折叠成 `false`，不会残留任何运行时判断。
   */
  useMockGeneration:
    process.env.NODE_ENV !== 'production' && process.env.TARO_APP_USE_MOCK !== '0',

  /**
   * 品牌字体 CDN 目录，需包含 SpaceGrotesk-Medium.ttf 与 DMMono-Regular.ttf。
   * 留空 = 不加载，回落到系统字体（苹方 / 思源黑体）。
   * 注意：wx.loadFontFace 的域名同样需要加入「downloadFile 合法域名」。
   */
  brandFontBase: process.env.TARO_APP_FONT_BASE || '',

  /**
   * 每张图消耗点数。**仅用于演示模式的展示与本地模拟**。
   * 真实单价一律以服务端 /api/catalog 返回的 imageCost 为准，
   * 改价只改服务端 IMAGE_COST，客户端不用跟着发版。
   *
   * 当前定价：单张图 0.4 点，充值点数以套餐为准。
   * 是小数，所以消耗预估要按两位小数取整（见 costForImages）。
   */
  costPerImage: 0.4,

  /** 单次最多出图数。展示用，真实上限以服务端返回的 maxBatch 为准 */
  maxBatch: 4,

  /**
   * 生成类请求（出图 / 改图）的超时时间，毫秒。
   * ------------------------------------------------------------------
   * ⚠️ **必须严格大于服务端的 LLM_TIMEOUT_MS**，这是硬约束，不是调优。
   *
   * 服务端允许上游跑到 LLM_TIMEOUT_MS（默认 180 秒）才放弃。如果客户端
   * 比它先超时，就会出现最糟的那种情况：
   *
   *   用户在第 120 秒看到「生成失败」→ 但服务端还在跑 → 第 150 秒上游返回、
   *   扣费成功、图片进了资产库。用户以为钱白花了。
   *
   * 反过来的顺序（客户端等得比服务端久）永远是对的：服务端一定会先给出
   * 确定答复，客户端要么拿到图，要么拿到一个真正的错误。
   *
   * 另外注意小程序的默认超时：`app.json` 的 networkTimeout.request 默认
   * **60000**，接口级 timeout 可以覆盖它（这里就是覆盖）。别把默认值当成生效值。
   *
   * 改了服务端 LLM_TIMEOUT_MS 就要同步改这里 —— `npm run preflight` 会核对
   * （§9.4），不一致会阻断。
   */
  generationTimeoutMs: 200000,

  /**
   * AIGC 显式标识（《人工智能生成合成内容标识办法》第四条）。
   * ------------------------------------------------------------------
   * 这两个值**仅作为拿不到服务端目录时的兜底**。正常情况下一律以
   * /api/catalog 返回的 aigc.label / aigc.provider 为准——
   * 署名主体和文案口径属于合规信息，改了要能立刻全量生效，
   * 不能等小程序重新发版审核。
   */
  aigcLabel: 'AI 生成',
  aigcProvider: '像素盒子'
} as const

// 构建时打印一次，避免「改了 .env 没生效」这种排查半天的问题。
// NODE_ENV 会被 DefinePlugin 静态替换，生产包里整段会被摇掉。
if (process.env.NODE_ENV !== 'production') {
  console.log(
    `[forme] apiBaseUrl=${APP_CONFIG.apiBaseUrl} useMockGeneration=${APP_CONFIG.useMockGeneration}`
  )
}

export const STORAGE_KEYS = {
  token: 'forme-token',
  balance: 'forme-balance',
  history: 'forme-history-v1',
  draft: 'forme-draft-v1'
} as const
