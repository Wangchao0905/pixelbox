import Taro from '@tarojs/taro'

/**
 * 小程序隐私授权
 * ==================================================================
 * 本项目用到两个隐私接口：
 *   - `wx.chooseMedia`（相册/摄像头）—— 上传产品图
 *   - `wx.saveImageToPhotosAlbum`（写入相册）—— 导出生成结果
 *
 * 没在 MP 后台《用户隐私保护指引》里声明对应类型时，接口会被**直接禁用**
 * 并报 `errno 112`；声明了但用户还没同意时，调用会失败（103/104）。
 * 两种都不能只靠「反正微信会弹官方弹窗」糊过去——用户看到的是报错。
 *
 * ------------------------------------------------------------------
 * 为什么用「主动查询」而不是 `wx.onNeedPrivacyAuthorization`
 * ------------------------------------------------------------------
 * 官方给了两条路：主动查 `getPrivacySetting`，或被动监听
 * `onNeedPrivacyAuthorization`。这里**刻意选前者**，原因是：
 *
 *   微信**没有**提供 `offNeedPrivacyAuthorization`。一旦注册了监听，
 *   就再也摘不掉。而监听回调要求开发者在某个时刻调用
 *   `resolve({ event: 'agree' | 'disagree' })` 来放行被挂起的隐私接口——
 *   如果注册时弹窗组件还没挂载（比如用户在别的页面触发了隐私接口），
 *   这个 resolve 就永远不会被调用，接口会一直 pending。
 *
 *   主动查询没有这个坑：问一次「需不需要授权」，需要就弹自己的窗，
 *   弹窗不在就退化成微信官方弹窗兜底，任何路径都不会把用户卡住。
 *
 * 代价是要自己判断时机，但本项目只有两个触发点，都在用户点按的瞬间，
 * 时机反而更自然（用户知道自己在做什么，而不是凭空弹一个协议）。
 */

/** 同意按钮的 id。基础库会校验这个按钮是否真的被点过，必须与 <Button id> 一致 */
export const AGREE_BUTTON_ID = 'forme-privacy-agree'

export type PrivacyState = {
  visible: boolean
  /** 后台配置的隐私指引名称，例如《像素盒子用户隐私保护指引》 */
  contractName: string
}

let state: PrivacyState = { visible: false, contractName: '' }
let subscriber: ((next: PrivacyState) => void) | null = null
let pendingConsent: ((granted: boolean) => void) | null = null

function publish(next: Partial<PrivacyState>) {
  state = { ...state, ...next }
  subscriber?.(state)
}

/** 弹窗组件订阅状态。返回退订函数 */
export function subscribePrivacy(fn: (next: PrivacyState) => void): () => void {
  subscriber = fn
  // 订阅时立刻同步一次，避免「先触发了授权请求、弹窗才挂载」导致漏弹
  fn(state)
  return () => {
    if (subscriber === fn) subscriber = null
  }
}

/** 查一次：当前用户是否需要同意隐私指引 */
export function checkPrivacyAuthorization(): Promise<{ need: boolean; contractName: string }> {
  return new Promise((resolve) => {
    Taro.getPrivacySetting({
      success: (res: any) => {
        const contractName = String(res?.privacyContractName ?? '')
        if (contractName) publish({ contractName })
        resolve({ need: Boolean(res?.needAuthorization), contractName })
      },
      // 低版本基础库没有这个接口。报错时按「不需要」处理，
      // 让隐私接口自己去走微信的官方兜底弹窗，不要因为查询失败就拦住用户。
      fail: () => resolve({ need: false, contractName: '' })
    })
  })
}

/** 打开《用户隐私保护指引》全文 */
export function openPrivacyContract() {
  Taro.openPrivacyContract({
    fail: () => Taro.showToast({ title: '暂时无法打开隐私协议', icon: 'none' })
  })
}

/**
 * 确认已获得隐私授权。**在调用任何隐私接口之前 await 它。**
 * 返回 false 表示用户明确拒绝，调用方应该中止而不是继续。
 */
export async function ensurePrivacyAuthorized(): Promise<boolean> {
  const { need } = await checkPrivacyAuthorization()
  if (!need) return true

  // 没有弹窗组件挂载时不能把用户卡死：直接放行，交给微信官方弹窗兜底。
  // 正常流程里 UploadSlot / 结果页都会挂载 PrivacyGate，走不到这里。
  if (!subscriber) return true

  publish({ visible: true })
  return new Promise<boolean>((resolve) => {
    pendingConsent = resolve
  })
}

/** 用户点了「同意并继续」。由 open-type="agreePrivacyAuthorization" 的按钮触发 */
export function grantPrivacyConsent() {
  const resolve = pendingConsent
  pendingConsent = null
  publish({ visible: false })
  resolve?.(true)
}

/** 用户点了「暂不」或关闭弹窗 */
export function denyPrivacyConsent() {
  const resolve = pendingConsent
  pendingConsent = null
  publish({ visible: false })
  resolve?.(false)
}

/* ================================================================
   错误翻译
   ================================================================ */

const PRIVACY_ERRNO_MESSAGE: Record<number, string> = {
  103: '需要先同意隐私协议才能继续',
  104: '未同意隐私协议，无法继续',
  112: '隐私接口未在后台声明，请先在小程序后台补充《用户隐私保护指引》'
}

/**
 * 把隐私接口的原始报错翻成人话。
 * 微信给的是 `chooseMedia:fail privacy permission is not authorized` 这种
 * 英文串，直接弹给用户等于没提示；返回 null 表示这不是隐私类错误。
 */
export function privacyErrorMessage(error: unknown): string | null {
  const errno = (error as { errno?: number })?.errno
  if (typeof errno === 'number' && PRIVACY_ERRNO_MESSAGE[errno]) {
    return PRIVACY_ERRNO_MESSAGE[errno]
  }
  const message = String((error as { errMsg?: string })?.errMsg ?? '')
  if (message.includes('privacy')) {
    if (message.includes('not declared')) return PRIVACY_ERRNO_MESSAGE[112]
    return '未同意隐私协议，无法继续'
  }
  return null
}
