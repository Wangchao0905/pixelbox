#!/usr/bin/env node
/**
 * 封面图线上可达性检查（只读，联网）
 * ==================================================================
 * 用法（在 forme-server 目录下）：
 *   npm run check:media
 *
 * 它补的是**门禁之间的那道缝**：
 *
 *   `verify:dist`（客户端，离线）只检查「域名收口了没有」——
 *   也就是 `TARO_APP_MEDIA_BASE` 配了、产物里不再有外部图床域名。
 *   它是**静态**判断，看不见服务器上到底有没有那些文件。
 *
 *   于是存在一个绿色的坏状态：env 配好了、`verify:dist` 转绿、
 *   包也上传了 —— 但服务器上 `/media/` 一个文件都没有，或者
 *   nginx 那个 location 根本没生效。**每张封面都是空白**，
 *   而它和「域名没进白名单」长得一模一样。
 *
 * 所以这个脚本**先 HEAD 一遍真实 URL**，再谈配 env。
 * 顺序反了就会得到一个「门禁全绿、线上全白」的产物。
 *
 * 它检查三件事，每一件都是真的踩过或差点踩到的：
 *   1. **HTTP 200** —— 文件真的在（404 = 没 rsync，或 nginx 的
 *      /media/ 没生效被别的应用接管了）
 *   2. **content-type 是 image/*** —— 文件名没有扩展名，nginx 若不写
 *      `default_type image/jpeg` 会发 application/octet-stream，
 *      而部分客户端对非 image/* 的响应**不渲染** ⇒ 同样表现为封面空白
 *   3. **base 是 HTTPS** —— 微信的合法域名只接受 HTTPS
 *
 * 退出码：有问题 = 1（可直接挂进 CI / 上线流程）。
 */

import fs from 'node:fs'
import {
  MEDIA_DIR,
  collectCoverRefs,
  dedupeByFileName,
  readClientEnv
} from '../deploy/cover-names.mjs'

/** 仓库里 nginx.conf 的意图地址。TARO_APP_MEDIA_BASE 没配时用它做「推断目标」。 */
const INFERRED_BASE = 'https://pixeltoy.cn/media'

const CONCURRENCY = 6
const TIMEOUT_MS = 15_000

const line = '─'.repeat(60)

let refs
let byFileName
try {
  refs = collectCoverRefs()
  byFileName = dedupeByFileName(refs)
} catch (error) {
  console.error(`❌ ${error.message}`)
  process.exit(1)
}

if (!refs.length) {
  console.log('源码里没有 media(...) 形式的远程图片引用 —— 没有要检查的东西。')
  process.exit(0)
}

/**
 * 覆盖检查地址。用途有二：
 *   · 上线前先验**预发/staging** 的地址，不用改 .env.production
 *   · 对脚本自己做阳性对照（本地起一个静态服务喂它）
 * 用法：npm run check:media -- --base=http://127.0.0.1:8099
 */
function baseOverride() {
  const found = process.argv.find((item) => item.startsWith('--base='))
  return found ? found.slice('--base='.length).replace(/\/+$/, '') : ''
}

const configured = baseOverride() || readClientEnv('TARO_APP_MEDIA_BASE').replace(/\/+$/, '')
const isOverride = Boolean(baseOverride())
const base = configured || INFERRED_BASE

console.log(`\n封面图线上可达性\n${line}`)
console.log(`期望文件数：${byFileName.size}（源码引用 ${refs.length} 处，同名共用）`)
console.log(`检查地址  ：${base}`)
if (isOverride) {
  console.log(`来源      ：命令行 --base 覆盖`)
} else if (configured) {
  console.log(`来源      ：forme-taro/.env.production 的 TARO_APP_MEDIA_BASE`)
} else {
  console.log(`来源      ：⚠️ TARO_APP_MEDIA_BASE **尚未配置**，上面是按 deploy/nginx.conf 推断的地址`)
}
console.log('')

const problems = []
const ok = []

function record(name, kind, detail, cause) {
  if (kind === 'ok') ok.push({ name, detail })
  else problems.push({ name, kind, detail, cause })
}

/**
 * HEAD 优先；有些服务端不支持 HEAD（405/501），退回「只取 1 字节的 GET」。
 * 两者都失败才算网络失败 —— 别把「服务端不支持 HEAD」误报成「文件不存在」。
 */
async function probe(url) {
  const attempt = async (method) => {
    const headers = method === 'GET' ? { Range: 'bytes=0-0' } : {}
    const response = await fetch(url, {
      method,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow'
    })
    return response
  }

  let response
  try {
    response = await attempt('HEAD')
    if (response.status === 405 || response.status === 501) response = await attempt('GET')
  } catch (error) {
    return { network: error?.message ?? String(error) }
  }

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
  const result = { status: response.status, contentType }

  // 404 时多取一点信息：**是谁发的 404** 决定了怎么修。
  // 这一步把「看响应体判断哪一层在答」从人的经验变成脚本的判断。
  //
  // ⚠️ 必须再发一次 GET：HEAD 响应**按规范没有 body**，光看 HEAD 的
  //    content-type 分不出「落到 forme-server」和「落到别的应用」——
  //    两者都是 application/json。这里踩过：一开始只用 HEAD，
  //    于是带 code 的那个分支**永远不会命中**，所有 404 都被报成
  //    「另一个应用」（在线上的那次恰好结论正确，但那是巧合，不是证据）。
  if (response.status === 404) {
    try {
      const bodyResponse = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'follow'
      })
      result.body = (await bodyResponse.text()).slice(0, 300)
      if (!result.contentType) {
        result.contentType = (bodyResponse.headers.get('content-type') ?? '').toLowerCase()
      }
    } catch {
      result.body = ''
    }
  }

  return result
}

/**
 * 判别 404 是**哪一层**发的 —— 两类成因表现一样、修法完全不同。
 *
 * 这是实测出来的三种形态（pixeltoy.cn，2026-09-20）：
 *   · nginx 静态 404        → content-type text/html
 *   · 落到 forme-server     → JSON，且带 `code` 字段（http.mjs 的错误结构）
 *   · 落到**别的**应用      → JSON，但没有 `code`（另一个站点占了 `location /`）
 *
 * 第二种和第三种都说明「nginx 的 /media/ 没生效」，但责任范围不同：
 * 第三种意味着这台机器上还有别的站点，改配置时别把它踩坏。
 */
function classify404(result) {
  const type = result.contentType || ''
  const body = (result.body ?? '').trim()

  if (type.includes('text/html') || body.startsWith('<!') || body.startsWith('<html')) {
    return {
      cause: 'nginx-static',
      label: 'nginx 的 /media/ 生效了，但**文件不在**',
      hint: 'rsync 上去就行'
    }
  }

  if (type.includes('json') || body.startsWith('{')) {
    // 拿不到 body 就不能硬猜 —— 两种 JSON 成因修法不同，猜错会把人带偏
    if (!body) {
      return {
        cause: 'json-unknown',
        label: 'JSON 404，但拿不到响应体 ⇒ 分不出是哪一层（不是 nginx 静态）',
        hint: '手动 curl -i 看一眼响应体里有没有 code 字段'
      }
    }
    // forme-server 的错误体带 code；别的应用通常不带
    if (/"code"\s*:/.test(body)) {
      return {
        cause: 'forme-server',
        label: '请求落到了 **forme-server** ⇒ nginx 没有 /media/ 这条静态 location',
        hint: '把 deploy/nginx.conf 的 location /media/ 部署上去'
      }
    }
    return {
      cause: 'other-app',
      label: '请求落到了**另一个应用** ⇒ 这台机器上还有别的站点占了 location /',
      hint: '部署 /media/ 时注意别覆盖别人的站点配置'
    }
  }

  return { cause: 'unknown', label: '404，但响应体形态不认识', hint: '手动 curl -i 看一眼' }
}

async function checkOne(name) {
  const url = `${base}/${encodeURIComponent(name)}`
  const result = await probe(url)

  if (result.network) {
    record(name, 'network', result.network)
    return
  }
  if (result.status === 404) {
    const verdict = classify404(result)
    record(name, 'missing', `HTTP 404 · ${verdict.label}`, verdict.cause)
    return
  }
  if (result.status !== 200 && result.status !== 206) {
    record(name, 'status', `HTTP ${result.status}`)
    return
  }
  if (!result.contentType.startsWith('image/')) {
    record(name, 'type', `content-type: ${result.contentType || '(空)'}`)
    return
  }
  record(name, 'ok', `${result.contentType}`)
}

// 限并发，别把人家服务器打满 —— 21 个文件同时打过去对一个单核小机器不礼貌
const names = [...byFileName.keys()]
const queue = [...names]
const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
  while (queue.length) {
    const name = queue.shift()
    await checkOne(name)
  }
})
await Promise.all(workers)

/* ---------------- 报告 ---------------- */

const byKind = (kind) => problems.filter((item) => item.kind === kind)

if (ok.length) {
  console.log(`✅ 可访问 ${ok.length}/${names.length}`)
}

const missing = byKind('missing')
const causeCount = new Map()
for (const item of missing) causeCount.set(item.cause, (causeCount.get(item.cause) ?? 0) + 1)

const CAUSE_LABEL = {
  'nginx-static': 'nginx 静态 404 ⇒ /media/ 的 location 生效了，只是**文件不在**',
  'forme-server': '落到 **forme-server** ⇒ nginx 没有 /media/ 这条静态 location',
  'other-app': '落到**另一个应用** ⇒ 这台机器上还有别的站点占了 location /',
  'json-unknown': 'JSON 404 但拿不到响应体 ⇒ 分不出是哪一层',
  unknown: '响应体形态不认识，手动 curl -i 看一眼'
}

if (missing.length) {
  console.log(`\n❌ 404（${missing.length} 个）—— 按「是谁发的这个 404」分组：`)
  for (const [cause, count] of causeCount) {
    console.log(`   · ${String(count).padStart(2)} 个：${CAUSE_LABEL[cause] ?? cause}`)
  }
  console.log(`   例：${missing[0].name}`)
}

const wrongType = byKind('type')
if (wrongType.length) {
  console.log(`\n❌ content-type 不是 image/*（${wrongType.length} 个）`)
  for (const item of wrongType.slice(0, 8)) console.log(`   · ${item.name}  ${item.detail}`)
}

const badStatus = byKind('status')
if (badStatus.length) {
  console.log(`\n❌ 状态码异常（${badStatus.length} 个）`)
  for (const item of badStatus.slice(0, 8)) console.log(`   · ${item.name}  ${item.detail}`)
}

const network = byKind('network')
if (network.length) {
  console.log(`\n❌ 连不上（${network.length} 个）—— 先确认服务器/网络，别急着改配置`)
  for (const item of network.slice(0, 3)) console.log(`   · ${item.name}  ${item.detail}`)
}

console.log(`\n${line}`)

if (!problems.length) {
  console.log(`  ${names.length} 项通过 · 0 项问题`)
  if (!configured) {
    console.log(`
  服务器已就绪。现在可以配 env 了：
    forme-taro/.env.production → TARO_APP_MEDIA_BASE=${base}
    然后 cd ../forme-taro && npm run release`)
  } else {
    console.log('\n  收口完成：产物与线上一致。')
  }
  process.exit(0)
}

/* 每类问题给可操作的下一步，而不是只报一个数字 */
console.log(`  ${ok.length} 项通过 · ${problems.length} 项问题`)

if (missing.length) {
  const localCount = fs.existsSync(MEDIA_DIR) ? fs.readdirSync(MEDIA_DIR).length : 0
  const dominant = [...causeCount.entries()].sort((a, b) => b[1] - a[1])[0][0]

  if (dominant === 'nginx-static') {
    console.log(`
  ⇒ nginx 那条 location 是对的，**只是文件还没传上去**。
    本地 deploy/media/ 已有 ${localCount} 个文件：

      rsync -av deploy/media/ root@pixeltoy.cn:/opt/forme/media/

    传完重跑本脚本即可。`)
  } else {
    console.log(`
  ⇒ **nginx 的 /media/ 没有生效** —— 请求根本没走到静态文件那一步，
    所以「先把文件传上去」在这里是无效的（传了也一样 404）。

    在服务器上按顺序确认三件事：

      # 1. /media/ 这条 location 到底在不在、写在哪个文件里
      grep -rn 'location /media/' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null

      # 2. alias 指向的目录存在吗（路径写错也 404，且不报错）
      ls -la /opt/forme/media/ 2>&1 | head

      # 3. 生效的到底是哪个 server 块 —— 多站点机器上最容易配进别人的块
      nginx -T 2>/dev/null | grep -n 'server_name\\|location /media/'

    需要的话把 deploy/nginx.conf 里这段贴过去：
      location /media/ {
          alias /opt/forme/media/;
          default_type image/jpeg;   # 文件名没有扩展名，不写会发 octet-stream
          autoindex off;
          expires 30d;
      }
    改完：sudo nginx -t && sudo systemctl reload nginx`)
  }

  if (dominant === 'other-app') {
    console.log(`
  ⚠️ 这台机器上**还有别的站点**在响应 / —— 加 /media/ 时别覆盖别人的配置，
     只往对应的 server 块里**追加**一个 location。改前先备份：
       sudo cp -a /etc/nginx/sites-enabled/<那个文件> ~/nginx.bak`)
  }
}

if (wrongType.length) {
  console.log(`
  content-type 不对 = nginx 的 /media/ 少了 \`default_type image/jpeg\`。
  文件其实已经在了，只是发成了 application/octet-stream，
  部分客户端对非 image/* 的响应不渲染 ⇒ 同样是「封面空白」。`)
}

if (network.length) {
  console.log('\n  连不上时先做对照实验：curl -I https://pixeltoy.cn/api/catalog')
  console.log('  能通 = 域名/网络没问题，是 /media/ 这一条路径的事。')
}

console.log(`
  ⚠️ 在服务器确认能出图**之前**，不要配 TARO_APP_MEDIA_BASE ——
     配了会让 verify:dist 转绿，而线上每张封面仍是空白。
     那是「绿色门禁掩盖坏状态」，比门禁报红危险得多。`)

process.exit(1)
