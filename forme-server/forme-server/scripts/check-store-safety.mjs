import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forme-store-safety-'))
const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forme-store-init-'))
const stateFile = path.join(dataDir, 'state.json')

function run(code) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', DATA_DIR: dataDir }
  })
}

try {
  const storeImport = `import { mutate, read } from './src/store.mjs'`
  let result = run(`${storeImport}; await mutate(s => { s.accounts.probe = { balance: 7 } })`)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).accounts.probe.balance, 7)

  result = run(`${storeImport}; if (read(s => s.accounts.probe.balance) !== 7) process.exit(2)`)
  assert.equal(result.status, 0, result.stderr)

  fs.mkdirSync(`${stateFile}.tmp`)
  result = run(`${storeImport}; try { await mutate(s => { s.accounts.probe.balance = 9 }); process.exit(2) } catch {} if (read(s => s.accounts.probe.balance) !== 7) process.exit(3)`)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).accounts.probe.balance, 7)
  fs.rmdirSync(`${stateFile}.tmp`)

  fs.writeFileSync(stateFile, '{bad json')
  result = run("import './src/store.mjs'")
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /已阻止用空账户启动/)
  assert.equal(fs.readFileSync(stateFile, 'utf8'), '{bad json')

  fs.writeFileSync(stateFile, '{}')
  result = run("import './src/store.mjs'")
  assert.notEqual(result.status, 0)
  assert.equal(fs.readFileSync(stateFile, 'utf8'), '{}')

  fs.unlinkSync(stateFile)
  result = spawnSync(process.execPath, ['--input-type=module', '-e', "import './src/store.mjs'"], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production', DATA_DIR: dataDir }
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /已阻止用空账户启动/)

  result = spawnSync(process.execPath, ['scripts/init-data.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production', DATA_DIR: freshDir }
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(freshDir, 'state.json'), 'utf8')).orders, {})
  result = spawnSync(process.execPath, ['scripts/init-data.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production', DATA_DIR: freshDir }
  })
  assert.notEqual(result.status, 0)
  console.log('状态恢复、写盘失败回滚、损坏文件阻止启动、首次初始化：通过')
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true })
  fs.rmSync(freshDir, { recursive: true, force: true })
}
