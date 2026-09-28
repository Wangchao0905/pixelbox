# FORMÉ: 图片创作扩展交接

## 目标

为微信小程序增加三项彼此区分、共用现有图片生成能力的创作入口：

1. **灵感复刻**：参考图定义视觉，产品图定义主体。
2. **产品拍摄**：把产品变成棚拍、生活方式或人物使用图。
3. **电商主图**：生成白底、纯色或细节特写商品图。

用户用一张自己拥有使用权的视觉参考图定义画面的构图、光影或配色，再上传自己的产品图片。系统生成一张以用户产品为主体、借鉴所选视觉要素的新图。

三个功能都不是泛化的“图生图”，也不承诺复制参考图。它们分别对应清楚的创作任务，而不是让用户先学会提示词。

## 为什么现在做

Higgsfield 的 Marketing Studio 把复杂的提示词工作移到“选模板或参考素材”的输入中。其公开产品把产品图、参考素材和预设作为创作入口，而不是只提供空白提示词框。

本项目已经具备：

- 一张产品图片的上传与 14 个商业场景替换模板。
- 自由生图，支持最多五张参考图片。
- `/api/edit-image` 图生图请求、结果页、资产库和单张收费。

因此 MVP 只需增加明确的任务流程、提示词编排与前端类型；**不要新增图片生成服务端接口**。

TypeSafe Jev 已对候选功能做过两轮结构化判断。排除已有产品替换后，它以 `0.84` 的概率选中灵感复刻为下一项功能；其相对现有入口的新增价值评分为 `2.77 / 3`。产品拍摄和电商主图紧随其后，但必须复用同一套产品上传与单张生成能力。这只是产品优先级依据，不应被放进生成的关键链路。

## 范围

### 必做

1. 新建 `pages/create-reference/index`，标题为“灵感复刻”。
2. 灵感复刻使用两个不可混淆的上传槽位：**产品图片**与**视觉参考**；复刻重点只能选 `构图`、`光影`、`色彩氛围` 之一。
3. 将现有 `product-gallery` 升级为“产品工作室”入口，不删除原有 14 个精选场景。
4. 在产品工作室顶层增加 **产品拍摄** 三模式：`棚拍`、`生活方式`、`人物使用`。
5. 新建 `pages/create-marketplace/index`，提供 **电商主图** 三镜头：`白底主图`、`纯色卖点图`、`细节特写`。
6. 产品拍摄和电商主图均只要求一张产品图；可选一句补充说明，最长 160 字。
7. 三个入口都维持 `BATCH_SIZE = 1`，按钮始终显示“生成 1 张”。
8. 三个入口的结果沿用现有结果页、保存、AIGC 标识与资产库写入。
9. 只有灵感复刻需要权利确认：用户拥有或获准使用视觉参考图，且理解结果不会逐像素复制原图或模仿品牌标识。

### 不做

- 视频、画布、节点工作流、图层编辑、局部选区、抠图。
- 商品网址导入、网页抓取、Logo/品牌信息自动提取。
- 一次生成多张、自动批量投放图或一次支付多次生成。
- 使用客户端密钥直接调用 TypeSafe 或任意第三方服务。
- 将“视觉参考”做成可上传五张的模糊列表；本任务 MVP 固定为一张产品图加一张参考图。

## 用户流程

```text
首页 / 产品页
  -> 灵感复刻
  -> 上传产品图
  -> 上传视觉参考
  -> 选择：构图 | 光影 | 色彩氛围
  -> 可选补充说明 + 权利确认
  -> 生成 1 张
  -> 结果：保存到相册 | 作为参考图 | 再次调整
```

```text
首页
  -> 产品工作室
  -> 产品拍摄
  -> 选择：棚拍 | 生活方式 | 人物使用
  -> 上传产品图 + 可选补充说明
  -> 生成 1 张
  -> 结果：保存到相册 | 作为参考图 | 再次调整
```

```text
首页 / 产品工作室
  -> 电商主图
  -> 选择：白底主图 | 纯色卖点图 | 细节特写
  -> 上传产品图 + 可选补充说明
  -> 生成 1 张
  -> 结果：保存到相册 | 作为参考图 | 再次调整
```

### 页面结构

不要沿用“长段介绍 + 多张说明卡”的旧布局。画面应当让两张输入素材成为主角。

```text
[返回]                         灵感复刻

把喜欢的画面，变成你的产品视觉

产品图片
[ product upload / preview ]

视觉参考
[ reference upload / preview ]

保留什么？
[ 构图 ] [ 光影 ] [ 色彩氛围 ]

补充说明（可选）
[ 输入框 ]

[ 权利确认 ]

固定底部：0.4 点              [ 生成 1 张 ]
```

视觉细节：两个上传槽必须使用不同标题、不同空状态和不同删除操作。不要靠颜色单独区分它们；用户应在读屏、低对比度或截图状态下仍能理解用途。

### 产品工作室的导航与信息架构

不要把三个产品能力塞成平铺的九宫格。`product-gallery` 应先显示三个同级创作意图：

```text
产品工作室
[ 产品拍摄 ] [ 电商主图 ] [ 精选场景 ]
```

- **产品拍摄**：只显示 `棚拍 / 生活方式 / 人物使用` 三张大图，选择后再上传产品。
- **电商主图**：只显示 `白底主图 / 纯色卖点图 / 细节特写` 三张大图，选择后再上传产品。
- **精选场景**：保留现有 14 个 `productReplacementTemplates`；它们是更有风格的高级场景，不与前三种基础功能重复。

## 类型与数据契约

新增 `src/services/reference-recreate.ts`。不要在页面组件里散落字符串、数组下标或提示词模板。

```ts
import type { ImageAsset } from './image-api'

export const RECREATE_FOCUS = ['composition', 'lighting', 'palette'] as const
export type RecreateFocus = (typeof RECREATE_FOCUS)[number]

export type ReferenceRecreateDraft = {
  product: ImageAsset | null
  reference: ImageAsset | null
  focus: RecreateFocus
  note: string
  rightsConfirmed: boolean
}

export type ReferenceRecreateInput = {
  product: ImageAsset
  reference: ImageAsset
  focus: RecreateFocus
  note: string
}

export function canGenerateReferenceRecreate(
  draft: ReferenceRecreateDraft
): draft is ReferenceRecreateDraft & {
  product: ImageAsset
  reference: ImageAsset
  rightsConfirmed: true
} {
  return Boolean(draft.product && draft.reference && draft.rightsConfirmed)
}
```

新增 `src/services/product-studio.ts`，承载产品拍摄与电商主图的固定工作流。不要在 `product-gallery`、`create-product`、`create-marketplace` 各维护一份模式、标题和提示词。

```ts
import type { ImageAsset } from './image-api'

export const PRODUCT_SHOT_MODES = ['studio', 'lifestyle', 'with_model'] as const
export type ProductShotMode = (typeof PRODUCT_SHOT_MODES)[number]

export const MARKETPLACE_SHOTS = ['white_background', 'color_benefit', 'detail_closeup'] as const
export type MarketplaceShot = (typeof MARKETPLACE_SHOTS)[number]

export type ProductStudioIntent =
  | { kind: 'product-shot'; mode: ProductShotMode }
  | { kind: 'marketplace'; shot: MarketplaceShot }

export type ProductStudioDraft = {
  product: ImageAsset | null
  intent: ProductStudioIntent
  note: string
}

export type ProductStudioInput = {
  product: ImageAsset
  intent: ProductStudioIntent
  note: string
}

export function canGenerateProductStudio(
  draft: ProductStudioDraft
): draft is ProductStudioDraft & { product: ImageAsset } {
  return Boolean(draft.product)
}
```

必须提供并测试下列纯函数：

```ts
export function productStudioTitle(intent: ProductStudioIntent): string
export function productStudioSkill(intent: ProductStudioIntent): string
export function productStudioRatio(intent: ProductStudioIntent): string
export function buildProductStudioPrompt(input: ProductStudioInput): string
export function productStudioEditImages(input: ProductStudioInput): ImageAsset[]
```

`productStudioEditImages()` 永远返回 `[input.product]`。产品主体只能来自用户上传图，提示词必须要求保留轮廓、包装文字、材质、颜色与真实比例。

各工作流的提示词意图：

| 意图 | 结果约束 |
|---|---|
| `studio` | 干净背景、专业棚拍光、自然接触阴影；不出现无关道具。 |
| `lifestyle` | 真实使用环境与道具，但产品始终是清晰主角。 |
| `with_model` | 人物持用、穿戴或使用产品；人物是辅助叙事，不能遮挡产品或改变产品形态。 |
| `white_background` | 纯白或接近白色背景、完整产品、无装饰文字、适合商品列表。 |
| `color_benefit` | 纯色背景、一个明确卖点氛围，产品留有可加商品文案的干净区域；不要由模型生成促销文字。 |
| `detail_closeup` | 放大材质、开口、纹理或关键部件；产品仍可辨认，不虚构包装信息。 |

默认比例：`studio` 与 `white_background` 为 `1:1`；`lifestyle`、`with_model`、`color_benefit` 为 `4:5`；`detail_closeup` 为 `1:1`。页面可在高级设置里让用户改比例，但**不能**将像素尺寸展示给用户。

必须提供下列纯函数，并为它们写单测：

```ts
export function recreateFocusLabel(focus: RecreateFocus): string
export function buildReferenceRecreatePrompt(input: ReferenceRecreateInput): string
export function recreateEditImages(input: ReferenceRecreateInput): ImageAsset[]
```

`recreateEditImages()` 的返回顺序是不可变约定：

```ts
[input.product, input.reference]
```

`buildReferenceRecreatePrompt()` 必须明确传达：

- 第一张图片是唯一产品主体；保留其轮廓、材质、包装比例和可读文字。
- 第二张图片仅用于提取用户选择的视觉要素。
- 只复刻选择项，不能把参考图中的人物、Logo、文字、商标或可识别产品复制进结果。
- 结合用户的 `note`，未填写时不输出 `undefined`、`null` 或空字段描述。

不要把 `focus`、`note` 或两张图的角色直接暴露成路由 query。图片继续通过现有内存状态与上传服务处理。

## 调用现有生成能力

页面在通过 `canGenerateReferenceRecreate()` 后：

```ts
const input: ReferenceRecreateInput = {
  product: draft.product,
  reference: draft.reference,
  focus: draft.focus,
  note: draft.note.trim()
}

const images = await editImages({
  prompt: buildReferenceRecreatePrompt(input),
  model,
  quality,
  size: defaultConfigForRatio(ratio).size,
  n: BATCH_SIZE,
  images: recreateEditImages(input),
  asset: {
    title: '灵感复刻',
    skill: recreateFocusLabel(input.focus),
    templateId: 'reference-recreate'
  }
})
```

再用 `setPendingResult()` 跳转到 `/pages/result/index`。不要在此页面另写扣费、上传、幂等键、保存相册或 AIGC 标识逻辑；这些已集中在 `image-api.ts`、`GenerateDock.tsx`、`result/index.tsx` 与 `export-image.ts`。

产品拍摄与电商主图在通过 `canGenerateProductStudio()` 后，沿用同一出口：

```ts
const input: ProductStudioInput = {
  product: draft.product,
  intent: draft.intent,
  note: draft.note.trim()
}

const images = await editImages({
  prompt: buildProductStudioPrompt(input),
  model,
  quality,
  size: defaultConfigForRatio(productStudioRatio(input.intent)).size,
  n: BATCH_SIZE,
  images: productStudioEditImages(input),
  asset: {
    title: productStudioTitle(input.intent),
    skill: productStudioSkill(input.intent),
    templateId: `product-studio-${input.intent.kind}-${
      input.intent.kind === 'product-shot' ? input.intent.mode : input.intent.shot
    }`
  }
})
```

三个新工作流都必须继续使用 `editImages()`，以复用现有上传、幂等键、扣费与余额同步。不要改为前端先把图片转 Base64，也不要绕过 `/api/edit-image`。

## 需要改动的文件

| 文件 | 修改 |
|---|---|
| `src/app.config.ts` | 新增 `pages/create-reference/index` 与 `pages/create-marketplace/index` 路由。 |
| `src/pages/create-reference/index.config.ts` | 标题“灵感复刻”。 |
| `src/pages/create-reference/index.tsx` | 新页面和状态管理；复用 `AppHeader`、`GenerateDock`、`PrivacyGate`、`OptionPills`。 |
| `src/services/reference-recreate.ts` | 上述类型、标签、验证、提示词与素材排序纯函数。 |
| `src/pages/create-marketplace/index.config.ts` | 标题“电商主图”。 |
| `src/pages/create-marketplace/index.tsx` | 新页面；选择电商主图镜头、上传一个产品、调用 `editImages()`。 |
| `src/services/product-studio.ts` | 产品拍摄与电商主图的联合类型、默认比例、提示词和素材排序纯函数。 |
| `src/pages/product-gallery/index.tsx` | 重构为产品工作室入口；显示产品拍摄、电商主图、精选场景三项；保留 14 个既有模板。 |
| `src/pages/create-product/index.tsx` | 保留现有精选场景生成，不改为通用产品拍摄页。 |
| `src/pages/home/index.tsx` | 明确入口至少包括自由生图、灵感复刻、产品工作室；不移除自由生图。 |
| `src/styles/forme.scss` | 补三个页面的图片优先布局、分段导航和状态样式；不得复制旧首页的卡片网格。 |
| `scripts/test-reference-recreate.mjs` | 纯函数和素材顺序的单测。 |
| `scripts/test-product-studio.mjs` | 产品工作流标题、比例、提示词与 `[product]` 素材顺序单测。 |
| `scripts/test-creator-ui.mjs` | 增加三个入口、单张生成和灵感复刻权利确认的静态结构检查。 |

## 可选的 Jev 接入，非 MVP 阻塞项

Jev 适合做文字判断，不应假装能直接理解未描述的上传图片。若要接入，必须由服务端调用：

1. 小程序只向自有后端发送 `note`、已选择的 `focus` 与候选模板的文字标签。
2. 后端用 `TYPESAFE_API_KEY` 调用 `jev-latest`。
3. Jev 使用 `choice` 对固定候选模板排序，例如“棚拍 / 生活方式 / 编辑海报”。
4. 只有 `confidence >= 0.70` 时展示“推荐”；低于阈值时不阻塞用户，直接展示用户选择。
5. API key 绝不进入 `.env.*` 的 `TARO_APP_*` 变量、前端构建产物或小程序网络请求。

不要让 Jev 决定收费、授权、审核、是否生成或图片内容安全。那些必须由后端的明确规则和模型服务处理。

## 状态、错误与无障碍

- 灵感复刻缺产品图或参考图：生成按钮禁用，分别提示“添加产品图片后继续”或“添加视觉参考后继续”。
- 灵感复刻未确认权利：生成按钮禁用，确认控件有可见标签。
- 产品拍摄与电商主图只缺产品图时禁用生成；它们不显示参考图或权利确认控件。
- 产品工作室切换创作意图时不清除已经上传的产品图，但应更新标题、预览和默认比例。
- 上传取消：不显示错误 toast。
- 上传/生成失败：保留已选图片、选项与文字，不清空草稿。
- 灵感复刻删除图片：仅删除对应槽位，另一个槽位保持不变。
- 所有可点击控件至少 44px 高，焦点、选中和禁用状态不能仅靠颜色表达。
- 确认文案必须简洁，并链接到适用的规则页面；不要将其隐藏在生成请求之后。

## 验收标准

```text
[ ] 首页可进入灵感复刻。
[ ] 首页或产品工作室可进入产品拍摄与电商主图。
[ ] 产品图与参考图的角色在视觉和代码上都不可混淆。
[ ] 两张图、一个 focus、权利确认缺失时均不能生成。
[ ] 产品拍摄与电商主图只要求一张产品图，缺图时不能生成。
[ ] 默认只生成 1 张，点数显示继续来自 BATCH_SIZE 和 costForImages。
[ ] editImages 接收的 images 永远是 [product, reference]。
[ ] 产品拍摄和电商主图的 editImages 接收的 images 永远是 [product]。
[ ] prompt 明确限定第一张图为产品主体、第二张图为视觉来源。
[ ] 六个产品工作流均有固定提示词约束，且用户的可选说明不会覆盖产品保真要求。
[ ] 现有 14 个产品替换模板仍能从“精选场景”访问并正常生成。
[ ] 结果写入资产库，标题为“灵感复刻”。
[ ] 产品拍摄和电商主图的结果以各自工作流标题写入资产库。
[ ] 结果页仍可保存、返回编辑、作为参考图。
[ ] `pnpm exec tsc --noEmit` 通过。
[ ] `pnpm exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/test-reference-images.mjs` 通过。
[ ] 新增 `scripts/test-reference-recreate.mjs` 通过。
[ ] 新增 `scripts/test-product-studio.mjs` 通过。
[ ] `pnpm exec taro build --type weapp` 通过。
[ ] `pnpm exec node scripts/verify-dist.mjs` 无阻断项。
```

## 明确禁止的回归

- 不要把 `BATCH_SIZE` 改回 4。
- 不要在页面展示像素尺寸，例如 `1024x1536`；用户选择的是画面比例。
- 不要让产品图和参考图共用同一个数组状态后靠数组下标猜角色。
- 不要把产品拍摄、电商主图和现有精选场景合并为一串无法区分的模板卡。
- 不要把“白底主图”理解成在前端把图片背景强行抹白；它仍然是一次受提示词约束的图像生成。
- 不要把 TypeSafe 密钥或其他服务端密钥编译到小程序。
- 不要移除已有自由生图的五张参考图能力；它是另一个更开放的创作流程。

---

## 完成情况（2026-09-23 收尾）

对照上面的验收标准逐条核过，**全绿**。每条都有可重跑的证据，不是「看着对」。

```text
[x] 首页可进入灵感复刻。                      → 首页「新功能」轨道第 1 张卡
[x] 首页或产品工作室可进入产品拍摄与电商主图。  → 首页轨道第 2/3 张卡 + 产品工作室顶层 tab
[x] 产品图与参考图的角色在视觉和代码上都不可混淆。
[x] 两张图、一个 focus、权利确认缺失时均不能生成。
[x] 产品拍摄与电商主图只要求一张产品图，缺图时不能生成。
[x] 默认只生成 1 张，点数显示继续来自 BATCH_SIZE 和 costForImages。
[x] editImages 接收的 images 永远是 [product, reference]。
[x] 产品拍摄和电商主图的 editImages 接收的 images 永远是 [product]。
[x] prompt 明确限定第一张图为产品主体、第二张图为视觉来源。
[x] 六个产品工作流均有固定提示词约束，且用户的可选说明不会覆盖产品保真要求。
[x] 现有 14 个产品替换模板仍能从“精选场景”访问并正常生成。
[x] 结果写入资产库，标题为“灵感复刻”。
[x] 产品拍摄和电商主图的结果以各自工作流标题写入资产库。
[x] 结果页仍可保存、返回编辑、作为参考图。
[x] tsc --noEmit 通过。
[x] test-reference-images.mjs 通过。
[x] test-reference-recreate.mjs 通过。
[x] test-product-studio.mjs 通过（新增）。
[x] taro build --type weapp 通过。
[x] verify-dist.mjs 无阻断项（47 项通过 · 1 项提醒 · 0 项阻断；那 1 项提醒是
    既有的 images.unsplash.com 白名单待办，与本次无关）。
```

### 与文档的两处偏差（刻意，理由在此）

1. **「产品拍摄 / 电商主图：只显示三张大图」落成了三张大的文字卡。**
   仓库里**没有**按模式（棚拍 / 生活方式 / …）分的图，只有每个工作流一张展示图。
   凭想象配 6 张图比文字卡更糟 —— 图会暗示一个并不存在的既有素材。
   等有了真实的模式样图再换。

2. **产品工作室没有产品上传槽。** 文档「切换创作意图时不清除已经上传的产品图」
   那句假设了槽位在工作室里；这里按文档第 120–121 行「选择后再上传产品」实现：
   工作室只做导航，上传在 composer 页。选中的模式由 `mode` / `shot` 参数带过去
   （参数名走 `productStudioParamName()`，两端同一个来源；非法值退回默认、不白屏）。
   于是「切换意图丢图」这个风险**在结构上不存在**，而不是靠小心维护。

### 本次新增的门禁与对抗测试

| 命令 | 守什么 |
| --- | --- |
| `npm run test:product-studio` | 六个工作流的编排；比例必须是 `ratioToSize` 的 key（否则静默回落 2:3）；路由参数非法值退回默认；14 个精选场景一个不删；两个页面共用同一份表单 |
| `npm run verify:dist` | 三张展示图**逐张**：已 emit / 被首页引用 / 体积 / **三张同尺寸** / 卡片纵横比 = 图纵横比；两个新页面的 `AppHeader` 调用点 |
| `node _tools/adversarial-feature-rail.mjs` | 14 条对抗用例，含**专打第二、三张图**的藏图用例（旧版只硬编码第一张，这两条根本没人守） |
| `node _tools/adversarial-product-studio.mjs` | 9 条对抗用例，专打**文本/正则式**判据：解析器失配、比例出表、素材顺序、标题漂开、未挂共享组件、路由未登记 |

⚠️ 两份对抗脚本都带**过期检测**：真门禁改了检查名或 `FEATURE_IDS`，它们会先报「我过期了」并以非 0 退出，而不是继续拿过期副本测出一个假的绿。
