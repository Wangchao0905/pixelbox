/**
 * 微信小程序代码上传 / 预览二维码 —— 给「手机端提需求、虚拟机构建」流程用。
 *
 *   node scripts/upload-weapp.mjs preview [描述]   生成预览二维码（手机扫码即测）
 *   node scripts/upload-weapp.mjs upload [描述]    上传为开发版（后台设为体验版）
 *
 * 密钥通过环境变量 WX_PRIVATE_KEY 指定，默认找项目外的 .keys/ 目录（不进 git）。
 * 首次使用前，先在微信公众平台 → 开发管理 → 开发设置 → 小程序代码上传 IP 白名单
 * 里加上这台机器的公网 IP，否则会报「IP 不在白名单」。
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 先装 request-shim（共享 keep-alive 隧道，避开代理 20s CONNECT 和 socket hang up），
// 再动态 import miniprogram-ci（静态 import 会被提升，导致 shim 来不及生效）
createRequire(import.meta.url)('./request-shim.cjs').install()
const ci = (await import('miniprogram-ci')).default
const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')

const mode = process.argv[2] || 'preview'
const desc =
  process.argv[3] ||
  `构建 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`

if (!existsSync(path.join(DIST, 'project.config.json'))) {
  console.error('dist/ 不存在或不是合法的小程序目录，请先跑 npm run build:weapp')
  process.exit(1)
}

const projectConfig = JSON.parse(readFileSync(path.join(DIST, 'project.config.json'), 'utf8'))
const appid = projectConfig.appid
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const version = `${pkg.version}.${today}`

const privateKeyPath =
  process.env.WX_PRIVATE_KEY || path.join(ROOT, '..', '.keys', `private.${appid}__1.key`)

if (!existsSync(privateKeyPath)) {
  console.error(`找不到上传密钥：${privateKeyPath}`)
  console.error('请把 private.xxx.key 放到项目同级的 .keys/ 目录，或设置 WX_PRIVATE_KEY 环境变量')
  process.exit(1)
}

const project = new ci.Project({
  appid,
  type: 'miniProgram',
  projectPath: DIST,
  privateKeyPath,
  ignores: ['node_modules/**/*'],
})

if (mode === 'preview') {
  const qrDest = path.join(ROOT, '..', 'preview-qrcode.jpg')
  // 虚拟机到微信 CI 的链路偶发 socket hang up，加重试
  let lastErr
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await ci.preview({
        project,
        desc: attempt === 1 ? desc : `${desc}（重试${attempt}）`,
        setting: { es6: true, minify: true },
        qrcodeFormat: 'image',
        qrcodeOutputDest: qrDest,
      })
      lastErr = null
      break
    } catch (e) {
      lastErr = e
      console.error(`第 ${attempt} 次预览失败：${e.message || e}，${attempt < 3 ? '重试中…' : ''}`)
    }
  }
  if (lastErr) throw lastErr
  console.log(`预览二维码已生成：${qrDest}`)
  console.log('微信扫码即可在手机上测试本次构建')
} else if (mode === 'upload') {
  await ci.upload({
    project,
    version,
    desc,
    robot: 30,
    setting: { es6: true, minify: true },
  })
  console.log(`已上传开发版 v${version}，去公众平台设为体验版即可扫码测试`)
} else {
  console.error(`未知模式：${mode}，用 preview 或 upload`)
  process.exit(1)
}
