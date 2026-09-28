/**
 * 端到端冒烟测试
 * ------------------------------------------------------------------
 * 自己拉起一个隔离实例（独立端口 + 临时数据目录），跑完全流程后清理。
 * 不依赖任何测试框架：断言失败就抛，第一个失败点就是排查入口。
 *
 *   node scripts/smoke.mjs
 *
 * 覆盖：登录 → 余额 → 上传 → 生成 → 扣费 → 幂等 → 资产 → 下单
 *       → 模拟发货推送 → 幂等复测 → 查单 → 越权/参数校验
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { config } from '../src/config.mjs'
import { assertTransparentPng, createPlaceholderPng, crc32 } from '../src/png.mjs'
import { readImplicitLabel } from '../src/aigc.mjs'
import { inspectSecret } from '../src/secret-shape.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 固定值，方便断言签名
const APP_KEY = 'smoke_app_key'
const OFFER_ID = '1234567890'
const CODE = 'smoke-code-001'
const MSG_TOKEN = 'smoke_msg_token'

function signedNotifyUrl() {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = crypto.randomBytes(8).toString('hex')
  const signature = crypto.createHash('sha1').update([MSG_TOKEN, timestamp, nonce].sort().join('')).digest('hex')
  return `/api/pay/notify?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`
}

let BASE = ''
let main = null
let budget = null
let wallet = null
let rate = null
let fresh = null

/* ================================================================
   断言
   ================================================================ */

let passed = 0
const failures = []

function ok(condition, label, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

function section(title) {
  console.log(`\n${title}`)
}

/**
 * 逐块校验 PNG 结构（长度、CRC、IEND 收尾）。
 * 只验证「能不能读出来」是不够的：CRC 写错的文件本地读取器可能容忍，
 * 但用户手机的相册、微信的图片组件不一定会容忍，所以这里复算每个块的 CRC。
 */
function validatePngStructure(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(signature)) return '签名不是 PNG'

  let offset = 8
  const types = []
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const typeAndData = buffer.subarray(offset + 4, offset + 8 + length)
    const stored = buffer.readUInt32BE(offset + 8 + length)
    if (crc32(typeAndData) !== stored) {
      return `块 ${typeAndData.subarray(0, 4).toString('ascii')} 的 CRC 不匹配`
    }
    types.push(typeAndData.subarray(0, 4).toString('ascii'))
    offset += 12 + length
  }
  if (offset !== buffer.length) return `尾部有 ${buffer.length - offset} 字节多余数据`
  if (types[0] !== 'IHDR') return `首块是 ${types[0]}，应为 IHDR`
  if (types[types.length - 1] !== 'IEND') return '缺少 IEND 收尾'
  return null
}

/* ================================================================
   HTTP 客户端
   ================================================================ */

let token = ''

async function api(method, url, { body, raw, headers = {}, auth = true } = {}) {
  const finalHeaders = { ...headers }
  if (auth && token) finalHeaders.Authorization = `Bearer ${token}`

  let payload = raw
  if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  const response = await fetch(`${BASE}${url}`, { method, headers: finalHeaders, body: payload })
  const text = await response.text()

  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* 非 JSON（XML / 二进制）留给调用方看 text */
  }

  return { status: response.status, headers: response.headers, json, text }
}

/* ================================================================
   服务实例管理
   ================================================================ */

const instances = []

/**
 * 拉起一个隔离实例。每个实例有独立端口和独立数据目录，
 * 互不干扰，退出时统一清理。
 */
function startServer({ port, env = {} }) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `forme-smoke-${port}-`))
  const child = spawn(process.execPath, ['src/index.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      // 显式声明「这是测试环境」。不能靠「碰巧没设置」：
      // NODE_ENV 现在也会从 .env / .env.local 里读（否则写在那里的
      // NODE_ENV=production 不会生效，生产拦截会被静默绕过）。
      // 如果哪天本机存在一个生产用的 .env.local，下面的 MOCK_WECHAT=1
      // 就会变成「生产环境开 mock」而被拦，服务根本起不来。
      NODE_ENV: 'test',
      PORT: String(port),
      DATA_DIR: dataDir,
      MOCK_WECHAT: '1',
      MOCK_LLM: '1',
      SECURITY_MODE: 'off',
      WECHAT_APP_KEY: APP_KEY,
      WECHAT_OFFER_ID: OFFER_ID,
      WECHAT_APP_SECRET: 'smoke_secret',
      WECHAT_APPID: 'wxsmoke0000000000',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const logs = []
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()))
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()))

  const instance = { child, logs, dataDir, port, base: `http://127.0.0.1:${port}` }
  instances.push(instance)
  return instance
}

async function waitForHealth(base, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health`)
      if (response.ok) return await response.json()
    } catch {
      /* 还没起来，继续等 */
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`${base} 在 ${timeoutMs / 1000} 秒内没有就绪`)
}

function readState(dataDir) {
  const file = path.join(dataDir, 'state.json')
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

async function shutdownAll() {
  for (const instance of instances) {
    instance.child.kill('SIGTERM')
  }
  // 给优雅退出（落盘）留时间，否则读到的 state.json 可能落后
  await new Promise((resolve) => setTimeout(resolve, 600))
  for (const instance of instances) {
    if (!instance.child.killed) instance.child.kill('SIGKILL')
    try {
      fs.rmSync(instance.dataDir, { recursive: true, force: true })
    } catch {
      console.warn(`临时目录未清理：${instance.dataDir}`)
    }
  }
}

/* ================================================================
   用例
   ================================================================ */

async function run() {
  /* ---------- 1. 健康检查 ---------- */
  section('1. 健康检查')
  const health = await api('GET', '/api/health', { auth: false })
  eq(health.status, 200, 'GET /api/health 返回 200')
  eq(health.json.ok, true, '自检通过')
  eq(health.json.problems.length, 0, '没有配置问题')
  // 上线后最常要确认的三条策略，健康检查必须能直接看到
  eq(health.json.imageCost, 0.4, '健康检查暴露当前单价')
  eq(health.json.initialBalance, 128, '健康检查暴露初始余额（本实例显式设 128）')
  eq(health.json.rateLimitEnabled, true, '健康检查暴露限流开关')

  /* ---------- 2. 登录 ---------- */
  section('2. 登录与账户')
  const login = await api('POST', '/api/login', { body: { code: CODE }, auth: false })
  eq(login.status, 200, 'POST /api/login 返回 200')
  ok(Boolean(login.json.token), '签发了登录态 token')
  eq(login.json.user.isNew, true, '首次登录标记为新用户')
  eq(login.json.expiresIn > 0, true, '返回了有效期')
  token = login.json.token

  const profile = await api('GET', '/api/profile')
  eq(profile.status, 200, 'GET /api/profile 返回 200')
  eq(profile.json.balance, 128, '新用户初始余额 128 点')
  eq(profile.json.imageCost, 0.4, '单张图 0.4 点')

  // 同一个 code 再登录一次：必须是同一个账号，不能变成新用户
  const relogin = await api('POST', '/api/login', { body: { code: CODE }, auth: false })
  eq(relogin.json.user.isNew, false, '同一 code 重复登录不产生新用户')
  eq(relogin.json.user.id, login.json.user.id, '重复登录落到同一个 userId')

  const noAuth = await api('GET', '/api/account', { auth: false })
  eq(noAuth.status, 401, '未带 token 访问受保护接口返回 401')

  const badToken = await api('GET', '/api/account', { headers: { Authorization: 'Bearer nope' }, auth: false })
  eq(badToken.status, 401, '伪造 token 返回 401')

  /* ---------- 3. 目录 ---------- */
  section('3. 商品目录')
  const catalog = await api('GET', '/api/catalog', { auth: false })
  eq(catalog.status, 200, 'GET /api/catalog 返回 200')
  eq(catalog.json.plans.length, 5, '上架 2 个有效期道具 + 3 个点数档')
  eq(catalog.json.passDays, 30, '有效期道具标准时长 30 天')
  eq(catalog.json.maxBatch, 4, '单次最多 4 张')

  const passPlans = catalog.json.plans.filter((plan) => plan.kind === 'pass')
  const pointPlans = catalog.json.plans.filter((plan) => plan.kind === 'points')
  eq(passPlans.length, 2, '2 个有效期道具')
  eq(pointPlans.length, 3, '3 个点数档')
  ok(
    passPlans.every((plan) => plan.durationDays === 30),
    '每个有效期道具都带 30 天时长'
  )
  ok(
    pointPlans.every((plan) => plan.durationDays === 0),
    '点数档不带时长'
  )
  ok(
    catalog.json.plans.every((plan) => Number.isInteger(plan.priceFen) && plan.priceFen > 0),
    '价格都是正整数「分」（虚拟支付金额单位就是分）'
  )
  ok(
    catalog.json.plans.every((plan) => Boolean(plan.productId)),
    '每档都有 productId（必须与 MP 后台道具一致）'
  )
  // 「约 N 张图片」必须按 imageCost 现算，不能是写死的常量。
  // 这里用响应里的 imageCost 反推，任何写死张数的实现都会在这里失败。
  const catalogCost = catalog.json.imageCost
  eq(catalogCost, 0.4, '目录里带上当前单价')
  ok(
    catalog.json.plans.every((plan) =>
      plan.note.includes(`约 ${Math.floor(plan.points / catalogCost)} 张图片`)
    ),
    '每档的「约 N 张图片」都与 imageCost 一致（不是写死的）'
  )

  /* ---------- 4. 上传 ---------- */
  section('4. 素材上传')
  const png = createPlaceholderPng({ width: 320, height: 400, hue: 120, seed: 3 })

  const form = new FormData()
  form.append('file', new Blob([png], { type: 'image/png' }), 'source.png')
  const uploadResponse = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  })
  const upload = await uploadResponse.json()
  eq(uploadResponse.status, 200, 'POST /api/upload 返回 200')
  ok(Boolean(upload.fileId), '返回了 fileId')
  eq(upload.size, png.length, '记录的文件大小与上传一致')
  eq(upload.mime, 'image/png', '识别为 image/png')

  const fetched = await fetch(`${BASE}${new URL(upload.url).pathname}`)
  const fetchedBuffer = Buffer.from(await fetched.arrayBuffer())
  eq(fetched.status, 200, 'GET /api/files/:fileId 返回 200')
  eq(fetched.headers.get('content-type'), 'image/png', '响应 Content-Type 正确')
  eq(fetchedBuffer.length, png.length, '回读的字节数与上传一致')
  eq(
    fetchedBuffer.subarray(0, 8).toString('hex'),
    '89504e470d0a1a0a',
    '回读内容是合法 PNG（magic 正确）'
  )

  const missingFile = await api('GET', '/api/files/f_not_exist', { auth: false })
  eq(missingFile.status, 404, '读取不存在的文件返回 404')

  /* ---------- 5. 生成与扣费 ---------- */
  section('5. 生成与扣费')
  const requestId = crypto.randomUUID()
  const gen = await api('POST', '/api/generate-image', {
    body: {
      prompt: '深色背景上的极简产品海报，lime 色高光',
      size: '512x640',
      n: 2,
      requestId,
      asset: { title: '冒烟测试海报', skill: 'poster', templateId: 'editorial-dark' }
    }
  })
  eq(gen.status, 200, 'POST /api/generate-image 返回 200')
  eq(gen.json.images.length, 2, '返回 2 张图')
  eq(gen.json.charged, 0.8, '扣费 2 × 0.4 = 0.8 点')
  eq(gen.json.balance, 127.2, '余额 128 - 0.8 = 127.2')

  const firstImage = await fetch(`${BASE}${new URL(gen.json.images[0].url).pathname}`)
  const firstBuffer = Buffer.from(await firstImage.arrayBuffer())
  eq(firstImage.status, 200, '生成结果可直接访问')
  eq(
    firstBuffer.subarray(0, 8).toString('hex'),
    '89504e470d0a1a0a',
    '生成结果是合法 PNG'
  )

  /* ---------- 5b. AIGC 隐式标识 ---------- */
  section('5b. AIGC 隐式标识（《标识办法》第五条）')
  // 这条是法定义务，而且缺口不可见：不加标识不会报错、接口照常返回 200，
  // 只会在监管检查时暴露。所以必须验证「文件里真的有」，而不是「函数被调用过」。
  const aigcLabel = readImplicitLabel(firstBuffer, 'image/png')
  ok(Boolean(aigcLabel), '生成的图片文件里能读到隐式标识', `实际读到 ${aigcLabel}`)
  ok(aigcLabel?.includes('AIGC=1'), '含「生成合成内容属性信息」')
  ok(
    aigcLabel?.includes(`ContentId=${gen.json.images[0].fileId}`),
    '含「内容编号」且与 fileId 对应'
  )
  ok(aigcLabel?.includes('Provider='), '含「服务提供者名称」')
  // 默认 AIGC_PROVIDER=Pixel Box，冒烟不覆盖它；这里同时验证中文没被写坏
  ok(aigcLabel?.includes('Provider=Pixel Box'), '服务提供者名称正确且中文未乱码')
  eq(validatePngStructure(firstBuffer), null, '加标识后 PNG 结构仍合法（逐块 CRC 通过）')
  // 标识必须插在文件头部，不能简单追加到末尾
  eq(firstBuffer.subarray(37, 41).toString('ascii'), 'iTXt', '标识块紧跟 IHDR，位于文件头部')

  // 用户上传的素材是用户自己的内容，不该被标成生成合成内容
  ok(readImplicitLabel(fetchedBuffer, 'image/png') === null, '用户上传的素材不带 AIGC 标识')

  const aigcSecond = await fetch(`${BASE}${new URL(gen.json.images[1].url).pathname}`)
  const aigcSecondBuffer = Buffer.from(await aigcSecond.arrayBuffer())
  ok(Boolean(readImplicitLabel(aigcSecondBuffer, 'image/png')), '同一批的第 2 张也带标识')

  /* ---------- 6. 幂等 ---------- */
  section('6. 幂等复测')
  const genAgain = await api('POST', '/api/generate-image', {
    body: { prompt: '深色背景上的极简产品海报，lime 色高光', size: '512x640', n: 2, requestId }
  })
  eq(genAgain.status, 200, '相同 requestId 重放返回 200')
  eq(genAgain.json.idempotent, true, '标记为幂等命中')
  eq(genAgain.json.balance, 127.2, '重放不再扣费，余额不变')

  const balanceAfterReplay = await api('GET', '/api/account')
  eq(balanceAfterReplay.json.balance, 127.2, '账户余额确认未被二次扣减')

  /* ---------- 7. 参数校验 ---------- */
  section('7. 参数校验')
  const noPrompt = await api('POST', '/api/generate-image', { body: { n: 1 } })
  eq(noPrompt.status, 400, '缺提示词返回 400')
  eq(noPrompt.json.code, 'missing_prompt', '错误码为 missing_prompt')

  const editNoImage = await api('POST', '/api/edit-image', { body: { prompt: '把产品放进厨房场景' } })
  eq(editNoImage.status, 400, '产品替换缺素材返回 400')
  eq(editNoImage.json.code, 'missing_source_image', '错误码为 missing_source_image')

  const oversizeBatch = await api('POST', '/api/generate-image', {
    body: { prompt: '测试批量上限', n: 99, requestId: crypto.randomUUID() }
  })
  eq(oversizeBatch.status, 200, '批量超限被静默收敛而非报错')
  eq(oversizeBatch.json.batch, 4, '批量收敛到 maxBatch=4')
  eq(oversizeBatch.json.charged, 1.6, '按收敛后的 4 张收费（4 × 0.4）')

  // 尺寸：形状不对 / 越界都必须在**预扣之前**被拒。
  // 关键断言不是「返回 400」，而是「一分钱都没扣」—— 判定放错位置时
  // 400 照样返回，只是钱已经预扣进去了（或走了一遍 reserve/release）。
  const balanceBeforeBadSize = (await api('GET', '/api/account')).json.balance

  const ratioAsSize = await api('POST', '/api/generate-image', {
    body: { prompt: '尺寸形状校验', size: '1:1', requestId: crypto.randomUUID() }
  })
  eq(ratioAsSize.status, 400, '把比例当尺寸发（1:1）返回 400')
  eq(ratioAsSize.json.code, 'invalid_size', '错误码为 invalid_size')

  const hugeSize = await api('POST', '/api/generate-image', {
    body: { prompt: '尺寸越界校验', size: '99999x99999', requestId: crypto.randomUUID() }
  })
  eq(hugeSize.status, 400, '超大尺寸返回 400')
  eq(hugeSize.json.code, 'invalid_size', '错误码为 invalid_size')

  const tinySize = await api('POST', '/api/generate-image', {
    body: { prompt: '尺寸下限校验', size: '32x32', requestId: crypto.randomUUID() }
  })
  eq(tinySize.status, 400, '过小尺寸（32x32）返回 400')
  eq(tinySize.json.code, 'invalid_size', '错误码为 invalid_size')

  const balanceAfterBadSize = (await api('GET', '/api/account')).json.balance
  eq(balanceAfterBadSize, balanceBeforeBadSize, '被拒的请求一分钱都没扣（判定在预扣之前）')

  // 对照组「形状合法但不是产品档位的尺寸仍要能出图」不在这里 ——
  // 第 5 / 6 节的 `512x640` 就是它，而且更强（跑完了整条出图链路）。
  // 这里**不能**再补一次成功出图：本套件后面几十条断言都按绝对余额串起来的，
  // 多扣 0.4 会让第 8 节起的余额链全部错位。

  /* ---------- 8. 编辑 ---------- */
  section('8. 产品替换')
  const edit = await api('POST', '/api/edit-image', {
    body: {
      prompt: '把产品放进北欧风格厨房，自然光，浅景深',
      size: '512x640',
      n: 1,
      fileIds: [upload.fileId],
      requestId: crypto.randomUUID()
    }
  })
  eq(edit.status, 200, 'POST /api/edit-image 返回 200')
  eq(edit.json.images.length, 1, '返回 1 张图')
  eq(edit.json.charged, 0.4, '扣费 0.4 点（1 张）')
  eq(edit.json.balance, 125.2, '余额 128 - 0.8 - 1.6 - 0.4 = 125.2')

  /* ---------- 9. 资产库 ---------- */
  section('9. 资产库')
  const assets = await api('GET', '/api/assets')
  eq(assets.status, 200, 'GET /api/assets 返回 200')
  eq(assets.json.assets.length, 1, '只有带 title 的生成会入库（幂等重放不计）')
  eq(assets.json.assets[0].title, '冒烟测试海报', '资产标题正确')
  eq(assets.json.assets[0].images.length, 2, '资产关联了 2 张图')

  const assetId = assets.json.assets[0].id
  const deleted = await api('DELETE', `/api/assets/${assetId}`)
  eq(deleted.status, 200, 'DELETE /api/assets/:id 返回 200')
  eq(deleted.json.ok, true, '删除成功')

  const deletedAgain = await api('DELETE', `/api/assets/${assetId}`)
  eq(deletedAgain.status, 404, '重复删除返回 404')

  /* ---------- 10. 流水 ---------- */
  section('10. 点数流水')
  const account = await api('GET', '/api/account')
  eq(account.status, 200, 'GET /api/account 返回 200')

  const debits = account.json.transactions.filter((item) => item.amount < 0)
  eq(debits.length, 3, '3 笔扣费流水（2 张 + 4 张 + 1 张）')
  eq(
    debits.map((item) => item.type).sort().join(','),
    'edit,generate,generate',
    '流水区分了图片生成与产品替换'
  )
  ok(
    debits.every((item) => item.status === 'done'),
    '所有扣费流水都已结算（没有卡在 pending）'
  )
  ok(
    account.json.transactions.every((item) => item.status !== 'released'),
    '没有回滚流水残留（本实例没有失败请求）'
  )
  eq(
    debits.reduce((sum, item) => sum + item.amount, 0).toFixed(2),
    '-2.80',
    '累计扣费 2.8 点（0.8 + 1.6 + 0.4）'
  )
  ok(
    debits.every((item) => item.balanceAfter >= 0),
    '任何时刻余额都没有被扣成负数'
  )
  eq(debits[0].balanceAfter, 125.2, '最新一笔流水记录了扣后余额')
  eq(debits[0].title, '产品替换', '产品替换的流水标题可读')

  /* ---------- 11. 下单 ---------- */
  section('11. 虚拟支付下单')
  const order = await api('POST', '/api/pay/order', { body: { planId: 'points-100' } })
  eq(order.status, 200, 'POST /api/pay/order 返回 200')
  ok(Boolean(order.json.orderId), '返回了 orderId')
  eq(order.json.kind, 'points', '订单类型为 points')
  eq(order.json.points, 88, '到账点数 88')
  eq(order.json.durationDays, 0, '点数档不带时长')
  eq(order.json.priceFen, 10000, '价格 10000 分')
  eq(order.json.payData.mode, 'short_series_goods', 'mode 为道具直购')
  ok(
    order.json.orderId.length >= 8 && order.json.orderId.length <= 32 && !order.json.orderId.startsWith('_'),
    'outTradeNo 满足 8-32 位且不以下划线开头'
  )

  const signData = order.json.payData.signData
  const parsedSignData = JSON.parse(signData)
  eq(parsedSignData.offerId, OFFER_ID, 'signData.offerId 正确')
  eq(parsedSignData.env, 0, 'signData.env 固定为 0')
  eq(parsedSignData.currencyType, 'CNY', 'signData.currencyType 为 CNY')
  eq(parsedSignData.goodsPrice, 10000, 'signData.goodsPrice 单位为分')
  eq(parsedSignData.productId, 'forme_points_100_once', 'signData.productId 与目录一致')
  eq(parsedSignData.outTradeNo, order.json.orderId, 'signData.outTradeNo 与订单号一致')

  // 独立复算两个签名，确认不是随便填的字符串
  const expectedPaySig = crypto.createHmac('sha256', APP_KEY).update(`requestVirtualPayment&${signData}`).digest('hex')
  const sessionKey = crypto.createHash('sha256').update(`sk:${CODE}`).digest('hex').slice(0, 24)
  const expectedSignature = crypto.createHmac('sha256', sessionKey).update(signData).digest('hex')

  eq(order.json.payData.paySig, expectedPaySig, 'paySig 复算一致（AppKey 签名）')
  eq(order.json.payData.signature, expectedSignature, 'signature 复算一致（session_key 签名）')

  const badPlan = await api('POST', '/api/pay/order', { body: { planId: 'not-a-plan' } })
  eq(badPlan.status, 400, '未知方案返回 400')
  eq(badPlan.json.code, 'unknown_plan', '错误码为 unknown_plan')

  /* ---------- 12. 未支付查单 ---------- */
  section('12. 未支付状态查询')
  const pending = await api('GET', `/api/pay/order/${order.json.orderId}`)
  eq(pending.status, 200, 'GET /api/pay/order/:id 返回 200')
  eq(pending.json.status, 'pending', '发货前状态为 pending')

  const ordersBefore = await api('GET', '/api/pay/orders')
  eq(ordersBefore.json.orders.length, 1, '订单列表返回 1 笔')

  const forgedRefund = await api('POST', '/api/pay/notify', {
    raw: `<xml><Event>xpay_refund_notify</Event><MchOrderId>${order.json.orderId}</MchOrderId></xml>`,
    auth: false,
    headers: { 'Content-Type': 'application/xml' }
  })
  eq(forgedRefund.status, 403, '伪造退款通知被拒绝')
  eq((await api('GET', `/api/pay/order/${order.json.orderId}`)).json.status, 'pending', '伪造退款没有关闭待支付订单')

  /* ---------- 13. 发货推送 ---------- */
  section('13. 发货推送与幂等')
  const notifyXml = `<xml>
  <Event><![CDATA[xpay_goods_deliver_notify]]></Event>
  <OpenId><![CDATA[${login.json.user.openid}]]></OpenId>
  <OutTradeNo><![CDATA[${order.json.orderId}]]></OutTradeNo>
  <WeChatPayInfo>
    <MchOrderNo><![CDATA[wx_order_smoke_001]]></MchOrderNo>
  </WeChatPayInfo>
  <GoodsInfo>
    <ProductId><![CDATA[forme_points_100_once]]></ProductId>
    <Quantity>1</Quantity>
  </GoodsInfo>
</xml>`

  const notify = await api('POST', signedNotifyUrl(), {
    raw: notifyXml,
    auth: false,
    headers: { 'Content-Type': 'application/xml' }
  })
  eq(notify.status, 200, 'POST /api/pay/notify 返回 200')
  ok(notify.text.includes('<ErrCode>0</ErrCode>'), '回包 ErrCode=0')
  ok(notify.text.includes('success'), '回包 ErrMsg=success')

  const afterDeliver = await api('GET', '/api/account')
  eq(afterDeliver.json.balance, 213.2, '余额 125.2 + 88 = 213.2')

  const delivered = await api('GET', `/api/pay/order/${order.json.orderId}`)
  eq(delivered.json.status, 'delivered', '订单状态变为 delivered')
  eq(delivered.json.wxOrderId, 'wx_order_smoke_001', '记录了平台单号')

  // 平台会重复推送，必须幂等
  const notifyAgain = await api('POST', signedNotifyUrl(), {
    raw: notifyXml,
    auth: false,
    headers: { 'Content-Type': 'application/xml' }
  })
  eq(notifyAgain.status, 200, '重复推送返回 200（避免平台继续重试）')
  ok(notifyAgain.text.includes('already delivered'), '回包标记为已发货')

  const afterReplay = await api('GET', '/api/account')
  eq(afterReplay.json.balance, 213.2, '重复推送不再加点，余额不变')

  const rechargeCount = afterReplay.json.transactions.filter((item) => item.type === 'recharge').length
  eq(rechargeCount, 1, '只有 1 笔充值流水')

  /* ---------- 14. 异常推送 ---------- */
  section('14. 异常推送处理')
  const unsignedNotify = await api('POST', '/api/pay/notify', {
    raw: notifyXml,
    auth: false,
    headers: { 'Content-Type': 'application/xml' }
  })
  eq(unsignedNotify.status, 403, '未签名推送被拒绝')
  const badSignature = await api('POST', '/api/pay/notify?signature=deadbeef&timestamp=1700735027&nonce=x', {
    raw: notifyXml,
    auth: false,
    headers: { 'Content-Type': 'application/xml' }
  })
  eq(badSignature.status, 403, '错误签名推送被拒绝')

  const unknownOrder = await api('POST', signedNotifyUrl(), {
    raw: '<xml><Event><![CDATA[xpay_goods_deliver_notify]]></Event><OutTradeNo><![CDATA[T_not_exist]]></OutTradeNo></xml>',
    auth: false,
    headers: { 'Content-Type': 'application/xml' }
  })
  ok(unknownOrder.text.includes('<ErrCode>1</ErrCode>'), '未知订单回 ErrCode=1')
  eq(unknownOrder.status, 200, '未知订单仍回 200（否则平台会无限重试）')

  // 退款推送现在会被真正处理（以前是直接忽略，等于用户退了钱还留着点数）
  const refundUnknown = await api('POST', signedNotifyUrl(), {
    raw: '<xml><Event><![CDATA[xpay_refund_notify]]></Event><OutTradeNo><![CDATA[T_not_exist]]></OutTradeNo></xml>',
    auth: false,
    headers: { 'Content-Type': 'application/xml' }
  })
  ok(refundUnknown.text.includes('<ErrCode>1</ErrCode>'), '退款推送指向未知订单时回 ErrCode=1')

  const unknownEvent = await api('POST', signedNotifyUrl(), {
    raw: '<xml><Event><![CDATA[some_future_event]]></Event><OutTradeNo><![CDATA[T_whatever]]></OutTradeNo></xml>',
    auth: false,
    headers: { 'Content-Type': 'application/xml' }
  })
  ok(unknownEvent.text.includes('ignored'), '未知事件被忽略而非当作发货')

  const emptyNotify = await api('POST', signedNotifyUrl(), {
    raw: '<xml></xml>',
    auth: false,
    headers: { 'Content-Type': 'application/xml' }
  })
  ok(emptyNotify.text.includes('<ErrCode>1</ErrCode>'), '空推送回 ErrCode=1')

  /* ---------- 14b. 消息推送 URL 验证握手 ---------- */
  /**
   * MP 后台保存「消息推送」配置时，微信会发 GET 带 signature/timestamp/nonce/
   * echostr 到同一个 URL，服务端验签后必须**原样返回 echostr**。
   * 少了这一步，后台点保存会拿到 404，配置根本存不下去，发货推送永远配不上。
   *
   * 顺便用官方文档给的两组算例把签名算法钉死：算法一旦被人「顺手改对一点」，
   * 前两条会立刻红，而不是等到上线那天在后台看到一个没有原因的「配置失败」。
   */
  section('14b. 消息推送 URL 验证握手')

  const msgSig = (token, timestamp, nonce) =>
    crypto.createHash('sha1').update([token, timestamp, nonce].sort().join('')).digest('hex')

  eq(
    msgSig('AAAAA', '1714036504', '1514711492'),
    'f464b24fc39322e44b38aa78f5edd27bd1441696',
    '签名算法与官方文档算例一一致'
  )
  eq(
    msgSig('AAAAA', '1714037059', '486452656'),
    '899cf89e464efb63f54ddac96b0a0a235f53aa78',
    '签名算法与官方文档算例二一致'
  )

  const verifyTs = '1700735027'
  const verifyNonce = '50328042'
  const verifyEcho = 'Mzi3wDcVa5uI'
  const verifyUrl = (signature, extra = '') =>
    `/api/pay/notify?signature=${signature}&timestamp=${verifyTs}&nonce=${verifyNonce}${extra}`

  const verifyOk = await api(
    'GET',
    verifyUrl(msgSig(MSG_TOKEN, verifyTs, verifyNonce), `&echostr=${verifyEcho}`),
    { auth: false }
  )
  eq(verifyOk.status, 200, '验签通过时返回 200')
  eq(verifyOk.text, verifyEcho, '原样返回 echostr（不加引号、不加换行、不加 CDATA）')

  const verifyBad = await api('GET', verifyUrl('deadbeef', `&echostr=${verifyEcho}`), { auth: false })
  eq(verifyBad.status, 403, '签名不匹配返回 403')
  ok(!verifyBad.text.includes(verifyEcho), '签名不匹配时不返回 echostr')

  // 模拟「后台填的 Token 与 .env 里不是同一个」——这就是后台报「配置失败」的真身
  const verifyWrongToken = await api(
    'GET',
    verifyUrl(msgSig('a_different_token', verifyTs, verifyNonce), `&echostr=${verifyEcho}`),
    { auth: false }
  )
  eq(verifyWrongToken.status, 403, 'Token 与后台不一致时返回 403')

  const verifyNoEcho = await api('GET', verifyUrl(msgSig(MSG_TOKEN, verifyTs, verifyNonce)), { auth: false })
  eq(verifyNoEcho.status, 400, '缺 echostr 时返回 400（而不是 404）')

  // 未配置 WECHAT_MSG_TOKEN 的实例：必须是能看懂的 503，而不是静默放行
  const noTokenRes = await fetch(
    `${budget.base}${verifyUrl(msgSig(MSG_TOKEN, verifyTs, verifyNonce), `&echostr=${verifyEcho}`)}`
  )
  eq(noTokenRes.status, 503, '未配置 WECHAT_MSG_TOKEN 时返回 503')
  ok((await noTokenRes.text()).includes('WECHAT_MSG_TOKEN'), '503 的响应体直接点名缺哪个变量')

  /* ---------- 15. 越权 ---------- */
  section('15. 越权与订单归属')
  const otherLogin = await api('POST', '/api/login', { body: { code: 'another-user-code' }, auth: false })
  const myToken = token
  token = otherLogin.json.token

  const stealOrder = await api('GET', `/api/pay/order/${order.json.orderId}`)
  eq(stealOrder.status, 403, '查别人的订单返回 403')

  const mockPayOthers = await api('POST', '/api/pay/mock-pay', { body: { orderId: order.json.orderId } })
  eq(mockPayOthers.status, 403, '对别人的订单触发模拟支付返回 403')

  const otherAccount = await api('GET', '/api/account')
  eq(otherAccount.json.balance, 128, '另一个用户是独立账户，初始余额 128')
  eq(otherAccount.json.transactions.length, 0, '另一个用户没有流水')

  const otherAssets = await api('GET', '/api/assets')
  eq(otherAssets.json.assets.length, 0, '另一个用户看不到别人的资产')

  token = myToken

  /* ---------- 16. mock 支付 ---------- */
  section('16. 模拟支付通道')
  const order2 = await api('POST', '/api/pay/order', { body: { planId: 'points-500' } })
  const mockPay = await api('POST', '/api/pay/mock-pay', { body: { orderId: order2.json.orderId } })
  eq(mockPay.status, 200, 'POST /api/pay/mock-pay 返回 200')
  eq(mockPay.json.balance, 653.2, '余额 213.2 + 440 = 653.2')

  const mockPayAgain = await api('POST', '/api/pay/mock-pay', { body: { orderId: order2.json.orderId } })
  eq(mockPayAgain.json.already, true, '重复模拟支付被识别为已发货')

  const finalAccount = await api('GET', '/api/account')
  eq(finalAccount.json.balance, 653.2, '重复模拟支付不再加点')

  /* ---------- 17. 有效期道具 ---------- */
  section('17. 有效期道具（30 天）')

  const passBefore = await api('GET', '/api/account')
  eq(passBefore.json.passExpiresAt, null, '购买前没有有效权益')

  const passOrder = await api('POST', '/api/pay/order', { body: { planId: 'pass-starter' } })
  eq(passOrder.status, 200, '有效期道具可以正常下单')
  eq(passOrder.json.kind, 'pass', '订单类型为 pass')
  eq(passOrder.json.durationDays, 30, '订单带 30 天时长')
  eq(passOrder.json.points, 26, '同时含 26 点')
  eq(passOrder.json.priceFen, 3000, '价格 3000 分')

  const passPaid = await api('POST', '/api/pay/mock-pay', { body: { orderId: passOrder.json.orderId } })
  eq(passPaid.status, 200, '有效期道具支付成功')
  eq(passPaid.json.balance, 679.2, '点数 653.2 + 26 = 679.2')

  const passAfter = await api('GET', '/api/account')
  ok(Boolean(passAfter.json.passExpiresAt), '发放了权益到期时间')
  const firstExpiry = new Date(passAfter.json.passExpiresAt).getTime()
  const daysOut = (firstExpiry - Date.now()) / 86400000
  ok(daysOut > 29.9 && daysOut <= 30.01, '到期时间约为 30 天后', `实际 ${daysOut.toFixed(3)} 天`)

  const passTx = passAfter.json.transactions.find((item) => item.type === 'pass')
  ok(Boolean(passTx), '流水里记录了权益发放')
  eq(passTx.amount, 0, '权益流水不涉及点数变动')

  // 再买一次：必须从原到期时间顺延，而不是从今天重新算 30 天
  const passOrder2 = await api('POST', '/api/pay/order', { body: { planId: 'pass-starter' } })
  const passPaid2 = await api('POST', '/api/pay/mock-pay', { body: { orderId: passOrder2.json.orderId } })
  eq(passPaid2.json.balance, 705.2, '点数 679.2 + 26 = 705.2')

  const passAfter2 = await api('GET', '/api/account')
  const secondExpiry = new Date(passAfter2.json.passExpiresAt).getTime()
  const extended = (secondExpiry - firstExpiry) / 86400000
  ok(
    Math.abs(extended - 30) < 0.01,
    '续买从原到期时间顺延 30 天（用户不损失剩余天数）',
    `实际顺延 ${extended.toFixed(3)} 天`
  )

  /* ---------- 18. 退款回收 ---------- */
  section('18. 退款回收')

  // 走真实 XML 推送路径，不依赖 mock 入口
  const refundXml = `<xml>
   <Event><![CDATA[xpay_refund_notify]]></Event>
   <OpenId><![CDATA[${login.json.user.openid}]]></OpenId>
   <MchOrderId><![CDATA[${order.json.orderId}]]></MchOrderId>
   <WxOrderId><![CDATA[wx_order_smoke_001]]></WxOrderId>
   <WxRefundId><![CDATA[refund_smoke_001]]></WxRefundId>
   <RefundFee>10000</RefundFee>
   <RetCode>0</RetCode>
 </xml>`

  for (const [label, body] of [
    ['失败退款', refundXml.replace('<RetCode>0</RetCode>', '<RetCode>1</RetCode>')],
    ['金额不符', refundXml.replace('<RefundFee>10000</RefundFee>', '<RefundFee>1</RefundFee>')],
    ['用户不符', refundXml.replace(login.json.user.openid, 'another_openid')],
    ['平台单号不符', refundXml.replace('wx_order_smoke_001', 'another_wx_order')]
  ]) {
    const rejected = await api('POST', signedNotifyUrl(), {
      raw: body,
      auth: false,
      headers: { 'Content-Type': 'application/xml' }
    })
    ok(rejected.text.includes('<ErrCode>1</ErrCode>'), `${label}不能回收点数`)
  }
  eq((await api('GET', `/api/pay/order/${order.json.orderId}`)).json.status, 'delivered', '异常退款通知没有修改订单')

  const refundPush = await api('POST', signedNotifyUrl(), {
    raw: refundXml,
    auth: false,
    headers: { 'Content-Type': 'application/xml' }
  })
  eq(refundPush.status, 200, '退款推送返回 200')
  ok(refundPush.text.includes('<ErrCode>0</ErrCode>'), '退款推送回 ErrCode=0')

  const afterRefund = await api('GET', '/api/account')
  eq(afterRefund.json.balance, 617.2, '回收本单的 88 点：705.2 - 88 = 617.2')

  const refundTx = afterRefund.json.transactions.find((item) => item.type === 'refund')
  ok(Boolean(refundTx), '流水里记录了退款回收')
  eq(refundTx.amount, -88, '回收金额为 -88')

  const refundedOrder = await api('GET', `/api/pay/order/${order.json.orderId}`)
  eq(refundedOrder.json.status, 'refunded', '订单状态变为 refunded')

  // 平台可能重复推送退款
  const refundAgain = await api('POST', signedNotifyUrl(), {
    raw: refundXml,
    auth: false,
    headers: { 'Content-Type': 'application/xml' }
  })
  ok(refundAgain.text.includes('<ErrCode>0</ErrCode>'), '重复退款推送回 ErrCode=0')

  const afterRefundAgain = await api('GET', '/api/account')
  eq(afterRefundAgain.json.balance, 617.2, '重复退款推送不重复回收')

  // 已退款的订单绝不能再发货，否则等于白送
  const deliverAfterRefund = await api('POST', signedNotifyUrl(), {
    raw: notifyXml,
    auth: false,
    headers: { 'Content-Type': 'application/xml' }
  })
  eq(deliverAfterRefund.status, 200, '已退款订单的发货推送返回 200')
  const afterDeliverAttempt = await api('GET', '/api/account')
  eq(afterDeliverAttempt.json.balance, 617.2, '已退款订单不会被再次发货')

  // 未发货就退款（用户放弃支付）：什么都没损失
  const abandoned = await api('POST', '/api/pay/order', { body: { planId: 'points-100' } })
  const refundAbandoned = await api('POST', '/api/pay/mock-refund', {
    body: { orderId: abandoned.json.orderId }
  })
  eq(refundAbandoned.status, 200, '未发货订单可以退款')
  eq(refundAbandoned.json.clawedBack, 0, '未发货订单没有可回收的点数')
  eq(refundAbandoned.json.wasDelivered, false, '标记为未发货退款')

  const afterAbandon = await api('GET', '/api/account')
  eq(afterAbandon.json.balance, 617.2, '未发货退款不影响余额')

  /* ---------- 19. 登出 ---------- */
  section('19. 登出')
  const logout = await api('POST', '/api/logout', { body: {} })
  eq(logout.status, 200, 'POST /api/logout 返回 200')

  const afterLogout = await api('GET', '/api/account')
  eq(afterLogout.status, 401, '登出后原 token 立即失效')

  /* ---------- 20. 落盘 ---------- */
  section('20. 数据落盘')
  const state = readState(main.dataDir)
  ok(Boolean(state), 'state.json 已写入磁盘')
  eq(state.accounts[login.json.user.id].balance, 617.2, '落盘余额与内存一致')
  eq(state.accounts[login.json.user.id].passExpiresAt, passAfter2.json.passExpiresAt, '落盘权益到期时间与接口一致')
  eq(Object.keys(state.orders).length, 5, '落盘 5 笔订单（3 笔发货 + 1 笔退款 + 1 笔未发货退款）')
  eq(Object.keys(state.holds).length, 0, '没有残留未结算的预扣（hold）')
  eq(Object.keys(state.idempotency).length, 3, '幂等记录已持久化（生成 2 条 + 编辑 1 条）')
  eq(
    Object.keys(state.idempotency).filter((key) => key.endsWith(requestId)).length,
    1,
    '同一个 requestId 只留下一条幂等记录（重放没有产生新条目）'
  )
  ok(
    Object.keys(state.files).length > 0,
    '上传与生成的文件都登记在案'
  )
  ok(
    Object.values(state.orders).every((item) => item.status !== 'pending'),
    '没有订单卡在 pending'
  )
}

/* ================================================================
   资金安全专项
   ================================================================
   这是整个后端唯一会真赔钱的地方，单独用一个「余额只有 1 点」且
   「上游不可达」的实例来压边界：
     - 单次费用超过余额 → 必须 402，且不能扣款
     - 余额够但上游挂了 → 必须把钱还回去，且不能残留 hold
   ================================================================ */

async function runMoneySafety() {
  section('21. 资金安全：余额不足')
  BASE = budget.base
  token = ''

  const login = await api('POST', '/api/login', { body: { code: 'budget-user' }, auth: false })
  token = login.json.token
  eq(login.json.user.isNew, true, '独立实例上的用户是新用户')

  const profile = await api('GET', '/api/profile')
  eq(profile.json.balance, 0.4, 'INITIAL_BALANCE=0.4 生效（刚好够 1 张图）')

  // 4 张 = 1.6 点 > 余额 0.4 点
  const broke = await api('POST', '/api/generate-image', {
    body: { prompt: '余额不足测试', n: 4, size: '64x64', requestId: crypto.randomUUID() }
  })
  eq(broke.status, 402, '余额不足返回 402')
  eq(broke.json.code, 'insufficient_balance', '错误码为 insufficient_balance')
  eq(broke.json.balance, 0.4, '错误体里带上当前余额，方便客户端提示')
  eq(broke.json.required, 1.6, '错误体里带上本次所需点数')
  eq(broke.json.imageCost, 0.4, '错误体里带上单价')

  const afterBroke = await api('GET', '/api/account')
  eq(afterBroke.json.balance, 0.4, '被拒绝的请求没有动余额')
  eq(afterBroke.json.transactions.length, 0, '被拒绝的请求没有产生流水')

  /* ---------- 22. 上游失败回滚 ---------- */
  section('22. 资金安全：上游失败必须回滚')
  // 1 张 = 0.4 点 ≤ 余额，能通过校验；但上游地址是个没人监听的端口
  const failed = await api('POST', '/api/generate-image', {
    body: { prompt: '上游不可达测试', n: 1, size: '64x64', requestId: crypto.randomUUID() }
  })
  eq(failed.status, 502, '上游不可达返回 502（而不是被当成 500 的服务端 bug）')
  eq(failed.json.code, 'upstream_unreachable', '错误码为 upstream_unreachable')

  const afterFailed = await api('GET', '/api/account')
  eq(afterFailed.json.balance, 0.4, '上游失败后余额已回滚到 0.4 点')
  eq(
    afterFailed.json.transactions.length,
    0,
    '回滚的扣费不出现在用户流水里（用户视角这笔从未发生）'
  )

  // 用户看不到，但对账必须看得到：磁盘上要留痕
  const releasedOnDisk = readState(budget.dataDir).accounts[login.json.user.id].transactions.filter(
    (item) => item.status === 'released'
  )
  eq(releasedOnDisk.length, 1, '磁盘上留了 1 条 released 流水供对账')
  eq(releasedOnDisk[0].amount, -0.4, 'released 流水金额正确')
  ok(Boolean(releasedOnDisk[0].releaseReason), 'released 流水记录了回滚原因')

  // 余额能再次使用，说明预扣真的释放了
  const retryBroke = await api('POST', '/api/generate-image', {
    body: { prompt: '回滚后重试', n: 4, size: '64x64', requestId: crypto.randomUUID() }
  })
  eq(retryBroke.status, 402, '回滚后余额仍是 0.4 点（能再次正确判定不足）')

  const finalState = readState(budget.dataDir)
  eq(Object.keys(finalState.holds).length, 0, '磁盘上没有残留的 hold')
  eq(finalState.accounts[login.json.user.id].balance, 0.4, '落盘余额为 0.4 点，未发生泄漏或超扣')
}

/* ================================================================
   退款缺口专项
   ================================================================
   用户买了点数 → 花掉一部分 → 申请退款。能回收的只有还没花掉的部分，
   收不回来的就是真实亏损，必须被如实记录，而不是悄悄算平。

   这个实例初始余额为 0，所以「买了又花掉」的缺口能精确算出来；
   同时顺带验证余额在任何情况下都不会被扣成负数。
   ================================================================ */

async function runRefundShortfall() {
  section('23. 退款缺口（点数已被消费）')
  BASE = wallet.base
  token = ''

  const login = await api('POST', '/api/login', { body: { code: 'wallet-user' }, auth: false })
  token = login.json.token

  const start = await api('GET', '/api/account')
  eq(start.json.balance, 0, 'INITIAL_BALANCE=0 生效')

  const order = await api('POST', '/api/pay/order', { body: { planId: 'points-100' } })
  const paid = await api('POST', '/api/pay/mock-pay', { body: { orderId: order.json.orderId } })
  eq(paid.json.balance, 88, '充值后余额 88 点')

  // 花掉 1.6 点（4 张）
  const spent = await api('POST', '/api/generate-image', {
    body: { prompt: '退款缺口测试', n: 4, size: '64x64', requestId: crypto.randomUUID() }
  })
  eq(spent.status, 200, '可以正常出图')
  eq(spent.json.balance, 86.4, '花掉 1.6 点后余额 86.4')

  // 此时退款：只能回收 86.4，缺口 1.6
  const refund = await api('POST', '/api/pay/mock-refund', { body: { orderId: order.json.orderId } })
  eq(refund.status, 200, '退款成功')
  eq(refund.json.clawedBack, 86.4, '只回收还没花掉的 86.4 点')
  eq(refund.json.shortfall, 1.6, '缺口 1.6 点被如实记录')

  const after = await api('GET', '/api/account')
  eq(after.json.balance, 0, '余额归零，没有被扣成负数')

  const disk = readState(wallet.dataDir)
  eq(disk.accounts[login.json.user.id].balance, 0, '落盘余额为 0，未出现负余额')
  eq(disk.orders[order.json.orderId].refundShortfall, 1.6, '订单上记录了退款缺口，便于人工追损')

  // 零余额出图必须被拒，且不能把余额扣成负数
  const broke = await api('POST', '/api/generate-image', {
    body: { prompt: '零余额测试', n: 1, size: '64x64', requestId: crypto.randomUUID() }
  })
  eq(broke.status, 402, '零余额出图返回 402')

  const finalState = readState(wallet.dataDir)
  eq(finalState.accounts[login.json.user.id].balance, 0, '余额仍为 0，没有出现负数')
  eq(Object.keys(finalState.holds).length, 0, '没有残留 hold')
}

/* ================================================================
   主流程
   ================================================================ */

console.log('启动三个隔离实例…\n')

// 主实例：全流程，mock 上游。
// INITIAL_BALANCE 显式传：生产默认已经是 0（不送点数），
// 测试不该依赖生产默认值 —— 否则哪天调整运营策略，测试会莫名其妙全红。
main = startServer({
  port: 8899,
  env: {
    INITIAL_BALANCE: '128',
    // 第 14b 节要验 URL 验证握手。必须显式给值：
    // 握手成不成功完全取决于这个字符串，靠「本机碰巧没设置」是不行的。
    WECHAT_MSG_TOKEN: 'smoke_msg_token'
  }
})

// 资金安全实例：余额刚好够 1 张图，上游指向一个没人监听的端口。
// 0.4 = 1 张 × IMAGE_COST(0.4)：第 21 节要验「4 张买不起 → 402」，
// 第 22 节要验「1 张买得起但上游挂了 → 502 且回滚」，两个都需要这个精确值。
budget = startServer({
  port: 8898,
  env: {
    INITIAL_BALANCE: '0.4',
    MOCK_LLM: '0',
    LLM_API_KEY: 'smoke_upstream_key',
    LLM_BASE_URL: 'http://127.0.0.1:9',
    LLM_TIMEOUT_MS: '3000',
    // 第 14b 节借这个实例验「没配 Token 时的 503」。显式置空，
    // 否则本机 .env 里若有这个变量，测的就不是那条分支了。
    WECHAT_MSG_TOKEN: ''
  }
})

/**
 * 24. 接口限流
 * ------------------------------------------------------------------
 * 这个实例把额度压到极小：出图 2/min、登录 3/min、全局 20/min。
 *
 * 最要紧的一条断言是「被拦下的请求不能扣钱」：
 * 限流检查必须发生在 reserveCharge 之前。如果顺序反了，
 * 用户被 429 挡掉的同时点数也扣了，是纯粹的坑用户。
 */
async function runRateLimit() {
  section('24. 接口限流')

  const savedBase = BASE
  const savedToken = token
  BASE = rate.base
  token = ''

  const login1 = await api('POST', '/api/login', { body: { code: 'rate-1' }, auth: false })
  eq(login1.status, 200, '限流：第 1 次登录放行')
  token = login1.json.token

  const login2 = await api('POST', '/api/login', { body: { code: 'rate-2' }, auth: false })
  const login3 = await api('POST', '/api/login', { body: { code: 'rate-3' }, auth: false })
  const login4 = await api('POST', '/api/login', { body: { code: 'rate-4' }, auth: false })
  eq(login2.status, 200, '限流：第 2 次登录放行')
  eq(login3.status, 200, '限流：第 3 次登录放行')
  eq(login4.status, 429, '限流：第 4 次登录被拦（登录额度 3/min）')
  eq(login4.json.code, 'rate_limited', '限流：登录超限的错误码是 rate_limited')

  const gen1 = await api('POST', '/api/generate-image', {
    body: { requestId: 'rate-g1', prompt: '限流测试一' }
  })
  const gen2 = await api('POST', '/api/generate-image', {
    body: { requestId: 'rate-g2', prompt: '限流测试二' }
  })
  const gen3 = await api('POST', '/api/generate-image', {
    body: { requestId: 'rate-g3', prompt: '限流测试三' }
  })

  eq(gen1.status, 200, '限流：第 1 次出图放行')
  eq(gen2.status, 200, '限流：第 2 次出图放行')
  eq(gen3.status, 429, '限流：第 3 次出图被拦（出图额度 2/min）')
  ok(gen3.json.retryAfter > 0, '限流：响应体带 retryAfter 秒数', `实际 ${gen3.json.retryAfter}`)
  ok(gen3.headers.get('retry-after') !== null, '限流：响应头带 Retry-After（网关可据此退避）')

  // 最关键的一条：限流必须发生在扣费之前
  const account = await api('GET', '/api/account')
  // 先确认账户接口本身没被误伤，否则下面的余额断言会因为「拿到的是 429」而失败得莫名其妙
  eq(account.status, 200, '限流：账户查询未被误伤', account.text.slice(0, 120))
  eq(account.json.balance, 127.2, '限流：被拦的请求没有扣费（只扣了放行的 2 次）')
  eq(account.json.transactions.length, 2, '限流：只产生 2 条扣费流水')

  // 全局兜底：没单独配额度的接口打多了也要被拦
  let sawGlobalLimit = false
  for (let index = 0; index < 25 && !sawGlobalLimit; index += 1) {
    const probe = await api('GET', '/api/catalog', { auth: false })
    if (probe.status === 429) sawGlobalLimit = true
  }
  ok(sawGlobalLimit, '限流：全局兜底限流生效（未单独配额的接口也会被拦）')

  // 健康检查必须豁免，否则监控会把限流误判成服务挂掉
  const health = await api('GET', '/api/health', { auth: false })
  eq(health.status, 200, '限流：/api/health 不受全局限流影响（监控依赖）')

  BASE = savedBase
  token = savedToken
}

/**
 * 25. 新用户不赠送点数
 * ------------------------------------------------------------------
 * 这个实例不传 INITIAL_BALANCE，走的是**生产默认值**。
 *
 * 为什么值得单独测：默认值是最容易被顺手改掉的东西。
 * 一旦被改成正数，每个新账号都会白拿点数，而且不报错、不告警，
 * 只在上游出图账单上慢慢体现。这条断言把它钉死。
 *
 * （2026-09-27 决定：取消「注册送 1 点」，改回默认 0。
 *  之前送 1 点的版本里这一节断言余额为 1、能免费出两张图；
 *  现在断言余额为 0，且无点数时出图必须 402。）
 */
async function runFreshUserPolicy() {
  section('25. 新用户不赠送点数（生产默认值）')

  const savedBase = BASE
  const savedToken = token
  BASE = fresh.base
  token = null

  const login = await api('POST', '/api/login', { body: { code: 'fresh-user' }, auth: false })
  eq(login.status, 200, '新用户登录成功')
  eq(login.json.user.isNew, true, '确实是首次登录的新账号')
  token = login.json.token

  const account = await api('GET', '/api/account')
  eq(account.json.balance, 0, '新用户余额为 0（不赠送点数）')
  eq(account.json.transactions.length, 0, '新用户没有任何点数流水')

  // 策略要能从外部观测到，否则运维只能去翻服务器上的 env 文件
  const policy = await api('GET', '/api/health', { auth: false })
  eq(policy.json.initialBalance, 0, '健康检查报告 initialBalance=0（策略可外部观测）')

  // 没点数就出不了图 —— 否则等于绕开付费白拿产品
  const gen = await api('POST', '/api/generate-image', {
    body: { prompt: '无点数出图测试', n: 1, size: '64x64', requestId: crypto.randomUUID() }
  })
  eq(gen.status, 402, '无点数时出图被拒（无法绕过付费拿到图片）')
  eq(gen.json.code, 'insufficient_balance', '错误码为 insufficient_balance')
  eq(gen.json.required, 0.4, '本次需要 0.4 点（1 张 × 0.4）')
  eq(gen.json.balance, 0, '错误体里的余额为 0')

  const after = await api('GET', '/api/account')
  eq(after.json.balance, 0, '被拒绝后余额仍为 0')

  BASE = savedBase
  token = savedToken
}

/* ================================================================
   幂等键契约
   ================================================================
   服务端的幂等只在「同一个 requestId」这个前提下成立。把契约的两边都钉住：

     · 复用同一个 id 重放 → 不重复扣费（服务端保护生效）
     · 换一个新 id 重试   → 会再扣一次钱（所以客户端必须复用）

   第二条看起来像在"测试一个 bug"，其实是在**固化接口契约**。
   客户端曾经踩过这个坑：每次调用都发新 id，等于把服务端的幂等彻底架空，
   用户网络超时后点一次「重试」就被多扣一次钱。
   如果哪天有人把服务端改成"按请求内容去重"，这里会红，
   逼他显式确认「同一提示词连续生成两次到底该不该各扣一次钱」——
   那是产品决策，不该被顺手改掉。
   ================================================================ */
async function runIdempotencyContract() {
  section('26. 幂等键契约（客户端必须复用同一个 id）')
  BASE = main.base
  token = ''

  const login = await api('POST', '/api/login', { body: { code: CODE }, auth: false })
  token = login.json.token

  const start = (await api('GET', '/api/account')).json.balance
  const body = { prompt: '幂等契约测试', n: 1, size: '64x64' }

  const first = await api('POST', '/api/generate-image', {
    body: { ...body, requestId: 'contract-a' }
  })
  eq(first.status, 200, '首次生成成功')
  eq(first.json.charged, 0.4, '首次扣 0.4 点')
  const afterFirst = (await api('GET', '/api/account')).json.balance
  eq(afterFirst, Number((start - 0.4).toFixed(2)), '首次扣费后余额正确')

  // 复用同一个 id：服务端命中幂等，不再扣费
  const replay = await api('POST', '/api/generate-image', {
    body: { ...body, requestId: 'contract-a' }
  })
  eq(replay.json.idempotent, true, '复用同一 id 重放被识别为幂等命中')
  eq(
    (await api('GET', '/api/account')).json.balance,
    afterFirst,
    '复用同一 id 重放不再扣费'
  )

  // 换一个新 id：当成全新请求，会再扣一次 —— 这就是客户端必须复用 id 的原因
  const retried = await api('POST', '/api/generate-image', {
    body: { ...body, requestId: 'contract-b' }
  })
  eq(retried.status, 200, '换新 id 会被当成一笔全新请求')
  eq(
    (await api('GET', '/api/account')).json.balance,
    Number((afterFirst - 0.4).toFixed(2)),
    '换新 id 重试会再扣一次钱（客户端必须复用同一个 id）'
  )
}

/* ================================================================
   文档一致性
   ================================================================
   文档里写死的断言数会漂 —— README 就曾经停在 216 而实际早就是 225，
   读者看到「216 项」会以为漏跑了一段。这类数字没有真源可推导，
   只能靠门禁守着。

   ⚠️ 这个检查**故意不使用 eq()**，所以它不产生断言、不改变总数。
   否则「总数」和「被检查的那个数」互相依赖，成了自我指涉，永远对不上。
   ================================================================ */
/**
 * 生产拦截必须走 config.isProduction，不能直接读 process.env.NODE_ENV。
 * ------------------------------------------------------------------
 * 踩过的坑：8 条生产拦截原本全部直接读 `process.env.NODE_ENV`，而 `.env.local`
 * 是放其它所有配置的地方，往里写 `NODE_ENV=production` 是再自然不过的事 ——
 * 写了却**完全不生效**。已实证：一份写着 production + MOCK_WECHAT=1 +
 * SECURITY_MODE=log + HOST=0.0.0.0 的 .env.local，阻断项是 **0 个**。
 *
 * 这个 bug 的可怕之处在于它**不报错**：运维以为自己设成 production 了、
 * 自检也是绿的，而 MOCK_WECHAT=1 正开着（任何人构造一个 code 就能登录任意账号）、
 * 内容审核只记录不拦截（会被下架）。
 *
 * 所以用一条静态检查把「必须走统一取值链」钉住 —— 行为上很难测
 * （要往项目根写 .env.local，会覆盖用户真实的密钥），静态检查既安全又够准。
 */
function checkProductionGateSource() {
  section('27. 生产拦截的取值链')

  const files = ['src/config.mjs', 'scripts/preflight.mjs']
  const offenders = []

  for (const file of files) {
    const full = path.join(ROOT, file)
    if (!fs.existsSync(full)) continue
    const code = fs
      .readFileSync(full, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '') // 去掉块注释（说明文字里会提到它）
      .replace(/\/\/.*$/gm, '') // 去掉行注释
    code.split('\n').forEach((line, index) => {
      if (line.includes('process.env.NODE_ENV')) offenders.push(`${file}:${index + 1}`)
    })
  }

  ok(
    offenders.length === 0,
    '生产拦截全部走 config.isProduction，没有直接读 process.env.NODE_ENV',
    offenders.length ? `绕过统一取值链的位置：${offenders.join('、')}` : ''
  )

  // 取值链本身要成立：config 必须真的解析出了一个环境名，
  // 且 isProduction 与它一致。写死在 .env / .env.local 里也算数。
  ok(
    typeof config.nodeEnv === 'string' && config.nodeEnv.length > 0,
    'config.nodeEnv 解析出了环境名',
    `实际 ${JSON.stringify(config.nodeEnv)}`
  )
  eq(config.isProduction, config.nodeEnv === 'production', 'isProduction 由 nodeEnv 推导')
}

function checkSecretShape() {
  section('28. 密钥形态校验（占位值必须被拦）')

  // 这一节测的是纯函数，不碰这台机器上的真实 .env.local。
  // 它守的是一个真实的失败：preflight 曾经对着 verify_only_secret / 1234567890
  // 这样的假密钥报「19 项通过 · 0 项阻断」—— 占位值检测的正则锚定在行首，
  // 只认 your_ / xxx / changeme，verify_only_* 直接漏过去了。
  // 后果是运维以为密钥已配好就上线，然后在真机上查「为什么所有人都登不上」。

  const cases = [
    ['WECHAT_APP_SECRET', 'verify_only_secret', 'block', '模板占位值 verify_only_*'],
    ['WECHAT_APP_SECRET', 'your_app_secret', 'block', '模板占位值 your_*'],
    ['WECHAT_APP_KEY', '【待填】', 'block', '中文占位词'],
    ['WECHAT_APP_SECRET', 'abc123"', 'block', '引号不成对（parseEnvFile 剥不掉）'],
    ['WECHAT_APP_SECRET', '"abc 123"', 'block', '值内含空格'],
    ['WECHAT_APP_SECRET', 'abc123 ', 'block', '尾随空格'],
    ['WECHAT_OFFER_ID', '1234567890', 'warn', '形如示例值的 OfferID'],
    ['WECHAT_APP_SECRET', 'wx1234567890abcdef', 'warn', 'AppSecret 位粘成了 AppID'],
    ['LLM_API_KEY', 'short', 'warn', '上游 key 明显截断'],
    ['WECHAT_APP_SECRET', '', null, '空值交给 inspectConfig 处理'],
    ['WECHAT_APP_SECRET', null, null, '非字符串不炸'],
    // 真实形态必须放行 —— 校验规则自己不能成为上线的阻力
    ['WECHAT_APP_SECRET', '0123456789abcdef0123456789abcdef', null, '正常的 32 位 AppSecret'],
    ['WECHAT_APP_KEY', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', null, '正常的 32 位 AppKey'],
    ['WECHAT_OFFER_ID', '987654321', null, '正常的纯数字 OfferID'],
    ['LLM_API_KEY', 'sk-proj-abcdefghijklmnopqrstuvwxyz', null, '正常的上游 key']
  ]

  for (const [name, value, expected, label] of cases) {
    const verdict = inspectSecret(name, value)
    eq(verdict?.level ?? null, expected, `${label} → ${expected ?? '放行'}`)
  }

  // 形态规则必须按变量名区分：同一串值，放对地方是合法的，放错地方要提醒。
  // （写成同一个名字去测，等于没测出「按名取规则」这件事。）
  eq(inspectSecret('WECHAT_OFFER_ID', '987654321')?.level ?? null, null, '同一串数字放在 OfferID 上合法')
  eq(inspectSecret('WECHAT_APP_SECRET', '987654321')?.level, 'warn', '同一串数字放在 AppSecret 上要提醒')
}

function checkTransparentGuard() {
  section('30. 一键抠图透明度兜底（白底图必须被拦下）')

  // 这一节守的是一个真实故障：生产服务端没升级时，前端照常发出
  // background=transparent，老服务端直接丢掉这个参数，上游返回普通白底图，
  // 用户花了钱却拿到一张假的白底抠图 —— 静默错误，比报错更糟。
  // 兜底 = 像素级验货：透明像素和不透明像素必须同时存在，否则判失败、
  // runImageTask 的 catch 自动退还预扣点数。

  const pngChunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length, 0)
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(typeAndData), 0)
    return Buffer.concat([length, typeAndData, crc])
  }
  // 造一张 w×h 的 8bit RGBA 小图，alpha 由 alphaFn(x, y) 决定
  const tinyRgba = (w, h, alphaFn, filterType = 0) => {
    const raw = Buffer.alloc((w * 4 + 1) * h)
    let offset = 0
    for (let y = 0; y < h; y += 1) {
      raw[offset] = filterType
      offset += 1
      for (let x = 0; x < w; x += 1) {
        raw[offset] = 200
        raw[offset + 1] = 100
        raw[offset + 2] = 50
        raw[offset + 3] = alphaFn(x, y)
        offset += 4
      }
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(w, 0)
    ihdr.writeUInt32BE(h, 4)
    ihdr[8] = 8 // bit depth
    ihdr[9] = 6 // color type: RGBA
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', zlib.deflateSync(raw)),
      pngChunk('IEND', Buffer.alloc(0))
    ])
  }
  const mustPass = (buffer, label) => {
    let detail = ''
    try {
      assertTransparentPng(buffer)
    } catch (error) {
      detail = error.message
    }
    ok(detail === '', `${label} → 放行`, detail)
  }
  const mustFail = (buffer, label) => {
    let detail = ''
    try {
      assertTransparentPng(buffer)
      detail = '没抛错'
    } catch (error) {
      detail = error.message
    }
    ok(detail !== '' && detail !== '没抛错', `${label} → 拦下`, `原因：${detail}`)
  }

  // 16×16=256 像素，透明/不透明各需 ≥1 个（0.5%）
  mustPass(tinyRgba(16, 16, (x) => (x < 8 ? 0 : 255)), '左半透明右不透明')
  mustPass(tinyRgba(16, 16, (x, y) => ((x + y) % 3 === 0 ? 0 : 255), 1), 'Sub 过滤器编码的混合图')
  mustFail(tinyRgba(16, 16, () => 255), '全不透明（白底图的形态）')
  mustFail(tinyRgba(16, 16, () => 0), '全透明（模型崩了的形态）')
  mustFail(createPlaceholderPng({ width: 64, height: 64 }), 'RGB 无 alpha 通道（参数被吞的形态）')
  mustFail(Buffer.from('hello'), '非 PNG 直接拦下')
  mustFail(tinyRgba(16, 16, (x) => (x < 8 ? 0 : 255)).subarray(0, 60), '截断的 PNG 直接拦下')

  // 接线检查：image.mjs 必须在透明请求上调用验货，且错误码是约定的
  // transparent_not_returned（前端靠它展示「点数已退回」）。
  const imageCode = fs.readFileSync(path.join(ROOT, 'src/image.mjs'), 'utf8')
  ok(
    imageCode.includes("cleanBackground === 'transparent'") && imageCode.includes('assertTransparentPng('),
    'runImageTask 只在 background=transparent 时验货'
  )
  ok(
    imageCode.includes("'transparent_not_returned'"),
    "验货失败抛 transparent_not_returned（前端展示退款提示用）"
  )
}

function checkDocCount(total) {
  section('29. 文档一致性')

  /**
   * 只认「同一行里同时出现脚本名和 N 项断言」的写法。
   * ------------------------------------------------------------------
   * 之前是「文档里出现的每个 N 项断言都必须等于冒烟总数」，这个前提在
   * 只有冒烟一个测试脚本时成立，往文档里加第二个脚本的断言数（比如
   * check:holds 的 11 项）就会误报——守卫本身成了加测试的阻力。
   *
   * 加了归属判断之后：冒烟的数字仍然被严格盯着，其它脚本的数字各归各管
   * （由它们自己的脚本保证），而一个不带脚本名的裸数字会被提醒出来，
   * 避免「不知道属于谁所以谁都不管」。
   */
  const pattern = /(\d+) 项断言/g
  /**
   * 脚本名 → 文档里可能出现的写法。
   * 「冒烟」必须算 smoke 的别名：API.md 里写的就是「跑 232 项断言」，
   * 不认中文别名的话那条最该被盯住的记录反而会被当成「无归属」跳过。
   */
  const SCRIPTS = [
    { name: 'smoke', tokens: ['smoke', '冒烟'] },
    { name: 'check:aigc', tokens: ['check:aigc', 'aigc-check'] },
    { name: 'check:holds', tokens: ['check:holds', 'orphan-holds'] },
    { name: 'verify:dist', tokens: ['verify:dist'] },
    { name: 'check:request-key', tokens: ['check:request-key', 'request-key'] }
  ]
  const docs = ['README.md', 'API.md', 'DEPLOY.md']
  const ambiguous = []

  for (const file of docs) {
    const full = path.join(ROOT, file)
    if (!fs.existsSync(full)) continue

    let smokeMentions = 0
    const wrong = []

    for (const [index, line] of fs.readFileSync(full, 'utf8').split(/\r?\n/).entries()) {
      const numbers = [...line.matchAll(pattern)].map((match) => Number(match[1]))
      if (!numbers.length) continue

      const lower = line.toLowerCase()
      const owners = SCRIPTS.filter((script) => script.tokens.some((token) => lower.includes(token.toLowerCase())))
      if (!owners.length) {
        ambiguous.push(`${file}:${index + 1} 的「${numbers.join('/')} 项断言」没有写明属于哪个脚本`)
        continue
      }
      if (!owners.some((script) => script.name === 'smoke')) continue // 属于别的脚本，由那个脚本自己保证

      smokeMentions += numbers.length
      for (const value of numbers) {
        if (value !== total) wrong.push(value)
      }
    }

    if (!smokeMentions) continue

    if (wrong.length) {
      console.error(`  ✗ ${file} 里冒烟的断言数与实际不符`)
      console.error(`      文档写的：${[...new Set(wrong)].join(', ')}   实际：${total}`)
      failures.push(`${file} 里冒烟的断言数过期：应为 ${total} 项`)
    } else {
      console.log(`  ✓ ${file} 里冒烟的断言数（${total}）与实际一致`)
    }
  }

  if (ambiguous.length) {
    console.warn(`  ⚠️  ${ambiguous.length} 处断言数没有写明归属，无法校验`)
    for (const item of ambiguous) console.warn(`      ${item}`)
  }
}

// 新用户策略实例：**故意不传** INITIAL_BALANCE，专门验证生产默认值（不送点数）。
// 这是一条资金不变量：默认值一旦被误改成正数，等于给每个新账号白送产品，
// 而且不会有任何报错，只会在账单上慢慢体现出来。
fresh = startServer({ port: 8890 })

// 退款缺口实例：初始余额 0，上游可用，用于「买了又花掉再退款」的场景
wallet = startServer({
  port: 8897,
  env: { INITIAL_BALANCE: '0' }
})

// 限流实例：额度压到极小，好在几秒内打满。
// 全局额度必须明显高于「前面各专项测试的请求数」，否则会先撞全局限流，
// 让「出图额度」的断言因为错误的原因通过（曾踩过：设成 6 时 account 先被全局拦掉）。
rate = startServer({
  port: 8896,
  env: {
    INITIAL_BALANCE: '128',
    RATE_LIMIT_GENERATE_PER_MINUTE: '2',
    RATE_LIMIT_LOGIN_PER_MINUTE: '3',
    RATE_LIMIT_GLOBAL_PER_MINUTE: '20'
  }
})

let exitCode = 0
try {
  await Promise.all(instances.map((instance) => waitForHealth(instance.base)))
  console.log('五个实例都已就绪。')

  BASE = main.base
  await run()

  await runMoneySafety()
  await runRefundShortfall()
  await runRateLimit()
  await runFreshUserPolicy()
  await runIdempotencyContract()
  checkProductionGateSource()
  checkSecretShape()
  checkTransparentGuard()

  // 放在最后：要用全部跑完后的总数去核对文档。这个检查本身不产生断言。
  checkDocCount(passed + failures.length)
} catch (error) {
  console.error('\n冒烟测试中断：', error?.stack ?? error)
  for (const instance of instances) {
    console.error(`\n--- 服务端日志 :${instance.port} ---`)
    console.error(instance.logs.join('') || '(无输出)')
  }
  exitCode = 1
}

await shutdownAll()

console.log(`\n${'─'.repeat(56)}`)
if (failures.length) {
  console.error(`❌ 冒烟失败：${passed} 项通过，${failures.length} 项未通过`)
  for (const item of failures) console.error(`   · ${item}`)
  process.exit(1)
}

console.log(`✅ 冒烟通过：${passed} 项断言全部通过`)
process.exit(exitCode)
