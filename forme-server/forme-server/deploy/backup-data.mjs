import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const appDir = path.resolve(process.env.APP_DIR || '/opt/forme/forme-server')
const backupDir = path.resolve(process.env.BACKUP_DIR || '/backup/forme')
const keepDays = Number(process.env.KEEP_DAYS || 30)
const stateFile = path.join(appDir, 'data', 'state.json')

if (!Number.isInteger(keepDays) || keepDays < 1) throw new Error('KEEP_DAYS 必须是正整数')
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
if (!state || typeof state !== 'object' || !state.accounts || !state.orders) {
  throw new Error('state.json 缺少账户或订单结构')
}

fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 })
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')
const archive = path.join(backupDir, `forme-data-${stamp}.tar.gz`)
const temporary = `${archive}.tmp`

try {
  execFileSync('tar', ['-czf', temporary, '-C', appDir, 'data'])
  const listing = execFileSync('tar', ['-tzf', temporary], { encoding: 'utf8' })
  if (!listing.split(/\r?\n/).includes('data/state.json')) {
    throw new Error('备份中没有 data/state.json')
  }
  const saved = JSON.parse(execFileSync('tar', ['-xOzf', temporary, 'data/state.json'], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }))
  if (!saved?.accounts || !saved?.orders) throw new Error('归档里的状态文件无效')
  fs.chmodSync(temporary, 0o600)
  fs.renameSync(temporary, archive)
} finally {
  if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
}

const cutoff = Date.now() - keepDays * 86400_000
for (const entry of fs.readdirSync(backupDir)) {
  if (!/^forme-data-\d{8}T\d{6}Z\.tar\.gz$/.test(entry)) continue
  const file = path.join(backupDir, entry)
  if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file)
}
console.log(`备份已校验：${archive}`)
