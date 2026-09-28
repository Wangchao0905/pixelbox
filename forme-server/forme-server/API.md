# Pixel Box 后端接口契约

服务：`forme-server`（Node 18+，零运行时依赖）
本地默认：`http://127.0.0.1:8787`

小程序端只需要改 `forme-taro/src/config/index.ts` 里的 `apiBaseUrl`，其余代码不用动。

---

## 0. 通用约定

### 请求

| 项 | 值 |
| --- | --- |
| Content-Type | `application/json; charset=utf-8`（上传除外） |
| 鉴权 | `Authorization: Bearer <token>` |
| 幂等 | `X-Request-Id: <uuid>`，或请求体里的 `requestId` |
| 超时建议 | 生成类 120s，其余 10s |

### 响应

成功统一返回业务字段本身（**不套 `data` 信封**），HTTP 200。

失败统一返回：

```json
{
  "ok": false,
  "code": "insufficient_balance",
  "message": "点数不足，本次需要 1.6 点，当前余额 0 点",
  "balance": 0,
  "required": 1.6,
  "imageCost": 0.4
}
```

`required` = 本次请求的图片数 × `imageCost`。`balance` 是**权威余额**，
客户端拿到后直接覆盖本地缓存，不要自己减。

`code` 是机器可读的稳定标识，客户端应该按 `code` 分支，**不要**匹配 `message` 文案。

### 错误码总表

| HTTP | code | 含义 | 客户端应做什么 |
| --- | --- | --- | --- |
| 400 | `bad_request` | 参数缺失或格式错误 | 提示用户，不要重试 |
| 400 | `missing_prompt` | 提示词为空 | 聚焦输入框 |
| 400 | `missing_source_image` | 产品替换未上传素材 | 引导上传 |
| 400 | `invalid_size` | `size` 不是 `宽x高`，或单边超出 64–2048 | 客户端把比例映射成尺寸再发（不要发 `1:1`） |
| 400 | `missing_code` | 登录缺少 code | 重新 `wx.login` |
| 400 | `unknown_plan` | 充值方案不存在 | 刷新商品列表 |
| 400 | `unsupported_type` | 图片格式不支持 | 提示换图 |
| 401 | `unauthorized` | 登录态无效/过期 | 清 token → 重新登录 → 重放一次 |
| 401 | `relogin_required` | 缺少 session_key | 重新登录后再下单 |
| 402 | `insufficient_balance` | 点数不足 | 跳充值页，展示 `required` |
| 403 | `forbidden` | 越权访问他人资源 | 不要重试 |
| 404 | `not_found` | 资源不存在 | 刷新列表 |
| 413 | `payload_too_large` | 请求体过大 | 压缩后重试 |
| 429 | `rate_limited` | 请求太频繁 | 按 `retryAfter` 秒数退避后重试 |
| 502 | `upstream_error` | 上游返回错误 | 可重试一次 |
| 502 | `upstream_unreachable` | 连不上上游 | 稍后重试 |
| 502 | `upstream_timeout` | 上游超时 | 稍后重试 |
| 503 | `upstream_not_configured` | 服务端没配 key | 提示联系客服，不要重试 |

**402 的正确处理方式**：后端返回的 `balance` 就是权威余额，客户端拿到后应直接覆盖本地缓存的余额，不要自己减。

**429 的正确处理方式**：

```json
{ "ok": false, "code": "rate_limited", "message": "操作太频繁，请 42 秒后再试", "retryAfter": 42 }
```

响应头同时带标准的 `Retry-After`。被限流的请求**不会扣费** ——
限流校验发生在预扣之前，所以用户不会「钱花了但没出图」。
客户端按 `retryAfter` 退避即可，不要立刻重试（会继续被拦）。

限流维度：出图/上传/下单按用户，登录与全站兜底按 IP。
阈值见 `RATE_LIMIT_*` 环境变量。`/api/health`、`/api/pay/notify`、
`/api/files/*` 不参与全局限流 —— 前者是监控依赖，中者是微信平台回调，
后者是图片直出（滚动资产库时会瞬间几十个请求）。

---

## 1. 登录

### `POST /api/login`

无鉴权。

```json
{ "code": "wx.login 返回的 code" }
```

```json
{
  "token": "64 位十六进制字符串",
  "expiresIn": 604800,
  "user": { "id": "u_1a2b3c...", "openid": "oXXXX", "isNew": true }
}
```

`isNew` 为 `true` 时是首次登录，可用于发新人点数或引导。

### `POST /api/logout`

需要鉴权。登出后原 token **立即**失效。

```json
{ "ok": true }
```

### `GET /api/profile`

需要鉴权。

```json
{
  "user": { "id": "u_1a2b3c...", "openid": "oXXXX" },
  "balance": 25.2,
  "passExpiresAt": "2026-10-18T07:24:37.185Z",
  "imageCost": 0.4
}
```

`passExpiresAt` 为 `null` 表示没有有效的创作权益。

---

## 2. 账户

### `GET /api/account`

需要鉴权。返回余额、权益与流水。

```json
{
  "balance": 25.2,
  "passExpiresAt": "2026-10-18T07:24:37.185Z",
  "imageCost": 0.4,
  "transactions": [
    {
      "id": "hold_xxx",
      "type": "generate",
      "title": "图片生成",
      "amount": -0.8,
      "status": "done",
      "balanceAfter": 25.2,
      "createdAt": "2026-09-18T07:24:39.500Z"
    },
    {
      "id": "pass_xxx",
      "type": "pass",
      "title": "30 天创作权益",
      "amount": 0,
      "status": "done",
      "balanceAfter": 26,
      "createdAt": "2026-09-18T07:24:38.001Z"
    },
    {
      "id": "recharge_xxx",
      "type": "recharge",
      "title": "pass-starter 充值",
      "amount": 26,
      "status": "done",
      "balanceAfter": 26,
      "createdAt": "2026-09-18T07:24:38.000Z"
    }
  ]
}
```

> 上面的时序：新用户余额 0 → 买「轻量创作」（30 元 / 26 点 / 30 天），
> 到账 26 点 → 生成 2 张图扣 0.8 点 → 余 25.2 点。
> 一笔有效期道具订单会**产生两条流水**：`recharge` 记点数到账，
> `pass` 记权益发放（`amount` 恒为 0，`balanceAfter` 与前者相同）。

`type` 取值：`generate`（图片生成）、`edit`（产品替换）、`recharge`（充值）、`pass`（权益发放，`amount` 恒为 0）、`refund`（退款回收）。

`amount` 负数=扣费，正数=到账。

`status` 有三个取值，但**只有两种会出现在这个列表里**：

| status | 含义 | 客户端能看到吗 |
| --- | --- | --- |
| `pending` | 预扣已生效、上游还在跑（或进程在结算前挂了） | **能** |
| `done` | 已结算，这笔钱真的花了 / 真的到账了 | 能 |
| `released` | 已回滚，钱还给了用户 | **不能**，列表里过滤掉了 |

> ⚠️ **不要假设 `status` 恒为 `done`。** 出图是「预扣 → 上游调用 → 结算或回滚」，
> 上游最长可以跑 180 秒，这段时间里流水就是 `pending`。客户端在这期间刷新
> `/api/account` 就会拿到 `pending` 记录，界面上应该显示成「处理中」而不是
> 「已扣费」——否则用户会以为一次还没出图的生成已经花掉了钱。
>
> `released` 才是「这笔从未发生」：被回滚的扣费不会出现在列表里。
> 进程在结算前崩溃留下的 `pending` 会在**下次启动时自动转为 `released`**
> 并退还给用户（见 README 第 5 节），所以 `pending` 不会永远留着。

> 注意：不要用 `/api/account/balance`，那个接口不存在。余额从这里或 `/api/profile` 取。

---

## 3. 商品目录

### `GET /api/catalog`

无鉴权。**价格与时长以服务端为准**，客户端不参与定价。

```json
{
  "plans": [
    {
      "planId": "pass-starter",
      "kind": "pass",
      "name": "轻量创作",
      "productId": "forme_pass_30d_30pts",
      "priceFen": 3000,
      "points": 26,
      "durationDays": 30,
      "note": "30 天内有效 · 优先生成 · 含 26 点 · 约 65 张图片"
    },
    {
      "planId": "pass-pro",
      "kind": "pass",
      "name": "专业创作",
      "productId": "forme_pass_30d_100pts",
      "priceFen": 10000,
      "points": 88,
      "durationDays": 30,
      "note": "30 天内有效 · 商用授权 · 含 88 点 · 约 220 张图片"
    },
    {
      "planId": "points-100",
      "kind": "points",
      "name": "88 点",
      "productId": "forme_points_100_once",
      "priceFen": 10000,
      "points": 88,
      "durationDays": 0,
      "note": "一次性到账 · 约 220 张图片"
    },
    {
      "planId": "points-500",
      "kind": "points",
      "name": "440 点",
      "productId": "forme_points_500_once",
      "priceFen": 50000,
      "points": 440,
      "durationDays": 0,
      "note": "一次性到账 · 约 1100 张图片"
    }
  ],
  "imageCost": 0.4,
  "maxBatch": 4,
  "passDays": 30,
  "aigc": {
    "label": "AI 生成",
    "provider": "Pixel Box"
  }
}
```

- `kind`：`pass` = 有效期道具（一次性购买，含点数 + N 天权益），`points` = 纯点数档。客户端按 `kind` 分组展示。
- `durationDays`：0 表示不发放权益。
- `passDays`：有效期道具的标准天数，展示文案用。
- `priceFen` 单位是**分**，展示时除以 100。
- `note` 里的「约 N 张图片」由服务端按 `IMAGE_COST` 现算（`Math.floor(points / imageCost)`），
  **不要在客户端写死张数**——单价一调就会变成错的承诺。
  （客户端只在 `useMockGeneration` 的离线兜底目录里复刻同一算式，联调时也走服务端返回值。）
- 计价基准：**单张图 0.4 点，点数以套餐为准**。30 元档 26 点 / 65 张，
  100 元档 88 点 / 220 张，500 元档 440 点 / 1100 张。售价不变，预留 12% 渠道费。
  `planId` / `productId` 保留历史标识，旧订单按原快照发货；MP 商品名称和描述需同步新点数。
- `imageCost` 可以是小数（当前就是 `0.4`），客户端**不要**假设它是整数，
  也不要把余额乘 100 转成分：`balance` 与 `imageCost` 同单位，都是「点」，保留两位小数。
- `aigc` 是 AIGC 标识口径，客户端**不要自己写死**「AI 生成」这几个字：服务端改了文案，
  已经装在用户手机上的旧版本也要跟着变。这个字段有三处消费方，都要用它：

  | 用途 | 位置 |
  | --- | --- |
  | 界面上的可见标识（第四条） | 结果页大图、资产库缩略图 |
  | 导出文件里合成进像素的标识（第四条末段） | 保存到相册、资产页预览 |
  | 隐式标识的署名主体 | 服务端落盘时写入，见 `src/aigc.mjs` |

  > **结果页的缩略条刻意不打标**（2026-09-20 定）：缩略图只有 56px 宽，`is-compact`
  > 角标实测要占掉 55% 宽度，把图盖住了；而缩略图是「选哪张」的按钮，不是用来看的
  > —— 这一批的**每一张**都会逐张在大图上带标识显示。资产页的缩略图**仍然每张都带**：那一页整页
  > 只有缩略图，去掉就等于整页没有可见标识，性质不同。**改任一处前先想清楚这个区别。**
  >
  > ⚠️ 这里刻意**不写具体张数**。张数由客户端决定（`forme-taro` 三个创作页的
  > `BATCH_SIZE`，当前是 1），服务端只按 `n` 计费、不认「一批几张」这个产品口径；
  > 写死「4 张」的文档会在张数一改时变成错的，而合规条款本身与张数无关。

  > 导出路径要**逐条收口**。容易漏的是资产页的图片预览：微信 `previewImage`
  > 自带长按菜单「保存图片 / 发送给朋友」，是一条绕过客户端的下载路径，
  > 所以预览的必须是**已合成标识的副本**而不是原图。
  > 详见 `forme-taro/src/services/export-image.ts`。

> 服务端不返回「订阅」概念。微信虚拟支付的 `mode` 固定为 `short_series_goods`，没有续费字段，所以包月只能做成一次性购买的 30 天道具——**不要在小程序里写「每月自动续费」**，那是做不到的承诺。

---

## 4. 素材

### `POST /api/upload`

需要鉴权。`Content-Type: multipart/form-data`，字段名 `file`。
对应小程序 `wx.uploadFile`（`Taro.uploadFile`）。

```
字段: file      文件内容
Header: Authorization: Bearer <token>
```

```json
{
  "fileId": "f_abc123",
  "url": "https://your-domain/api/files/f_abc123",
  "size": 588234,
  "mime": "image/png"
}
```

上传即过内容安全审核，违规会返回 400，**不消耗点数**。

### `GET /api/files/:fileId`

无鉴权。直接返回图片二进制，带长缓存头。

---

## 5. 生成

### `POST /api/generate-image`

需要鉴权。

```json
{
  "prompt": "深色背景上的极简产品海报，lime 色高光",
  "model": "gpt-image-1",
  "quality": "high",
  "size": "1024x1280",
  "n": 2,
  "requestId": "客户端生成的 uuid",
  "asset": { "title": "晨间海报", "skill": "poster", "templateId": "editorial-dark" }
}
```

- `n` 会被服务端收敛到 `maxBatch`（默认 4），**不会报错**，以响应里的 `batch` 为准。
- `size` 必须是 `宽x高`，单边 64–2048，否则 **400 `invalid_size`**，且判定在**扣费之前**。
  比例（`1:1` / `9:16` …）是**给用户看的**，要在客户端映射成尺寸再发过来 ——
  服务端不认识比例，会当成尺寸原样发给上游。
  这里**不做**「只允许某几个尺寸」的白名单：上游接受哪些尺寸没有可查的依据，
  白名单等于把猜测写成契约。服务端判的是形状和边界。
- `requestId` 必填，用于幂等。**重放必须复用同一个 `requestId`** ——
  服务端的幂等键是 `kind:userId:requestId`，同一个 id 重放会返回缓存结果、
  **不再扣费**；换一个新 id 重试就是一笔全新的请求，**会再扣一次钱**。
  幂等只在「同一个 id」这个前提下成立。服务端无从判断两个不同 id 的请求
  到底是「重试」还是「用户想要新的一批」，**这个判断只能由客户端做**。

  > 客户端的判定规则（`forme-taro/src/services/request-key.ts`）：
  > 按请求内容算指纹，**上一次失败就复用同一个 id（这是重试），
  > 上一次成功才换新 id（这是再生成一批）**。内容变了则视为新意图，换新 id。
  > 曾经客户端每次调用都发新 id，等于把服务端的幂等彻底架空：
  > 用户网络超时后点一次「重试」就被多扣一次钱。
- `asset` 可选，传了才会进资产库。

```json
{
  "images": [
    { "url": "https://your-domain/api/files/f_xxx", "fileId": "f_xxx", "revisedPrompt": "..." }
  ],
  "balance": 25.2,
  "charged": 0.8,
  "imageCost": 0.4,
  "batch": 2
}
```

`charged` = `batch` × `imageCost`。被限流或上游失败的请求**不会出现在这个字段里**——
限流校验在预扣之前，上游失败会整笔回滚，两种情况下 `balance` 都保持原值。

幂等命中时响应多一个 `"idempotent": true`，`balance` 是当时的余额（**不会重复扣费**）。

### `POST /api/edit-image`

需要鉴权。参数同上，但用 `fileIds` 替代素材：

```json
{
  "prompt": "把产品放进北欧风格厨房，自然光，浅景深",
  "fileIds": ["f_abc123"],
  "size": "1024x1280",
  "n": 1,
  "requestId": "uuid"
}
```

`fileIds` 必须先通过 `/api/upload` 拿到，**不能传本地临时路径**。为空返回 400 `missing_source_image`。

响应结构与 `/api/generate-image` 相同。

---

## 6. 资产库

入库时机：出图**结算成功后**由服务端自动写入（`image.mjs` 的 `saveAsset`）。
只有请求里带了 `asset.title` 才会入库，所以「不入库」不需要单独的开关。
每个用户最多保留 **100 条**，`GET /api/assets` 一次最多返回 **50 条**。

### `GET /api/assets`

需要鉴权。

```json
{
  "assets": [
    {
      "id": "asset_mu6p72k2723df16c",
      "title": "晨间海报",
      "skill": "poster",
      "templateId": "poster-editorial",
      "images": ["https://your-domain/api/files/f_xxx", "https://your-domain/api/files/f_yyy"],
      "createdAt": "2026-09-18T08:29:57.555Z"
    }
  ]
}
```

`images` 是**绝对 URL**，可以直接喂给 `<Image src>`。顺序与生成响应里的 `images` 一致。

### `DELETE /api/assets/:assetId`

需要鉴权。已删除或不存在返回 **404**。

```json
{ "ok": true }
```

### 客户端约定（重要）

**服务端列表是权威的，本地缓存只是离线兜底。** 这三条踩过坑，不要改：

- **在线时用服务端列表整体覆盖本地缓存，不要合并。** 合并会让用户在别的设备上
  删掉的作品在本机复活，用户会认为删除没生效。
- **`DELETE` 的 404 要当成删除成功。** 本机缓存里的 id 和服务端的 id 本来就可能
  对不上（服务端是 `asset_xxx`，本机是「模板名 + 时间戳」）。不幂等的话，用户会
  陷入「点了删除但它一直在」的状态。
- **离线降级时不要允许删除。** 本机残留的 id 拿到服务端去删只会 404，
  删完联网一刷新又回来了。正确做法是明确告诉用户「现在看到的是本机残留，
  不是全部」，并禁掉删除入口——**悄悄少显示几张，用户会以为作品丢了**。

---

## 7. 虚拟支付（个人主体 · 道具直购）

三条链路：**下单 → 发货推送 → 兜底查单**，外加**退款回收**。

> **iOS 前置要求**：iOS 端虚拟支付需要微信客户端 **≥ 8.0.68**，且需在 MP 后台配置**小程序简称**
> 才能开通 Apple IAP。客户端必须在**下单之前**校验版本——先下单再校验会留下永远不会支付的
> 垃圾订单，而虚拟支付订单在平台侧有记录，清理很麻烦。

### 7.1 `POST /api/pay/order` 下单

需要鉴权。

```json
{ "planId": "points-100" }
```

```json
{
  "orderId": "Tmu6mx6qt4875165e",
  "planId": "points-100",
  "kind": "points",
  "points": 88,
  "durationDays": 0,
  "priceFen": 10000,
  "payData": {
    "signData": "{\"offerId\":\"...\",\"buyQuantity\":1,...}",
    "mode": "short_series_goods",
    "paySig": "64 位十六进制",
    "signature": "64 位十六进制"
  }
}
```

`kind` / `points` / `durationDays` 在**下单时快照**，发货时不再回查目录——目录会随运营改配置，订单必须自包含。

`payData` **原样**传给小程序虚拟支付组件，四个字段一个都不能改：

```js
Taro.requestVirtualPayment({
  signData: payData.signData,
  mode: payData.mode,
  paySig: payData.paySig,
  signature: payData.signature,
  success: () => { /* 只做 UI 反馈，不要据此发货 */ },
  fail: ({ errMsg }) => { /* 用户取消等情况 */ }
})
```

> ⚠️ 不要用 `success` 回调作为到账依据。用户付完立刻杀进程会丢回调。
> 到账必须靠轮询 `GET /api/pay/order/:orderId` 或 `GET /api/account`。

### 7.2 `GET /api/pay/order/:orderId` 查单

需要鉴权，只能查自己的单（否则 403）。支付完成后客户端应轮询这个接口，直到 `status` 变成 `delivered`。

```json
{
  "orderId": "Tmu6mx6qt4875165e",
  "status": "delivered",
  "kind": "points",
  "points": 88,
  "durationDays": 0,
  "priceFen": 10000,
  "planId": "points-100",
  "wxOrderId": "wx_order_smoke_001",
  "createdAt": "...",
  "deliveredAt": "...",
  "refundedAt": null
}
```

`status`：`pending`（未支付）→ `delivered`（已到账）／`refunded`（已退款）。

建议轮询：间隔 1s，最多 10 次；仍为 `pending` 则提示「支付结果确认中，稍后可在点数明细查看」。

### 7.3 `GET /api/pay/orders` 订单列表

需要鉴权。

```json
{
  "orders": [
    {
      "orderId": "...",
      "planId": "points-100",
      "kind": "points",
      "status": "delivered",
      "points": 88,
      "durationDays": 0,
      "priceFen": 10000,
      "createdAt": "...",
      "deliveredAt": "...",
      "refundedAt": null
    }
  ]
}
```

### 7.4 `POST /api/pay/notify` 平台推送（微信服务器调用）

**小程序端不需要调这个接口。** 它由微信平台调用，无用户登录态；服务端校验
消息 Token 对应的 `signature`、`timestamp`、`nonce`。同一地址按 `Event` 分发发货与退款。

#### `GET` 同一个地址：URL 验证握手

MP 后台【开发与服务 → 开发管理 → 消息推送】点「保存」时，微信会向这个地址发一个 **GET**，
带 `signature` / `timestamp` / `nonce` / `echostr`，要求**原样返回 `echostr`**。
验签通过才算接入生效；答不上来后台就报「配置失败」，配置根本存不下去 ——
发货推送与退款推送都永远配不上。

签名算法（官方文档）：把 `Token`、`timestamp`、`nonce` 三个参数按字典序排序、拼接、取 sha1。

| 情况 | 响应 |
| --- | --- |
| 验签通过 | `200`，响应体是原样的 `echostr`（不加引号、不加换行） |
| `signature` 不匹配 | `403` |
| 缺 `echostr`（有人直接 curl） | `400` + 说明 |
| 服务端没配 `WECHAT_MSG_TOKEN` | `503` + 说明缺哪个变量 |

> GET 握手和 POST 推送都校验消息签名；发货再用 `query_order` 主动查单交叉确认。
>
> 只支持**明文模式 + XML**。若后台配成了安全模式或 JSON，服务端会在日志里
> 打出可执行的修复提示，而不是只报一句「缺少 OutTradeNo」。

#### 发货推送 `xpay_goods_deliver_notify`

请求体是 XML：

```xml
<xml>
  <Event><![CDATA[xpay_goods_deliver_notify]]></Event>
  <OpenId><![CDATA[oXXXX]]></OpenId>
  <OutTradeNo><![CDATA[Tmu6mx6qt4875165e]]></OutTradeNo>
  <GoodsInfo><ProductId><![CDATA[forme_points_100_once]]></ProductId><Quantity>1</Quantity></GoodsInfo>
</xml>
```

响应必须是 XML，且必须是 HTTP 200（否则平台会一直重试，最多 15 次）：

```xml
<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>
```

处理策略（实现在 `src/pay.mjs`）：

1. `wx_order_id` 幂等——同一笔支付多次通知只发货一次；
2. **主动调 `query_order` 交叉确认**——即使推送签名正确，发货仍以平台支付状态为准；
3. 平台单号冲突时拒绝发货并告警；
4. 已退款的订单拒绝发货（否则等于白送）；
5. **点数到账 + 发放权益 + 改订单状态是单次原子写入**——拆成多次写入的话，进程在中间崩掉会留下「订单仍 pending 但点数已加」的状态，平台重试就会重复加点。

#### 退款推送 `xpay_refund_notify`

Android 端由开发者在 MP 后台【虚拟支付 → 交易订单】主动退款（或用 `refund_order` 接口）；iOS 端用户向 App Store 申请，开发者无法主动退款。两种方式成功后都会推 `xpay_refund_notify`。

```xml
<xml>
  <Event><![CDATA[xpay_refund_notify]]></Event>
  <OpenId><![CDATA[oXXXX]]></OpenId>
  <MchOrderId><![CDATA[Tmu6mx6qt4875165e]]></MchOrderId>
  <WxOrderId><![CDATA[wx_order_xxx]]></WxOrderId>
  <RefundFee>10000</RefundFee>
  <RetCode>0</RetCode>
</xml>
```

处理策略：

1. 标记订单为 `refunded`，并把本单发放的点数**回收**；
2. 回收**下限为 0**——用户可能已经把点花掉了，强行扣成负数会破坏「余额永不为负」这条不变量（出图扣费逻辑依赖它）；
3. 收不回来的部分记为 `shortfall`，写进订单并**打 error 日志**，由人工追损，而不是悄悄算平；
4. 权益不自动撤销（用户可能已经用权益做了合法创作），是否收回属于业务决策，服务端只记录；
5. 幂等——重复推送只回收一次。

> POST 推送须带 `signature`、`timestamp`、`nonce` 并通过消息 Token 校验。
> 退款还须 `RetCode=0`、`RefundFee` 等于本单价格，且订单号、OpenId 和已记录的
> 微信单号匹配。当前只支持全额退款；真实退款推送字段仍需首笔现场核对。

### 7.5 模拟支付与模拟退款

**仅在 `MOCK_WECHAT=1` 时存在**，用于本地联调。真实退款推送无法在本地复现，没有模拟入口退款回收逻辑就完全测不到。

生产环境（`MOCK_WECHAT=0`）下这两条路由**根本不会注册**，请求得到的是 404 而不是 403。
理由：这两条能凭空给订单发货/退款，属于「只要可达就是漏洞」的接口。
做成「不存在」而不是「存在但拒绝」，可以保证将来即使有人重构时误删了内层守卫，
也不会直接变成免费发点数的洞。

#### `POST /api/pay/mock-pay`

```json
{ "orderId": "Tmu6mx6qt4875165e" }
```

```json
{ "ok": true, "balance": 26, "passExpiresAt": "2026-10-18T...", "points": 26, "durationDays": 30 }
```

#### `POST /api/pay/mock-refund`

```json
{ "orderId": "Tmu6mx6qt4875165e", "reason": "用户申请" }
```

```json
{ "ok": true, "clawedBack": 87.2, "shortfall": 0.8, "balance": 0, "wasDelivered": true }
```

`clawedBack` = 实际回收的点数，`shortfall` = 收不回来的部分（用户已消费）。
上面这笔是 88 点档被退了款，但用户已经出过 2 张图（0.8 点）——只能收回 87.2 点，
0.8 点成为缺口。缺口 > 0 时服务端会**打一条 critical 告警**（见 `ALERT_WEBHOOK_URL`）。

### 7.6 上线前必须在 MP 后台配置

| 配置 | 位置 |
| --- | --- |
| 开通条件 | 个人主体 + 中国大陆居民身份证 + 服务类目含「工具」+ 已完成认证、备案 |
| OfferID | 虚拟支付 → 基础配置 |
| AppKey（现网） | 虚拟支付 → 基础配置 |
| 道具 `productId` / 价格 | 虚拟支付 → 道具管理，必须与 `src/catalog.mjs` 完全一致 |
| 发货回调地址 | 指向 `https://<域名>/api/pay/notify`，必须是 HTTPS，配在【开发管理 → 消息推送】 |
| 消息推送 Token | 同上页面，自己定，必须与 `.env` 的 `WECHAT_MSG_TOKEN` 逐字一致 |
| 数据格式 / 加解密 | 同上页面，必须选 **XML** + **明文模式**，否则服务端解析不了 |
| 小程序简称 | 账号设置 → 基本信息。**iOS 支付必需**（Apple 需展示 display name） |

`goodsPrice` 与后台不一致会被平台拒单；`productId` 不一致会支付失败。**改价时两边都要改。**

其他必须知道的事实：

- **月支付限额 10 万元**（个人主体，全终端）
- 当前生效费率：Android 等主动支付 **1%**，iOS **12%**（Apple 佣金）。
  来源：[微信官方个人主体虚拟支付文档](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person)，2026-09-24 核验。
  标准费率与当前优惠费率不同；后续费率变化需重算点数，以实际账单为准。
- 结算：Android T+3，iOS 约 45–60 天
- 手续费：180 天以内的退款平台退还手续费，超过 180 天不退
- 不支持需办理电信业务资质的服务（电子邮件、语音信箱、信息发布平台、信息搜索查询等）

---

## 8. 运维接口

### `GET /api/health`

无鉴权。用于探活与启动自检。

```json
{
  "ok": true,
  "service": "forme-server",
  "time": "2026-09-18T07:24:37.185Z",
  "mock": { "wechat": true, "llm": true },
  "securityMode": "log",
  "imageCost": 0.4,
  "initialBalance": 0,
  "rateLimitEnabled": true,
  "problems": [],
  "notices": []
}
```

`problems` 非空时进程**不会启动**（启动自检直接 `exit(1)`）。`notices` 只是提醒。

`imageCost` / `initialBalance` / `rateLimitEnabled` 是给运维看的策略快照 ——
上线后想确认「单价」「限流开着」有没有真的生效，`curl` 一下这里就行，
不用去翻服务器上的 env 文件。这几个值都不是机密，所以不鉴权。

---

## 9. 配置项

`.env.local`（优先级高于 `.env`）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址。**生产裸机必须 `127.0.0.1`**，否则限流可被伪造 IP 绕过 |
| `ALLOW_PUBLIC_BIND` | `0` | 仅 Docker 内网方案设 `1`，表示知悉绑了 `0.0.0.0` |
| `DATA_DIR` | `./data` | 数据目录。生产必须挂持久卷 |
| `MOCK_WECHAT` | `1` | 1=不调微信接口。**生产必须为 0** |
| `MOCK_LLM` | `1` | 1=返回本地占位图。**生产必须为 0** |
| `SECURITY_MODE` | `log` | `off` / `log` / `enforce`。**生产必须 `enforce`** |
| `INITIAL_BALANCE` | `0` | 新用户初始点数。默认 `0`（不赠送） |
| `IMAGE_COST` | `0.4` | 单张图消耗点数。充值点数以套餐为准。必须是 > 0 的有限数。**可以是小数**：余额与流水一律两位小数记账 |
| `RATE_LIMIT_ENABLED` | `1` | **生产必须为 1** |
| `RATE_LIMIT_GENERATE_PER_MINUTE` | `20` | 出图（generate + edit 共用额度） |
| `RATE_LIMIT_UPLOAD_PER_MINUTE` | `30` | 上传 |
| `RATE_LIMIT_ORDER_PER_MINUTE` | `10` | 下单 |
| `RATE_LIMIT_LOGIN_PER_MINUTE` | `30` | 登录（按 IP） |
| `RATE_LIMIT_GLOBAL_PER_MINUTE` | `300` | 兜底（按 IP） |
| `WECHAT_APPID` | — | 小程序 AppID |
| `WECHAT_APP_SECRET` | — | `code2Session` 用 |
| `WECHAT_OFFER_ID` | — | 虚拟支付 OfferID |
| `WECHAT_APP_KEY` | — | 虚拟支付现网 AppKey |
| `WECHAT_ENV` | `0` | 0=现网 |
| `WECHAT_PAY_NOTIFY_URL` | — | 发货/退款回调地址，路径必须是 `/api/pay/notify` |
| `WECHAT_MSG_TOKEN` | — | 消息推送的 Token。用于应答后台保存配置时的 URL 验证（GET 带 `echostr`）。必须与 MP 后台填的逐字一致 |
| `LLM_API_KEY` | — | 出图上游 key |
| `LLM_BASE_URL` | `https://llm-api.net` | 出图上游地址（OpenAI Images 兼容） |
| `LLM_TIMEOUT_MS` | `180000` | 上游超时 |
| `ALERT_WEBHOOK_URL` | — | 告警地址。留空则只写日志 |
| `ALERT_WEBHOOK_FORMAT` | `generic` | `generic` / `wecom` / `dingtalk` / `feishu` |
| `AIGC_METADATA` | `1` | 出图落盘时写入 AIGC 隐式标识。**生产必须为 1** |
| `AIGC_PROVIDER` | `Pixel Box` | 隐式标识里的服务提供者名称。为空会阻止启动 |
| `AIGC_EXPLICIT_LABEL` | `AI 生成` | 显式标识文案，随 `/api/catalog` 下发给客户端 |

在 `NODE_ENV=production` 下，以下任一情况会**直接阻止启动**（这是有意的门禁）：

- `MOCK_WECHAT=1` 或 `MOCK_LLM=1`
- `SECURITY_MODE=log` 或 `off`
- `RATE_LIMIT_ENABLED=0`
- `HOST=0.0.0.0` 且未设 `ALLOW_PUBLIC_BIND=1`
- `AIGC_METADATA=0`（等于不出标识，违反《人工智能生成合成内容标识办法》第五条）
- `AIGC_PROVIDER` 为空（隐式标识三要素缺一项）
- 缺少 `WECHAT_APP_SECRET` / `WECHAT_APP_KEY` / `WECHAT_OFFER_ID` /
  `WECHAT_PAY_NOTIFY_URL` / `WECHAT_MSG_TOKEN` / `LLM_API_KEY`

---

## 10. 自测

```bash
npm run smoke        # 端到端冒烟（含幂等键契约）
npm run check:aigc   # AIGC 隐式标识的字节级校验（不启服务）
npm run preflight    # 上线前自检（部署后跑，只读无副作用）
```

客户端侧（`forme-taro`）另有两个门禁，改完两边都要跑：

```bash
npm run check:request-key   # 幂等键复用策略（纯逻辑，不启小程序）
npm run release             # typecheck + 上面的 check + 构建 + 产物校验
```

冒烟会拉起**五个隔离实例**（独立端口 + 临时数据目录）跑 **287 项断言**，覆盖：

登录 → 余额 → 上传 → 生成 → 扣费 → 幂等 → 参数校验 → 产品替换 → 资产库 → **AIGC 隐式标识** → 流水 → 下单 → 签名复算 → 发货推送 → 推送幂等 → 异常推送 → 越权 → 模拟支付 → **有效期道具** → **退款回收** → 登出 → 落盘 → 资金安全三专项 → **接口限流** → **新用户送 1 点** → **幂等键契约**

五个实例各有分工：

| 实例 | 端口 | 配置 | 用途 |
| --- | --- | --- | --- |
| main | 8899 | `INITIAL_BALANCE=128`、mock 上游 | 全流程 |
| budget | 8898 | `INITIAL_BALANCE=0.4`（刚好 1 张图）、上游指向死端口 | 余额不足 402、上游失败回滚 |
| wallet | 8897 | `INITIAL_BALANCE=0`、mock 上游 | 退款缺口（点数已被消费） |
| rate | 8896 | 出图 2/min、登录 3/min、全局 20/min | 限流，含「被拦请求不扣费」 |
| fresh | 8890 | **不传** `INITIAL_BALANCE`，走生产默认值 | 新用户余额为 0（不赠送点数） |

`main` / `budget` / `wallet` 三个实例都**显式**传 `INITIAL_BALANCE`
（它们要的起点和默认值不一样，不显式传的话后面的用例会连锁失败）。
`fresh` 是唯一故意不传的实例 —— 它存在的意义就是盯住「默认不赠送」这条策略，
将来谁把默认值改成正数，它会立刻红。

---

## 11. 已知限制（上线前必须处理）

| 项 | 现状 | 需要做什么 |
| --- | --- | --- |
| 文件存储 | 本地磁盘 `data/uploads` | 换 COS/OSS，多实例部署下本地磁盘不共享 |
| 数据存储 | 单进程内存 + JSON 落盘 | 换 Postgres/MySQL，只需替换 `src/store.mjs` |
| 定时查单 | 进程内 `setInterval` | 多实例会重复查单（有幂等保护），建议换成外部定时任务 |
| 权益撤销 | 退款不自动撤销权益 | 若业务上需要收回，在 `store.refundOrder` 里补 |
| 限流存储 | 进程内内存计数 | 多实例部署时换成 Redis，只需改 `src/ratelimit.mjs` |
| 图片直出 | Node 进程读磁盘返回 | 换 CDN，见 `deploy/nginx.conf` 的缓存配置 |
| 自动续费 | 不支持 | 虚拟支付 `mode` 固定 `short_series_goods`，无续费字段。包月只能做成一次性购买的 30 天道具 |


