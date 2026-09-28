/**
 * 密钥形态校验（纯函数）
 * ==================================================================
 * 为什么单独成一个模块，而不是写在 preflight.mjs 里？
 *
 * 因为 preflight.mjs 是「脚本」：import 它就会把顶层逻辑跑一遍，读到的是
 * 这台机器上真实的 .env.local。想在测试里验证「占位值会不会被拦」，
 * 就**必须先把真实密钥覆盖成假的** —— 一个测试要去动生产密钥文件，
 * 这种测试没人敢让它常驻。
 *
 * 抽成纯函数之后，smoke 可以直接喂 `verify_only_secret` 这样的假值，
 * 不碰任何真实配置。经验：**校验逻辑能不能被安全地测，是设计问题，
 * 不是测试问题。** 测不了，通常说明它待错了地方。
 *
 * 这里只做「形态」判断，不做「真伪」判断 —— 密钥对不对只有微信知道。
 * 但形态错了 100% 是错的，且形态错导致的失败极难定位：
 * 多一个引号 → HMAC 不匹配 → 支付失败 / 登录 40029，报错里看不出原因。
 */

/** 模板里的占位前缀。锚定开头，避免误伤碰巧含这些片段的真实密钥。 */
const PLACEHOLDER_PREFIX = /^(verify_only|your[_-]|changeme|placeholder|dummy|xxxx)/i

/** 中文占位词。真实密钥不会出现中文。 */
const PLACEHOLDER_ANY = /【待填】|填入|改成|替换|待填/

/** 一眼假的示例值。命中只提醒，不阻断 —— 理论上可能是真值，只是概率极低。 */
const SAMPLE_VALUES = new Set(['1234567890', '0123456789', '12345678', '0000000000'])

const SHAPES = {
  WECHAT_APP_SECRET: { hex32: true, what: 'AppSecret' },
  WECHAT_APP_KEY: { what: '虚拟支付 AppKey' },
  WECHAT_OFFER_ID: { digits: true, what: 'OfferID' },
  LLM_API_KEY: { minLength: 16, what: '上游 API Key' }
}

/**
 * @param {string} name  变量名，用来取形态规则并拼消息
 * @param {string} value 已解析出的值（parseEnvFile 已 trim 过、去过成对引号）
 * @returns {{level:'block'|'warn', message:string, hint:string}|null} null 表示没问题
 */
export function inspectSecret(name, value) {
  if (typeof value !== 'string' || value === '') return null

  if (PLACEHOLDER_PREFIX.test(value) || PLACEHOLDER_ANY.test(value)) {
    return {
      level: 'block',
      message: `${name} 还是模板里的占位值`,
      hint: '这一项没被真正替换掉。从微信后台复制真实值，整行替换'
    }
  }

  // 引号/空格残留。成对的引号会被 parseEnvFile 剥掉，所以走到这里还带着引号，
  // 说明引号**不成对**（`="abc` 这种）；引号内的空格则会被保留。
  // 两种都会让签名对不上，而报错只会说「签名错误」，查起来极痛苦。
  if (/["'\s]/.test(value)) {
    const kind = /["']/.test(value) ? '引号不成对或多余引号' : '值里含空格'
    return {
      level: 'block',
      message: `${name} 含有引号或空格（${kind}）`,
      hint: '只写值本身，不要加引号、不要留尾随空格。这个值会原样参与 HMAC 计算，多一个字符就签名不匹配'
    }
  }

  if (SAMPLE_VALUES.has(value)) {
    return {
      level: 'warn',
      message: `${name} 的值形如示例（${value}）`,
      hint: '确认不是从文档里抄的示例值'
    }
  }

  const shape = SHAPES[name]
  if (shape?.hex32 && !/^[0-9a-f]{32}$/i.test(value)) {
    return {
      level: 'warn',
      message: `${name} 长度/字符集不像 AppSecret（当前 ${value.length} 位）`,
      hint: 'AppSecret 是 32 位十六进制。18 位左右通常是误粘了 AppID'
    }
  }
  if (shape?.digits && !/^\d+$/.test(value)) {
    return {
      level: 'warn',
      message: `${name} 不是纯数字`,
      hint: 'OfferID 是纯数字，误粘了别的字段'
    }
  }
  if (shape?.minLength && value.length < shape.minLength) {
    return {
      level: 'warn',
      message: `${name} 只有 ${value.length} 位，短得不像真实密钥`,
      hint: '确认完整复制了，没被截断'
    }
  }

  return null
}
