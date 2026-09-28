import fs from 'node:fs'
import path from 'node:path'
import { config } from '../src/config.mjs'

const stateFile = path.join(config.dataDir, 'state.json')
fs.mkdirSync(config.dataDir, { recursive: true })
const entries = fs.readdirSync(config.dataDir)
if (entries.length > 0) {
  throw new Error(`数据目录 ${config.dataDir} 非空；拒绝初始化，避免覆盖已有账户`)
}

const initial = {
  accounts: {}, sessions: {}, orders: {}, assets: {}, idempotency: {}, files: {}, holds: {}
}
fs.writeFileSync(stateFile, JSON.stringify(initial, null, 2), { encoding: 'utf8', flag: 'wx' })
console.log(`已创建空数据文件：${stateFile}`)
