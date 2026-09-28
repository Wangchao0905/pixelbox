import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forme-backup-check-'))
const appDir = path.join(root, 'app')
const backupDir = path.join(root, 'backups')
const restoreDir = path.join(root, 'restore')

try {
  fs.mkdirSync(path.join(appDir, 'data', 'uploads'), { recursive: true })
  fs.mkdirSync(restoreDir)
  const original = { accounts: { probe: { balance: 12.5 } }, orders: { order1: { status: 'delivered' } } }
  fs.writeFileSync(path.join(appDir, 'data', 'state.json'), JSON.stringify(original))
  fs.writeFileSync(path.join(appDir, 'data', 'uploads', 'image.png'), 'image-bytes')

  execFileSync(process.execPath, ['deploy/backup-data.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, APP_DIR: appDir, BACKUP_DIR: backupDir }
  })
  const archives = fs.readdirSync(backupDir)
  assert.equal(archives.length, 1)
  execFileSync('tar', ['-xzf', path.join(backupDir, archives[0]), '-C', restoreDir])
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(restoreDir, 'data', 'state.json'), 'utf8')), original)
  assert.equal(fs.readFileSync(path.join(restoreDir, 'data', 'uploads', 'image.png'), 'utf8'), 'image-bytes')
  console.log('备份归档与隔离恢复：通过')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
