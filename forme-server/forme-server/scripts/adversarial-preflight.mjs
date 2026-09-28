/**
 * 对抗测试：preflight 9.5「出图尺寸契约」这条阻断项是不是**真门禁**
 * ==================================================================
 *   node scripts/adversarial-preflight.mjs
 *
 * 为什么必须有这个脚本（项目铁律 #3）：
 *   「改坏产物 → 断言它真的拦下」才叫验证过门禁。只跑一遍「正常时是绿的」
 *   证明不了任何事 —— 那条检查可能**永远不会失败**，也可能是**瞎的**
 *   （取不到东西 ⇒ 比出来是空的 ⇒ 报通过）。后者这个项目已经踩过。
 *
 * ⚠️ 这个脚本会临时改真实源码（`forme-taro/src/data/catalog.ts`），
 *    所以：
 *      - 所有改动都在 try/finally 里，无论断言成败都还原；
 *      - 还原后**重新哈希比对**，证明是逐字节一致，不是「大概改回来了」；
 *      - 启动时先看有没有上次留下的快照 —— 被强杀（SIGKILL）时 finally
 *        不会跑，靠这一步自愈。快照路径会打印出来。
 *    这也是它**不**进 `npm run check` 的原因：会改源码的脚本不该挂在自动流程里。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG = path.resolve(ROOT, '..', 'forme-taro', 'src', 'data', 'catalog.ts')
const SNAPSHOT = `${CATALOG}.adversarial-snapshot`

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

/* ---------- 启动自愈：上次被强杀时留下的快照 ---------- */
if (existsSync(SNAPSHOT)) {
  writeFileSync(CATALOG, readFileSync(SNAPSHOT))
  console.log(`⚠️  发现上次留下的快照，已先还原：${SNAPSHOT}`)
  console.log('    （正常退出时不会留下这个文件；看到它就说明上次被强杀了）')
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `\n      ${detail}` : ''}`)
}

function runPreflight() {
  try {
    return execFileSync(process.execPath, ['scripts/preflight.mjs'], {
      cwd: ROOT,
      encoding: 'utf8'
    })
  } catch (error) {
    // 有阻断项时 preflight 会非 0 退出，输出仍在 stdout
    return String(error.stdout ?? '') + String(error.stderr ?? '')
  }
}

const original = readFileSync(CATALOG, 'utf8')
const originalHash = sha(CATALOG)
let phase = '初始化'

// 落一份快照到磁盘：被 SIGKILL 时 finally 不会跑，靠开头那步自愈
writeFileSync(SNAPSHOT, original)
console.log(`（快照已写到 ${SNAPSHOT}，正常退出时会删掉）\n`)

try {
  /* ---------- A 正常态：必须 pass，而且不能是阻断 ---------- */
  phase = 'A'
  const baseline = runPreflight()
  const baselineLine = (baseline.match(/出图尺寸契约一致[^\n]*/) ?? ['(没找到这一行)'])[0].trim()
  check(
    'A 正常态：9.5 报 pass',
    baseline.includes('出图尺寸契约一致') && !baseline.includes('客户端会算出服务端不接受的尺寸'),
    baselineLine
  )

  /* ---------- B 客户端算出越界尺寸：必须阻断 ---------- */
  phase = 'B'
  writeFileSync(
    CATALOG,
    original.replace("  '16:9': '1536x864'", "  '16:9': '1536x864',\n  '21:9': '4096x4096'")
  )
  const outOfBounds = runPreflight()
  check(
    'B 客户端多出 21:9→4096x4096（越界）：真的阻断',
    outOfBounds.includes('客户端会算出服务端不接受的尺寸') && outOfBounds.includes('21:9→4096x4096'),
    (outOfBounds.match(/❌[^\n]*不接受的尺寸[^\n]*/) ?? ['(没找到阻断行)'])[0].trim()
  )
  check(
    'B 阻断信息带上了服务端的判定理由',
    /出图尺寸太大/.test(outOfBounds),
    (outOfBounds.match(/出图尺寸太大[^\n]*/) ?? ['(没有理由)'])[0].trim()
  )

  /* ---------- C 客户端算出「形状不对」的值：也必须阻断 ---------- */
  phase = 'C'
  writeFileSync(
    CATALOG,
    original.replace("  '16:9': '1536x864'", "  '16:9': '16:9'")
  )
  const wrongShape = runPreflight()
  check(
    'C 客户端把比例当尺寸（16:9→"16:9"）：真的阻断',
    wrongShape.includes('客户端会算出服务端不接受的尺寸') &&
      /必须是「宽x高」/.test(wrongShape),
    (wrongShape.match(/❌[^\n]*不接受的尺寸[^\n]*/) ?? ['(没找到阻断行)'])[0].trim()
  )

  /* ---------- D 映射表整块消失：要报「这条检查是瞎的」，不能报通过 ---------- */
  phase = 'D'
  writeFileSync(
    CATALOG,
    original.replace(/export const ratioToSize[\s\S]*?\n\}/, 'export const ratioToSize = {}')
  )
  const emptyTable = runPreflight()
  check(
    'D 映射表变空：报「这条检查是瞎的」而不是通过',
    emptyTable.includes('读不到客户端的比例→尺寸映射表') && !emptyTable.includes('出图尺寸契约一致'),
    (emptyTable.match(/❌[^\n]*映射表[^\n]*/) ?? ['(没找到阻断行)'])[0].trim()
  )

  /* ---------- E 带空格的写法：抽取要比校验器宽，不能静默跳过 ---------- */
  phase = 'E'
  writeFileSync(
    CATALOG,
    original.replace("  '16:9': '1536x864'", "  '16:9': '1536 x 864'")
  )
  const spaced = runPreflight()
  // 校验器本身接受带空格的写法（会归一化），所以这里**应当 pass**。
  // 要证明的是「它被抽出来判过了」，而不是被正则漏掉后碰巧 pass ——
  // 所以用一个越界值再试一次：带空格且越界，必须阻断。
  const spacedOutOfBounds = (() => {
    writeFileSync(
      CATALOG,
      original.replace("  '16:9': '1536x864'", "  '16:9': '1536 x 9999'")
    )
    return runPreflight()
  })()
  check(
    'E 带空格的值也被抽出来判过（不是被正则漏掉）',
    spaced.includes('出图尺寸契约一致') &&
      spacedOutOfBounds.includes('客户端会算出服务端不接受的尺寸'),
    spacedOutOfBounds.includes('1536 x 9999')
      ? '带空格 + 越界 → 阻断（说明确实被抽到并判过）'
      : '(越界值没被拦下 ⇒ 抽取比校验器窄)'
  )
} finally {
  /* ---------- 无论成败都还原，并自证逐字节一致 ---------- */
  writeFileSync(CATALOG, original)
  const restored = sha(CATALOG) === originalHash
  check(`还原：catalog.ts 逐字节一致（在阶段 ${phase} 之后）`, restored)

  try {
    if (existsSync(SNAPSHOT)) rmSync(SNAPSHOT)
  } catch (error) {
    console.warn(`⚠️  快照没删掉（不影响结果，下次运行会自愈）：${error?.message ?? error}`)
  }

  const after = runPreflight()
  check(
    '还原后重跑：尺寸契约回到 pass，没有残留尺寸阻断',
    after.includes('出图尺寸契约一致') &&
      !after.includes('客户端会算出服务端不接受的尺寸') &&
      !after.includes('读不到客户端的比例→尺寸映射表'),
    (after.match(/\d+ 项通过 · \d+ 项警告 · \d+ 项阻断/) ?? [''])[0]
  )
}

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
