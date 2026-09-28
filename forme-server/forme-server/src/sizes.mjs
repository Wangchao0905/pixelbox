import { badRequest } from './http.mjs'

/**
 * 出图尺寸的边界
 * ==================================================================
 * `size` 是**客户端算出来的**，不是用户直接选的 —— 用户选的是「比例」，
 * 客户端用 `ratioToSize` 映射成尺寸再发过来（forme-taro/src/data/catalog.ts）。
 * 这个值以前**完全不校验**，原样进 JSON body / multipart 传给上游。
 *
 * 这里判两件事，都只跟「物理上说不说得通」有关：
 *   1. 形状：必须是 `宽x高`。`'1:1'` 这种比例串发过来会被上游当尺寸用。
 *   2. 边界：单边在 [MIN_EDGE, MAX_EDGE] 内。`99999x99999` 会让上游
 *      按请求去算一张巨大的图 —— 计费是按**张**算的，这部分成本全在平台身上。
 *
 * ⚠️ 为什么**不做**「只允许产品的那 6 个尺寸」的白名单：
 *    上游到底接受哪些尺寸，目前**没有任何地方能查到**（API.md 里只有示例，
 *    没有枚举）。白名单就成了「把猜测写成契约」：既拦不住上游真会拒的尺寸，
 *    又可能挡掉上游明明接受的尺寸（`smoke.mjs` 就在用 512x640）。
 *    判据必须和被守护的东西同源 —— 这里能被确证的只有「形状」和「边界」。
 *
 *    客户端那 6 个尺寸由 `npm run preflight` 的 9.5 保证「服务端一定接受」，
 *    它用的是**本文件的同一个函数**，不是另抄一份清单。
 *
 * 不静默收敛到某个尺寸：那会让用户拿到一张比例不对、但看起来正常的图 ——
 * 正是这个项目最怕的失败方式。（`n` 可以静默 clamp，是因为「4 张」和
 * 「99 张」都是明确的数量，而一个坏尺寸没有「就近的合法值」可言。）
 */

/**
 * 单边下限。**这是个体检项，不是产品口径** —— 小的图不花钱也不占资源，
 * 挡它只是为了拦住 0 / 1 这种退化输入。
 *
 * 取 64 而不是更大：`scripts/smoke.mjs` 的资金安全用例一直用 `64x64` 当
 * 「最小但合法」的尺寸（8 处）。把下限抬到它上面，就等于让新规则和自家
 * 测试套件对着干 —— 那种时候该改的是规则，不是把测试改成迁就规则。
 */
export const MIN_EDGE = 64
/** 单边上限。这是**成本/被滥用**的界，不是「上游支持的界」，将来要放宽改这一行 */
export const MAX_EDGE = 2048

/** 客户端没带 size 时用（4:5），与海报页的默认方向一致 */
export const DEFAULT_SIZE = '1024x1280'

/**
 * 判一个 size 合不合法。**不抛异常** —— 部署前的静态检查（preflight 9.5）
 * 也要用它，那边不需要 try/catch。
 *
 * @returns {{ok: true, size: string} | {ok: false, reason: string}}
 */
export function inspectSize(value) {
  const size = String(value ?? '').trim()
  if (!size) return { ok: true, size: DEFAULT_SIZE }

  const matched = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size)
  if (!matched) {
    return {
      ok: false,
      reason: `出图尺寸必须是「宽x高」，收到的是「${size}」。比例要在客户端映射成尺寸后再发过来`
    }
  }

  const width = Number(matched[1])
  const height = Number(matched[2])
  if (width < MIN_EDGE || height < MIN_EDGE) {
    return {
      ok: false,
      reason: `出图尺寸太小：${size}。单边不能小于 ${MIN_EDGE}（实际 ${Math.min(width, height)}）`
    }
  }
  if (width > MAX_EDGE || height > MAX_EDGE) {
    return {
      ok: false,
      reason: `出图尺寸太大：${size}。单边不能大于 ${MAX_EDGE}（实际 ${Math.max(width, height)}）`
    }
  }

  // 归一化成一个确定写法，避免 '1024X1536' / '1024 x 1536' 这类变体
  // 以不同形态进日志和幂等记录
  return { ok: true, size: `${width}x${height}` }
}

/**
 * 边界上用。合法 → 归一化后的尺寸；非法 → 400 `invalid_size`。
 *
 * 调用点在 `runImageTask` 里、**预扣之前**（和「限流必须在 reserveCharge
 * 之前」同一条道理：用户不该为一次注定失败的请求付钱）。
 */
export function normalizeSize(value) {
  const verdict = inspectSize(value)
  if (!verdict.ok) throw badRequest(verdict.reason, 'invalid_size')
  return verdict.size
}
