/**
 * 上线前自检
 * ==================================================================
 * 用法：npm run preflight
 *
 * 这个脚本在**部署到服务器之后、对外宣布上线之前**跑。
 * 它和进程启动时的自检共用同一份 inspectConfig()，所以不会出现
 * 「这里过了那里没过」的分歧，额外再补几项只有部署阶段才看得出问题的检查。
 *
 * 设计成只读：不改任何文件、不起服务、不发请求。
 * 自检脚本本身不应该有副作用，否则没人敢在生产机上跑它。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config, inspectConfig, ROOT } from '../src/config.mjs'
import { inspectAlertConfig } from '../src/alert.mjs'
import { sellablePlans } from '../src/catalog.mjs'
import { DEFAULT_SIZE, MAX_EDGE, MIN_EDGE, inspectSize } from '../src/sizes.mjs'
import { inspectSecret } from '../src/secret-shape.mjs'
import {
  MEDIA_DIR,
  collectCoverRefs,
  dedupeByFileName,
  readClientEnv
} from '../deploy/cover-names.mjs'

const blockers = []
const warnings = []
const passed = []

function pass(label) {
  passed.push(label)
}
function block(label, hint) {
  blockers.push({ label, hint })
}
function warn(label, hint) {
  warnings.push({ label, hint })
}

/* ================================================================
   1. 运行时
   ================================================================ */

const major = Number(process.versions.node.split('.')[0])
if (major >= 20) pass(`Node 版本 ${process.versions.node}`)
else block(`Node 版本过低：${process.versions.node}`, '需要 >= 20，否则 fetch / AbortSignal.timeout 不可用')

// 运行环境走和启动自检**完全相同**的取值链（process.env → .env → .env.local）。
// 这里如果直接读 process.env.NODE_ENV，就会出现「preflight 说绿、真启动却拦不住」
// 的分歧 —— 而本文件开头的承诺正是「不会出现这里过了那里没过」。
if (config.isProduction) pass(`运行环境 ${config.nodeEnv}（生产拦截已启用）`)
else
  block(
    `运行环境是 ${config.nodeEnv}`,
    '必须让它解析成 production。注意 NODE_ENV 写在 .env / .env.local 里也是生效的，' +
      '不一定要放在命令行前面。启动自检只在 production 下拦截 MOCK_WECHAT=1 这类危险配置，' +
      '漏了它演示配置会被当成正式配置跑起来'
  )

/* ================================================================
   2. 进程启动自检（同一份逻辑）
   ================================================================ */

const { problems, notices } = inspectConfig()
for (const item of problems) block(item)
for (const item of notices) warn(item)

// 注意：inspectConfig 只在生产环境下才把 MOCK_WECHAT=1 之类报成 problem。
// 非生产环境下 problems 为空**不代表配置可用于上线**，
// 所以这里不能笼统地说「全部通过」——那会给出错误的安全感。
if (problems.length === 0) {
  if (config.isProduction) {
    pass('启动自检项全部通过（MOCK 已关 / enforce / 限流开 / 凭据齐全 / 绑定地址正确）')
  } else {
    warn(
      '启动自检未报问题',
      `但当前运行环境是 ${config.nodeEnv}，` +
        '非生产环境下 MOCK_WECHAT / SECURITY_MODE 等危险项不会被拦。' +
        '请让它解析成 production 后重跑，否则这一项等于没查'
    )
  }
}

/* ================================================================
   3. 密钥
   ================================================================ */

const secrets = [
  ['WECHAT_APP_SECRET', config.wechat.appSecret],
  ['WECHAT_APP_KEY', config.wechat.appKey],
  ['WECHAT_OFFER_ID', config.wechat.offerId],
  // 消息推送的 Token 也属于「多一个空格就验签不过」的一类值：
  // 症状是后台点保存报「配置失败」，而报错里不会说是哪个字符的问题。
  ['WECHAT_MSG_TOKEN', config.wechat.msgToken],
  ['LLM_API_KEY', config.llm.apiKey]
]

// 形态校验放在 src/secret-shape.mjs（纯函数），这样 smoke 能直接喂假值测它，
// 不需要覆盖这台机器上的真实密钥。规则和理由都写在那个文件里。
for (const [name, value] of secrets) {
  if (!value) continue // 缺项已由 inspectConfig 报过，这里只查「填了但填错」
  const verdict = inspectSecret(name, value)
  if (!verdict) pass(`${name} 已配置`)
  else if (verdict.level === 'block') block(verdict.message, verdict.hint)
  else warn(verdict.message, verdict.hint)
}

// AppID 与小程序后台必须一致，写错了 code2Session 会一直 40029
if (config.wechat.appId && !/^wx[0-9a-f]{16}$/i.test(config.wechat.appId)) {
  warn(`WECHAT_APPID 格式可疑：${config.wechat.appId}`, '正常形如 wx + 16 位十六进制')
} else if (config.wechat.appId) {
  pass('WECHAT_APPID 格式正确')
}

/* ================================================================
   4. 支付回调地址
   ================================================================ */

const notifyUrl = config.wechat.notifyUrl
if (notifyUrl) {
  const parsed = (() => {
    try {
      return new URL(notifyUrl)
    } catch {
      return null
    }
  })()

  if (!parsed) {
    block(`WECHAT_PAY_NOTIFY_URL 不是合法 URL：${notifyUrl}`)
  } else {
    if (parsed.protocol === 'https:') pass('回调地址是 HTTPS')
    else block(`回调地址不是 HTTPS：${parsed.protocol}`, '微信只接受 HTTPS 回调')

    // 漏掉 /api 是最常见的配置错误：平台会一直收到 404 并无限重试，
    // 表现是「用户付了钱但永远不到账」
    if (parsed.pathname === '/api/pay/notify') pass('回调路径正确（/api/pay/notify）')
    else
      block(
        `回调路径错误：${parsed.pathname}`,
        '必须是 /api/pay/notify。漏掉 /api 会导致平台一直收到 404 并无限重试，' +
          '用户付了钱但永远不到账'
      )

    if (parsed.hostname.endsWith('.example') || parsed.hostname === 'localhost') {
      block(`回调域名还是占位值：${parsed.hostname}`, '换成真实已备案域名')
    }
  }
}

/* ================================================================
   5. 上游地址
   ================================================================ */

if (config.llm.baseUrl) {
  try {
    const parsed = new URL(config.llm.baseUrl)
    if (parsed.protocol === 'https:') pass('图片上游是 HTTPS')
    else warn(`图片上游不是 HTTPS：${parsed.protocol}`, '密钥会以明文传输')
  } catch {
    block(`LLM_BASE_URL 不是合法 URL：${config.llm.baseUrl}`)
  }
}

if (config.llm.timeoutMs < 30000) {
  warn(
    `LLM_TIMEOUT_MS=${config.llm.timeoutMs} 偏小`,
    '出图通常要几十秒，超时太短会导致大量误判失败并回滚扣费'
  )
} else {
  pass(`上游超时 ${Math.round(config.llm.timeoutMs / 1000)} 秒`)
}

/* ================================================================
   6. 数据目录
   ================================================================ */

try {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true })
  }
  const probe = path.join(config.dataDir, `.preflight-${Date.now()}`)
  fs.writeFileSync(probe, 'ok')
  fs.unlinkSync(probe)
  pass(`数据目录可写：${config.dataDir}`)
} catch (error) {
  block(
    `数据目录不可写：${config.dataDir}`,
    `服务会把余额与订单写在这里，不可写等于无法发货。${error?.message ?? error}`
  )
}

// 生产环境请挂持久卷：容器重建或换机器时 data/ 丢了，
// 全部用户余额与已支付订单都会归零
if (config.isProduction) {
  const marker = path.join(config.dataDir, 'state.json')
  if (fs.existsSync(marker)) {
    try {
      const state = JSON.parse(fs.readFileSync(marker, 'utf8'))
      if (!state || typeof state !== 'object' || Array.isArray(state) ||
          !state.accounts || !state.orders || !state.holds) {
        throw new Error('缺少账户、订单或预扣结构')
      }
      pass('state.json 可读取且可解析')
    } catch (error) {
      block('state.json 无法正常读取', error?.message ?? String(error))
    }
  } else
    block(
      '数据目录里没有 state.json',
      '生产服务会拒绝空账户启动。首次部署先运行 npm run init:data；已有数据请恢复备份'
    )
}

/* ================================================================
   7. 告警
   ================================================================ */

const alertProblem = inspectAlertConfig()
if (alertProblem) warn(alertProblem, '当前选择暂不配置；退款缺口只会写服务器日志。配置后运行 test:alert -- --send 验证接收方')
else pass(`告警配置格式正确（${config.alert.format}；实际接收需运行 test:alert 验证）`)

if (config.testPayment.enabled && !config.testPayment.openids.length) {
  block('临时 1 元支付没有测试用户白名单', '填写 TEST_PAYMENT_OPENIDS 后再开启')
}

/* ================================================================
   8. 配置文件
   ================================================================ */

const envLocal = path.join(ROOT, '.env.local')
if (fs.existsSync(envLocal)) {
  pass('.env.local 存在')
  const mode = fs.statSync(envLocal).mode & 0o777
  if (mode & 0o077) {
    warn(
      `.env.local 权限是 ${mode.toString(8)}，同机器其他用户可读`,
      '里面全是密钥，建议 chmod 600 .env.local'
    )
  } else {
    pass('.env.local 权限正确（仅属主可读）')
  }
} else {
  warn(
    '没有 .env.local',
    '如果密钥是通过 systemd Environment= 或容器环境变量注入的，可以忽略这条。' +
      '但注意 unit 文件通常全局可读，把密钥写在那里等于公开'
  )
}

/* ================================================================
   9. 跨文件一致性
   ================================================================
   「后端配好了、小程序也配好了」之后，最容易出错的**不是某一侧配错，
   而是两侧不一致**：各自看都自洽，合起来跑不通，而且报错很难指向真正的原因
   （AppID 不一致表现为 code2Session 40029，域名不一致表现为真机上所有请求失败）。

   这些检查只读文件，不做任何修改。
   ================================================================ */

const TARO_ROOT = path.resolve(ROOT, '..', 'forme-taro')
const taroPresent = fs.existsSync(path.join(TARO_ROOT, 'project.config.json'))

if (!taroPresent) {
  pass('未找到 forme-taro 工程（服务端单独部署时属正常，跳过一致性检查）')
} else {
  /* ---------- 9.1 AppID 两侧必须一致 ---------- */

  try {
    const project = JSON.parse(fs.readFileSync(path.join(TARO_ROOT, 'project.config.json'), 'utf8'))
    const clientAppId = project.appid ?? ''
    if (!config.wechat.appId) {
      warn('无法比对 AppID', '服务端还没配 WECHAT_APPID')
    } else if (!clientAppId) {
      warn('小程序工程里没有 appid', `请在 ${TARO_ROOT}/project.config.json 填入 AppID`)
    } else if (clientAppId !== config.wechat.appId) {
      block(
        `AppID 两侧不一致：小程序=${clientAppId}，服务端=${config.wechat.appId}`,
        '必须是同一个小程序。不一致时 code2Session 会一直返回 40029，' +
          '表现为「所有用户都登录不了」，而且很容易被误判成网络问题'
      )
    } else {
      pass(`AppID 两侧一致（${clientAppId}）`)
    }
  } catch (error) {
    warn('读不到 project.config.json', `${error?.message ?? error}`)
  }

  /* ---------- 9.2 域名：客户端指向的地址必须能打到这台后端 ---------- */

  const clientEnvPath = path.join(TARO_ROOT, '.env.production')
  if (!fs.existsSync(clientEnvPath)) {
    warn('没有 forme-taro/.env.production', '生产构建会拿不到 API 地址')
  } else {
    const clientEnv = fs
      .readFileSync(clientEnvPath, 'utf8')
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith('TARO_APP_API_BASE='))
    const clientBase = clientEnv ? clientEnv.split('=').slice(1).join('=').trim() : ''

    if (!clientBase) {
      block('forme-taro/.env.production 里没有 TARO_APP_API_BASE', '生产包会请求不到后端')
    } else if (/YOUR_API_DOMAIN|example\.com|localhost|127\.0\.0\.1/i.test(clientBase)) {
      block(
        `小程序指向的地址还是占位/本机值：${clientBase}`,
        '这就是「小程序打不开、真机白屏」的头号原因。换成已备案的 HTTPS 域名后重新构建'
      )
    } else {
      let clientHost = ''
      let notifyHost = ''
      try {
        clientHost = new URL(clientBase).host
      } catch {
        block(`TARO_APP_API_BASE 不是合法 URL：${clientBase}`)
      }
      if (config.wechat.notifyUrl) {
        try {
          notifyHost = new URL(config.wechat.notifyUrl).host
        } catch {
          /* 已在第 4 节报过 */
        }
      }

      if (clientHost && notifyHost && clientHost === notifyHost) {
        pass(`小程序与回调地址同域（${clientHost}）`)
      } else if (clientHost && notifyHost) {
        // 不一定是错的（可以 api.a.com 打后端、pay.a.com 收回调），
        // 但**两个域名都必须加进后台白名单**，漏一个就在真机上失败
        warn(
          `小程序指向 ${clientHost}，回调地址是 ${notifyHost}`,
          '两者不同域是允许的，但要确认**两个域名都已加进**小程序后台的' +
            ' request / uploadFile / downloadFile 合法域名，漏一个就在真机上失败'
        )
      } else if (clientHost) {
        pass(`小程序指向 ${clientHost}`)
      }
    }
  }

  /* ---------- 9.2b 封面图：收口了吗（离线可判，不发请求） ---------- */

  /**
   * 为什么这里必须有这一项：
   *
   * 这个脚本最后会打印「✅ 自检通过」。如果封面图这条路是断的，那句
   * 「通过」就是在骗人 —— 真机上每张样式卡封面都是空白，而自检全绿。
   * 那正是这个项目最怕的一类失败：**看起来一切正常**。
   *
   * 这里只做**离线**判断（本脚本承诺不发请求），回答「有没有人管过这件事」；
   * 「服务器上真的能出图吗」由 `npm run check:media` 联网回答。
   */
  const mediaBase = readClientEnv('TARO_APP_MEDIA_BASE').replace(/\/+$/, '')

  // verify-dist.mjs 里那个显式白名单：非空 = 路线②是**刻意选的**，不是没人管
  let allowlistedHosts = []
  try {
    const code = fs.readFileSync(path.join(TARO_ROOT, 'scripts', 'verify-dist.mjs'), 'utf8')
    const matched = code.match(/ALLOWLISTED_MEDIA_HOSTS\s*=\s*\[([^\]]*)\]/)
    if (matched) {
      allowlistedHosts = [...matched[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) =>
        m[1].toLowerCase()
      )
    }
  } catch {
    /* 拿不到就当没配 —— 下面会按「没人管」处理，是更安全的默认 */
  }

  if (mediaBase) {
    // ⚠️ 提示写在 pass 行里，**不能**另开一条 warn。
    //    warn 的语义是「还没做的事」—— 而这条提示在 mediaBase 配好之后
    //    永远成立、永远清不掉。清不掉的告警就是噪音，噪音多了真问题被淹没
    //    （`verify-dist.mjs` 里已经为同一件事写过一次教训）。
    pass(
      `封面图已收口到 ${mediaBase}` +
        '（上线前用 `npm run check:media` 确认线上真的有文件 —— 这里只是静态判断）'
    )
  } else if (allowlistedHosts.length) {
    pass(`封面图走外部图床白名单：${allowlistedHosts.join('、')}`)
  } else {
    warn(
      '封面图既没收口到自有域名，也没登记外部图床白名单',
      '产物里的封面仍指向外部图床。真机上「downloadFile 合法域名」没配时' +
        '**封面全是空白**，而开发者工具勾着「不校验合法域名」照样正常显示 —— ' +
        '很容易被当成样式 bug 查半天。\n' +
        '      两条路选一条（见 DEPLOY.md 9.2）：\n' +
        '        ① npm run fetch:covers → 确认 nginx /media/ 生效 → npm run check:media → ' +
        '再配 TARO_APP_MEDIA_BASE（推荐，注意顺序）\n' +
        '        ② 把域名加进后台白名单，并填进 verify-dist.mjs 的 ALLOWLISTED_MEDIA_HOSTS'
    )
  }

  // 本地素材齐不齐：引用数 ≠ 文件数（同一张照片多处引用共用一个文件）
  try {
    const refs = collectCoverRefs()
    const expected = [...dedupeByFileName(refs).keys()]
    const have = fs.existsSync(MEDIA_DIR) ? fs.readdirSync(MEDIA_DIR) : []
    const missing = expected.filter((name) => !have.includes(name))
    if (!expected.length) {
      /* 源码里已经没有 media('https://…') 了 —— 收口完成后的正常状态 */
    } else if (!have.length) {
      warn(
        `deploy/media/ 是空的（源码里还有 ${expected.length} 个远程封面引用）`,
        '还没跑过 `npm run fetch:covers`。走路线①的话需要先下载'
      )
    } else if (missing.length) {
      warn(
        `deploy/media/ 缺 ${missing.length}/${expected.length} 个封面文件`,
        `缺的：${missing.slice(0, 3).join('、')}${missing.length > 3 ? ' …' : ''}\n` +
          '      这些卡片在真机上会**空白**。重跑 `npm run fetch:covers`；' +
          '如果某个文件名一直在缺，说明图床那张图已被删除（脚本会报出来）'
      )
    } else {
      pass(
        `本地封面素材齐全（${expected.length} 个文件，覆盖源码 ${refs.length} 处引用）`
      )
    }
  } catch {
    /* 客户端源码读不到就算了，不是这个脚本的职责 */
  }

  /* ---------- 9.3 客户端兜底单价不能和服务端漂移 ---------- */

  const clientConfigPath = path.join(TARO_ROOT, 'src', 'config', 'index.ts')
  if (fs.existsSync(clientConfigPath)) {
    const matched = /costPerImage:\s*([0-9.]+)/.exec(fs.readFileSync(clientConfigPath, 'utf8'))
    if (matched) {
      const clientCost = Number(matched[1])
      if (clientCost !== config.imageCost) {
        warn(
          `兜底单价漂移：客户端 ${clientCost}，服务端 ${config.imageCost}`,
          '正常联网时以服务端 /api/catalog 为准，看不出问题；' +
            '但断网降级时客户端会用这个兜底值展示价格，用户会看到错的单价'
        )
      } else {
        pass(`兜底单价与服务端一致（${config.imageCost}）`)
      }
    }

    /* ---------- 9.4 客户端超时必须比服务端宽，否则会「扣了钱却报失败」 ---------- */

    /**
     * 服务端允许上游跑到 LLM_TIMEOUT_MS（默认 180 秒）才放弃。
     * 如果客户端先超时，用户会看到「生成失败」，而服务端继续跑完、扣费成功、
     * 图片进了资产库 —— 用户以为钱白花了。
     *
     * 客户端等得比服务端久则永远是对的：服务端一定先给出确定答复。
     * 所以这是一个**硬约束**，不是调优建议，超了就阻断。
     */
    const timeoutMatched = /generationTimeoutMs:\s*(\d+)/.exec(
      fs.readFileSync(clientConfigPath, 'utf8')
    )
    if (!timeoutMatched) {
      warn(
        '客户端没有 generationTimeoutMs',
        '生成请求会退回小程序的默认超时（app.json 的 networkTimeout.request，' +
          '框架默认 60000）。服务端允许跑 180 秒，客户端 60 秒就放弃 —— ' +
          '用户看到失败但点数已被扣。在 src/config/index.ts 里补上这个值'
      )
    } else {
      const clientTimeout = Number(timeoutMatched[1])
      if (clientTimeout <= config.llm.timeoutMs) {
        block(
          `客户端生成超时 ${clientTimeout}ms 不大于服务端上游超时 ${config.llm.timeoutMs}ms`,
          '会出现「用户看到生成失败，但点数已被扣、图片其实已生成」。' +
            `把客户端的 generationTimeoutMs 调到大于 ${config.llm.timeoutMs}（建议留 20 秒余量），` +
            '同时确认 app.config.ts 的 networkTimeout.request 不低于它'
        )
      } else {
        pass(
          `客户端生成超时 ${Math.round(clientTimeout / 1000)}s 宽于服务端 ${Math.round(
            config.llm.timeoutMs / 1000
          )}s（服务端总能先给出答复）`
        )
      }
    }
  }

  /* ---------- 9.5 出图尺寸：客户端算出来的值，服务端必须真的接受 ---------- */

  /**
   * `size` 是客户端**算出来的**：用户选的是「比例」，客户端用 ratioToSize
   * 映射成尺寸再发过来；服务端在 `src/sizes.mjs` 里判形状和边界
   * （在扣费之前，非法就是 400 invalid_size）。
   *
   * 这条检查用的是**服务端那个同一个函数** `inspectSize` —— 不是另抄一份
   * 「允许的尺寸清单」。抄一份就会有两个真相，而判据必须和被守护的东西同源。
   *
   * ⚠️ 判据要能区分「两边不一样」和「两边都没读到」：后者在字符串比较里
   *    和前者长得一样（都得到空）。所以先断言抽到了条目，再逐条判。
   */
  const clientCatalogPath = path.join(TARO_ROOT, 'src', 'data', 'catalog.ts')
  if (fs.existsSync(clientCatalogPath)) {
    /**
     * ⚠️ 取值这里用 `[^'"]+` 而不是 `\d+x\d+`。
     *    抽得比校验器窄，就会出现「表里有个怪值 → 抽不出来 → 静默跳过 → 报通过」——
     *    校验器 (`inspectSize`) 本来就接受 `1024 x 1536` 这种带空格的写法，
     *    抽取必须比它宽，让**所有**值都过一遍判定，而不是只过「长得像尺寸的」。
     */
    const pairs = [
      ...fs
        .readFileSync(clientCatalogPath, 'utf8')
        .matchAll(/['"](\d+:\d+)['"]\s*:\s*['"]([^'"]+)['"]/g)
    ].map((matched) => ({ ratio: matched[1], size: matched[2] }))

    if (!pairs.length) {
      block(
        '读不到客户端的比例→尺寸映射表',
        `期望在 ${clientCatalogPath} 里找到形如 '1:1': '1024x1024' 的条目，实际一条都没有。` +
          '要么它被改名/挪走了，要么写法变了 —— 这条检查现在是瞎的，别把它当成通过'
      )
    } else {
      const rejected = pairs
        .map((item) => ({ ...item, verdict: inspectSize(item.size) }))
        .filter((item) => !item.verdict.ok)

      const defaultVerdict = inspectSize(DEFAULT_SIZE)

      if (rejected.length) {
        block(
          `客户端会算出服务端不接受的尺寸：${rejected
            .map((item) => `${item.ratio}→${item.size}`)
            .join('、')}`,
          '用户选了这些比例后，请求会在扣费前被 400 invalid_size 拒掉。\n' +
            `      服务端的判定：${rejected[0].verdict.reason}\n` +
            '      要么改 forme-taro/src/data/catalog.ts 的映射，' +
            '要么放宽 forme-server/src/sizes.mjs 的边界'
        )
      } else if (!defaultVerdict.ok) {
        // 缺省尺寸自己都不合法 —— 客户端不带 size 时会直接 400
        block(`缺省尺寸 ${DEFAULT_SIZE} 自己就不合法`, defaultVerdict.reason)
      } else {
        pass(
          `出图尺寸契约一致（客户端 ${pairs.length} 个比例算出的尺寸，` +
            `服务端全部接受；单边 ${MIN_EDGE}–${MAX_EDGE}）`
        )
      }
    }
  }
}

/* ================================================================
   10. 道具对照表（照着核 MP 后台）
   ================================================================
   四个道具必须和 MP 后台【虚拟支付 → 道具管理】里创建的**完全一致**：
   productId 对不上会支付失败，goodsPrice 对不上平台会拒绝。
   这两个字段都没法从代码里查到后台，所以只能把代码侧的期望值打出来，
   让人花十秒钟对着后台核一遍。
   ================================================================ */

const plans = sellablePlans()
const seenIds = new Set()
let planProblem = 0

for (const plan of plans) {
  if (!plan.productId) {
    block(`${plan.planId} 没有 productId`, '无法下单')
    planProblem += 1
    continue
  }
  if (seenIds.has(plan.productId)) {
    block(`productId 重复：${plan.productId}`, '后台道具 ID 必须唯一')
    planProblem += 1
  }
  seenIds.add(plan.productId)

  if (!Number.isInteger(plan.priceFen) || plan.priceFen <= 0) {
    block(`${plan.planId} 的价格不是正整数分：${plan.priceFen}`, '虚拟支付金额单位是「分」')
    planProblem += 1
  }
}

if (!planProblem) {
  pass(`4 个道具的 productId 与价格格式正确（共 ${plans.length} 个）`)
}

/* ================================================================
   输出
   ================================================================ */

console.log('\n上线前自检')
console.log('─'.repeat(56))

for (const label of passed) console.log(`  ✓ ${label}`)

if (warnings.length) {
  console.log('')
  for (const item of warnings) {
    console.log(`  ⚠️  ${item.label}`)
    if (item.hint) console.log(`      ${item.hint}`)
  }
}

if (blockers.length) {
  console.log('')
  for (const item of blockers) {
    console.log(`  ❌ ${item.label}`)
    if (item.hint) console.log(`      ${item.hint}`)
  }
}

console.log('─'.repeat(56))
console.log(`  ${passed.length} 项通过 · ${warnings.length} 项警告 · ${blockers.length} 项阻断`)

// 道具对照表：后台配的那一步代码查不到，只能人眼核。
// 放在这里是因为跑 preflight 的人正好在准备上线，顺手就能核完。
console.log('\nMP 后台道具对照表（【虚拟支付 → 道具管理】，productId 与价格必须完全一致）')
console.log('─'.repeat(56))
for (const plan of plans) {
  const yuan = (plan.priceFen / 100).toFixed(2).replace(/\.00$/, '')
  const extra = plan.durationDays > 0 ? ` · ${plan.durationDays} 天权益` : ''
  console.log(`  ${plan.productId.padEnd(24)} ¥${yuan.padStart(6)}  ${plan.points} 点${extra}`)
}
console.log('─'.repeat(56))
console.log('  productId 对不上 → 支付失败；价格对不上 → 平台拒绝支付。两者都不会资损。')

// 消息推送对照表。和道具表同理：后台那几项代码查不到，但选错了推送永远处理不了，
// 而且**不会报错** —— 只会一直重试到天亮，日志里还看不出原因。
const pushHost = (() => {
  try {
    return new URL(config.wechat.notifyUrl).host
  } catch {
    return '你的域名'
  }
})()
console.log('\nMP 后台消息推送对照表（【开发与服务 → 开发管理 → 消息推送】）')
console.log('─'.repeat(56))
console.log(`  URL             https://${pushHost}/api/pay/notify`)
console.log(
  `  Token           ${config.wechat.msgToken ? '已配置（后台填同样的值，逐字一致）' : '（未配置，见上面的阻断项）'}`
)
console.log('  数据格式         XML        ← 选 JSON 会让所有推送解析失败')
console.log('  消息加解密方式    明文模式    ← 选安全模式本服务不做解密')
console.log('─'.repeat(56))
console.log('  点「提交」时微信会发一个验证请求，服务端要原样返回 echostr，否则存不下去。')

if (blockers.length) {
  console.error('\n❌ 自检未通过，不要上线。修掉上面的「阻断」项后重跑。\n')
  process.exit(1)
}

console.log('\n✅ 自检通过。')
console.log('   下一步：启动服务，然后按 DEPLOY.md 第 5 节验证回调连通性。\n')
