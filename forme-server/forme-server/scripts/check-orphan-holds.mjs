/**
 * 孤儿预扣回收 —— 端到端验证
 * ------------------------------------------------------------------
 *   node scripts/check-orphan-holds.mjs
 *
 * 复现真实事故场景：进程在「预扣已落盘、上游还在 await」的窗口里被杀掉
 * （滚动发布、OOM、kill -9 都会走到这里）。
 *
 * 这个场景用普通冒烟测试测不到——冒烟测试不会杀自己的进程，
 * 而 `releaseCharge` 在正常路径下一定会跑到，所以 hold 表永远是干净的。
 * 只有「把进程打死」才能暴露出来。
 *
 * 覆盖：
 *   1. 崩溃后磁盘上确实留下孤儿 hold，且用户余额已被扣掉
 *   2. 重启后余额自动退还、hold 被清空
 *   3. 回收动作有日志可查（否则运维永远不知道发布在吃用户的钱）
 *   4. once 闸门：进程内第二次调用是安全的无操作，不会退掉在飞的预扣
 */

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 8791
const UPSTREAM_PORT = 8792
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forme-orphan-'))
const BASE = `http://127.0.0.1:${PORT}`

let passed = 0
const failures = []

function check(label, actual, expected) {
  if (actual === expected) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failures.push(label)
    console.error(`  ✗ ${label}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* 假装是图片上游：收下请求，然后永远不回应，把服务卡在 fetch 里 */
const upstream = http.createServer(() => {})

function startServer() {
  const child = spawn(process.execPath, ['src/index.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      // 显式声明测试环境：NODE_ENV 现在也会从 .env / .env.local 读，
      // 本机若存在生产用的 .env.local，MOCK_WECHAT=1 会被当成生产违规拦住
      NODE_ENV: 'test',
      PORT: String(PORT),
      DATA_DIR,
      MOCK_WECHAT: '1',
      MOCK_LLM: '0', // 走真实上游路径，才能卡在 fetch 里
      SECURITY_MODE: 'off',
      INITIAL_BALANCE: '10',
      LLM_API_KEY: 'fake',
      LLM_BASE_URL: `http://127.0.0.1:${UPSTREAM_PORT}`,
      LLM_TIMEOUT_MS: '180000',
      WECHAT_APP_KEY: 'k',
      WECHAT_OFFER_ID: '1',
      WECHAT_APP_SECRET: 's',
      WECHAT_APPID: 'wx0000000000000000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const logs = []
  child.stdout.on('data', (c) => logs.push(c.toString()))
  child.stderr.on('data', (c) => logs.push(c.toString()))
  return { child, logs }
}

async function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health`)
      if (response.ok) return await response.json()
    } catch {
      /* 还没起来 */
    }
    await sleep(150)
  }
  throw new Error(`${BASE} 在 ${timeoutMs / 1000} 秒内没有就绪`)
}

async function login() {
  const response = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'orphan-hold-code' })
  })
  return response.json()
}

async function balanceOf(token) {
  const response = await fetch(`${BASE}/api/account`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  return (await response.json()).balance
}

function readState() {
  const file = path.join(DATA_DIR, 'state.json')
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** once 闸门只能在独立进程里验证：store 是模块级单例 */
function checkOnceGate() {
  const script = path.join(DATA_DIR, 'gate.mjs')
  // Windows 下 ESM 的 import 说明符必须是 file:// URL —— 裸的 C:\... 会被
  // 当成协议 c: 拒绝（ERR_UNSUPPORTED_ESM_URL_SCHEME）。
  const storeUrl = pathToFileURL(path.join(ROOT, 'src', 'store.mjs')).href
  fs.writeFileSync(
    script,
    `
import { reclaimOrphanHolds, releaseCharge, reserveCharge } from ${JSON.stringify(storeUrl)}

const results = {}
const first = await reserveCharge('gate-user', 1)
const sweep = await reclaimOrphanHolds()
// 注意用 .ok === false 而不是 !返回值：mutate 返回的是对象，恒为真值
const releaseAfterSweep = await releaseCharge(first.holdId)
results.firstSweepReleased = releaseAfterSweep.ok === false
results.debug = { first, sweep, releaseAfterSweep }

const second = await reserveCharge('gate-user', 1)
const secondSweep = await reclaimOrphanHolds()
results.secondSweepSkipped = secondSweep.skipped === true
results.liveHoldSurvived = (await releaseCharge(second.holdId)).ok === true

console.log(JSON.stringify(results))
`
  )
  const out = spawn(process.execPath, [script], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'test', DATA_DIR, MOCK_WECHAT: '1', MOCK_LLM: '1', INITIAL_BALANCE: '10' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    out.stdout.on('data', (c) => (stdout += c.toString()))
    out.stderr.on('data', (c) => (stderr += c.toString()))
    out.on('close', () => {
      const last = stdout.trim().split('\n').pop() ?? ''
      try {
        resolve(JSON.parse(last))
      } catch {
        resolve({ error: `stdout=${stdout.trim()} stderr=${stderr.trim()}` })
      }
    })
  })
}

let servers = []

try {
  await new Promise((r) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', r))
  console.log(`临时数据目录 ${DATA_DIR}`)

  console.log('\n1. 正常启动，余额 10 点')
  let server = startServer()
  servers.push(server)
  await waitForHealth()
  const { token } = await login()
  check('初始余额', await balanceOf(token), 10)

  console.log('\n2. 发出图请求（上游挂住），在预扣落盘后 SIGKILL')
  fetch(`${BASE}/api/generate-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      prompt: 'orphan hold probe',
      model: 'test',
      quality: 'high',
      size: '1024x1024',
      n: 1,
      requestId: 'orphan-hold-1'
    })
  }).catch(() => {})
  await sleep(1200)

  // 顺带钉住 API.md 的一条契约：上游还在跑的时候，流水就是 pending，
  // 而且**客户端看得到**。如果谁把 listTransactions 改成只返回 done，
  // 用户会在出图期间看到「没有扣费」，出完图余额突然少一截。
  const midFlight = await fetch(`${BASE}/api/account`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then((r) => r.json())
  check(
    '在飞期间 /api/account 能看到 pending 流水',
    midFlight.transactions.filter((t) => t.status === 'pending').length,
    1
  )
  check('在飞期间余额已经扣掉（预扣已生效）', midFlight.balance, 9.6)

  server.child.kill('SIGKILL')
  await sleep(400)

  console.log('\n3. 崩溃后的磁盘状态（钱已经离开用户）')
  const crashed = readState()
  const crashedAccount = Object.values(crashed.accounts)[0]
  check('余额已被扣掉', crashedAccount.balance, 9.6)
  check('残留孤儿 hold 数量', Object.keys(crashed.holds ?? {}).length, 1)
  check(
    '残留 pending 流水数量（用户会看到一笔没出图的扣费）',
    crashedAccount.transactions.filter((t) => t.status === 'pending').length,
    1
  )

  console.log('\n4. 用同一个数据目录重启')
  server = startServer()
  servers.push(server)
  await waitForHealth()
  const relogin = await login()
  const restarted = readState()
  check('重启后用户余额已退还', await balanceOf(relogin.token), 10)
  check('重启后 hold 已清空', Object.keys(restarted.holds ?? {}).length, 0)
  check(
    '重启后流水不再是 pending',
    restarted.accounts[relogin.user.id].transactions.filter((t) => t.status === 'pending').length,
    0
  )
  const logText = server.logs.join('')
  check('回收动作有日志可查', logText.includes('回收孤儿预扣'), true)

  console.log('\n5. once 闸门：进程内第二次调用必须是安全的无操作')
  const gate = await checkOnceGate()
  if (gate.error) {
    console.error(`  ✗ 闸门子进程没有返回结果：${gate.error}`)
    failures.push('once 闸门子进程执行失败')
  }
  const gatePassed =
    gate.firstSweepReleased === true &&
    gate.secondSweepSkipped === true &&
    gate.liveHoldSurvived === true
  if (!gatePassed && gate.debug) {
    console.error(`  · 闸门子进程明细 ${JSON.stringify(gate.debug)}`)
  }
  check('第一次回收确实释放了预扣', gate.firstSweepReleased, true)
  check('第二次调用被跳过', gate.secondSweepSkipped, true)
  check('在飞的预扣没有被误退', gate.liveHoldSurvived, true)
} finally {
  try { upstream.close() } catch {}
  for (const server of servers) {
    try { server.child.kill('SIGTERM') } catch {}
  }
  await sleep(400)
  for (const server of servers) {
    try { server.child.kill('SIGKILL') } catch {}
  }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }) } catch {}
}

console.log('\n────────────────────────────────────────────────────────')
if (failures.length === 0) {
  console.log(`✅ ${passed} 项通过，0 项失败`)
  process.exit(0)
}
console.log(`❌ ${passed} 项通过，${failures.length} 项失败`)
for (const failure of failures) console.log(`   · ${failure}`)
process.exit(1)
