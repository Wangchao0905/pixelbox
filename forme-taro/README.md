# Pixel Box 微信小程序（Taro + React）

把 `work/visual-studio` 里已经通过 Design QA 的移动端 Web 原型，按页迁移成原生小程序工程。

选 Taro 而不是手写原生 WXML，原因是原型本身就是 React 组件 + 状态驱动（FlowStack 路由、模板数据、Prompt 编译逻辑），用 Taro 可以直接复用这些逻辑，只把浏览器 API 换成小程序 API。

## 快速开始

```bash
npm install                 # 依赖较多，首次约 10–15 分钟
npm run dev:weapp           # 开发模式（watch），产物在 dist/
```

> ⚠️ **Windows 上跑构建前先设置 `APPDATA`**，否则 Taro 找不到缓存目录会报错：
> ```bash
> export APPDATA="C:\Users\Sunyan win\AppData\Roaming"
> ```

### 对接微信开发者工具

**第 0 步 · 装工具**（本机目前没装）

到 [微信开发者工具下载页](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) 下 **稳定版 Windows 64**，装完用**小程序管理员本人的微信**扫码登录——否则后面打开会提示没有该 AppID 的权限。

**第 1 步 · 起后端**（想用真实数据就必须起；只想看 UI 可跳过，见下面的「演示模式」）

```bash
cd ../forme-server
npm start                   # 监听 http://127.0.0.1:8787
```

零配置即可启动：没有 `.env.local` 时默认 `MOCK_WECHAT=1` + `MOCK_LLM=1`，不调真实微信接口、不调真实图片模型，登录用假 code、生成返回本地占位图。**不需要任何微信凭据就能跑通全流程。**

**第 2 步 · 构建**

```bash
npm run dev:weapp
```

**第 3 步 · 导入项目**

打开开发者工具 → 「导入项目」：

| 字段 | 填什么 |
| --- | --- |
| 目录 | `wo/forme-taro`（**不是** `dist`） |
| AppID | `wxf595b8865bcbf254` |
| 后端服务 | 不使用云服务 |

`project.config.json` 里 `miniprogramRoot` 已指向 `./dist`，所以导入工程根目录即可。

**第 4 步 · 确认「不校验合法域名」**

详情 → 本地设置 → 勾选 **「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**。

本工程 `project.config.json` 里 `urlCheck: false` 已经是关的，正常情况下导入后就是勾上的，但**建议肉眼确认一次**——本地后端是 `http://127.0.0.1:8787`，这个开关没勾会直接请求失败。

### 演示模式（不起后端看 UI）

改 `.env.development`：

```
TARO_APP_USE_MOCK=1
```

重新构建后，生成会返回本地演示图、余额固定 128、充值走本地模拟，可以直接点通「首页 → 创作 → 结果 → 资产库」全流程。适合只调样式的时候用。

## 页面清单

| 小程序页面 | 原型对应 | 状态 |
| --- | --- | --- |
| `pages/home/index` | `HomeScreen` | 完整实现：品牌栏、Hero、三种创作类型、**16 种海报方向**、社区展示、底部导航 |
| `pages/create-poster/index` | `StructuredPosterScreen` | 完整实现：模板预览、方向选择、主题/标题两字段、比例/模型/清晰度、生成 Dock |
| `pages/create-freeform/index` | `FreeformCreateScreen` | 完整实现：提示词输入、快捷建议、输出设置、生成 Dock |
| `pages/product-gallery/index` | `ProductGalleryScreen` | 完整实现：14 个产品替换模板 |
| `pages/create-product/index` | `ProductReplaceScreen` | 完整实现：产品上传槽、锁定提示词说明 |
| `pages/create-reference/index` | — | 完整实现：灵感复刻 —— 借参考图的一部分重做（交接：`docs/handoffs/2026-09-23-inspiration-recreate.md`） |
| `pages/create-product-shot/index` | — | 完整实现：产品拍摄 —— 棚拍 / 生活方式 / 人物使用三种成品图 |
| `pages/create-marketplace/index` | — | 完整实现：电商主图 —— 白底主图 / 纯色卖点图 / 细节特写 |
| `pages/avatar-gallery/index` | — | 完整实现：头像模板库，与产品工作室同一套骨架 |
| `pages/create-avatar/index` | — | 完整实现：头像生成 —— 提示词由模板锁定，**刻意不提供输入框** |
| `pages/result/index` | `ResultScreen` | 完整实现：方向选择、继续编辑、导出到相册、写入历史 |
| `pages/assets/index` | `AssetsScreen` | 完整实现：本地历史分组、空状态、图片预览 |
| `pages/recharge/index` | `RechargeScreen` | 完整实现：按「创作权益 / 点数充值」分组、显示权益到期日、对接虚拟支付下单 |
| `pages/profile/index` | — | 完整实现：账号 + 点数 + 充值。入口是**首页右上角头像**（点数模块已从首页移出） |

> **`原型对应` 为 `—` 的 6 个页面在 `Prototype.tsx` 里没有同名屏**（它的 Screen 清单里没有对应项，
> 中文标签 `灵感复刻` / `产品拍摄` / `电商主图` / `头像模板` / `头像生成` 也是零命中）——
> 它们是从后续需求长出来的，样式仍复用原型的设计语言。
> 本表以 `src/app.config.ts` 的 `pages` 数组为准（**14 个页面**，逐一核对过）。

### 底部导航现状（2026-09-23 更正）

**小程序里只有两项：`创作` / `资产`**（`src/data/app-nav.ts` 的 `APP_NAV_ITEMS`），用 `reLaunch` 切换。
「我的」不在这条导航里 —— 它的入口是**首页右上角的头像**。

> ⚠️ 旧版本这里写的是「「灵感」「我的」两个入口目前是 Toast 占位——原型里也没有对应页面」，
> **两半都不对**：小程序里压根没有这两个入口；而原型 `Prototype.tsx` 的 `BottomNav` **有**
> 四项（创作 / 灵感 / 资产 / 我的），其中「灵感」「我的」是**没有 `onClick` 的死按钮**。
> 而且 `pages/profile/index`（我的）现在已经实现了。

## 设计系统迁移约定

真源是 `work/visual-studio/src/prototype.css`，全部搬到 `src/styles/forme.scss`。为了少走样，做了这几个决定：

- **`designWidth: 393`**。原型设备屏就是 393 CSS px 宽，把它设成设计宽度后，源码里写 `font-size: 39px` 就等于原型里的 39px，Taro 自动换算 rpx。**迁移样式时数值可以 1:1 照抄，不用手工换算。**
- **关闭 `onePxTransform`**。让 `1px` 边框保持物理发丝线，不会被放大成 2rpx。
- **`color-mix()` 全部替换**。方案卡的强调色改成 `data/catalog.ts` 里的 hex，由组件算成 rgba 内联下发（小程序 WebView 对 `color-mix` 支持不可靠）。
- **`:hover` → `hover-class`**。按下反馈统一走 `hoverClass="is-pressed"` / `press-dim`。
- **`<button>/<input>/<select>` → `View` + `Picker`**。小程序没有原生 select，`SelectField` 组件用 `Picker` 承载选择行为，外观复刻 `direction-select`。
- **`FlowStack` → 原生路由**。原型的 FlowStack / MobileScroll / 模拟键盘都是浏览器专用运行时，不迁移；滚动交给页面本身，路由交给 `Taro.navigateTo`。
- **安全区**。`--safe-b: env(safe-area-inset-bottom)`，生成 Dock 与底部导航高度都写成 `calc(视觉高度 + 安全区)` 并用 `border-box`，保证内容区不被安全区挤掉。
- **品牌字体**。原型用 Space Grotesk + DM Mono，小程序没有内置。样式表里写成完整字体栈（`'Space Grotesk', …, 'PingFang SC'`），配置 `brandFontBase` 后用 `wx.loadFontFace` 拉取；不配置或拉取失败会自动回落到系统字体，排版节奏由字号、字重、字距维持。

## 配置

所有对接开关走**环境变量**，切环境不用改代码。构建时按顺序读（后者覆盖前者）：

```
.env → .env.local → .env.{mode} → .env.{mode}.local
```

| 命令 | mode | 实际读取 |
| --- | --- | --- |
| `npm run dev:weapp` | `development` | `.env.development` |
| `npm run build:weapp` | `production` | `.env.production` |

个人机器的覆盖值写 **`.env.development.local`**（已 gitignore）。**别用 `.env.local`** —— 它对 dev 和 prod 都生效，很容易把 `127.0.0.1` 打进生产包。

只有 `TARO_APP_` 前缀的变量会被注入小程序代码包，其余变量留在构建机本地。

| 变量 | 说明 |
| --- | --- |
| `TARO_APP_API_BASE` | 服务端地址。本地开发 `http://127.0.0.1:8787`；生产必须换成已备案 HTTPS 域名并加入「request 合法域名」 |
| `TARO_APP_USE_MOCK` | `0` = 请求真实后端；`1` = 本地演示数据。**变量缺失时默认开启演示模式**，保证新克隆的工程零配置能跑 |
| `TARO_APP_MEDIA_BASE` | 图片 CDN 目录。留空则直接用原型里的 Unsplash 地址（开发者工具勾选不校验域名即可）；填上后所有远程封面改成 `${mediaBase}/{文件名}` |
| `TARO_APP_FONT_BASE` | 品牌字体 CDN 目录，留空则回落系统字体 |

读取入口是 `src/config/index.ts`。

> ⚠️ **改这个文件时注意**：必须写成 `process.env.TARO_APP_XXX` 这种**静态成员访问**。Taro 靠 webpack DefinePlugin 做文本替换，只认字面量：
> ```ts
> process.env.TARO_APP_API_BASE   // ✅ 会被替换成字符串字面量
> process.env[key]                // ❌ 动态取值替换不了，运行时是 undefined
> ```

改完 `.env` 要**重启构建**才生效（`--watch` 不会重读 env 文件）。`development` 模式下启动时会打印一行 `[forme] apiBaseUrl=... useMockGeneration=...`，可以先看这行确认有没有生效。

## 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 工具提示「没有该 AppID 的权限」 | 登录的微信号不是这个小程序的开发者。让管理员在 MP 后台「成员管理」加你，或换成管理员微信登录 |
| 工具里一片白屏、控制台 `Cannot find module` | 没先构建。`project.config.json` 指向 `./dist`，`dist` 不存在工具就打不开 |
| 所有请求失败、报「域名不合法」 | 详情 → 本地设置 → 勾上「不校验合法域名」。`http://127.0.0.1` 必须是关掉校验才能用 |
| 请求报 `connection refused` / `fail` | 后端没起。`cd forme-server && npm start`，然后 `curl http://127.0.0.1:8787/api/health` 确认返回 `{"ok":true,...}` |
| 改了 `.env` 但没生效 | env 文件只在构建启动时读一次，`--watch` 不会重读。Ctrl-C 重启 `npm run dev:weapp` |
| `apiBaseUrl` 打出来是 `https://YOUR_API_DOMAIN` | 说明没走到 `.env.development`。检查是不是用了 `npm run build:weapp`（那是 production）而不是 `dev:weapp` |
| 工具里模拟器正常，真机预览请求全挂 | 真机**不受**「不校验合法域名」影响。真机必须 HTTPS + 域名已加入 MP 后台白名单，`127.0.0.1` 在真机上指向手机自己，永远连不上 |
| 生成只出 1 张图（传了 `count: 2`） | 后端 `MOCK_LLM=1` 时上游固定返回 1 张占位图，这是演示模式的已知行为，不是 bug |
| 充值点了没反应 | 虚拟支付需要 MP 后台配好 OfferID / AppKey / 道具 productId，且模拟器不支持支付。演示模式（`TARO_APP_USE_MOCK=1`）会本地模拟成功到账 |
| 构建报错找不到缓存目录 | Windows 上没设 `APPDATA`，见「快速开始」的提示 |
| 想清掉旧产物 | 本机有 safe-delete 保护会拦 `rm -rf`，用 `mv dist "_dist-trash-$(date +%s)"` 挪走 |

改完代码 `--watch` 会自动重建，工具里点「编译」即可。类型检查单独跑：

```bash
npm run typecheck
```

## 包体

原型 `public/assets` 里的 8 张产品参考图原图合计 **31.6MB**，远超小程序主包 2MB 上限。已用 `scripts/compress-assets.py` 压到宽 640px、JPEG q74，**合计 588KB**，打包进主包；因此产品替换流程不依赖网络也能跑通。重新生成：

```bash
python scripts/compress-assets.py
```

## 没有真机怎么看界面

微信开发者工具和真机都没有的时候，「看着差不多」不算证据。`npm run measure:page` 把**编译产物**
`dist/app.wxss` 的 rpx 按 `designWidth=393` 换回 px，用产物里的真实 class 搭出页面，
在 393px 视口渲染并截图、打印关键尺寸：

```bash
npm run measure:page result [输出目录]           # 1 张 / 4 张两个状态
npm run measure:page create-poster [输出目录]     # 改前 / 改后两个状态
```

⚠️ 页面是脚本里**手搭**的，所以它先自证没漂：把产物 chunk 里的 `className` 全抽出来，
要求 mock 里每一个都在（少一个就报错退出），并断言「抽到了预期条数」——
正则写坏时抽到 0 个会让检查空着通过，那正是这个项目最怕的失败方式。
公共组件（`app-header` / `option-pills` / `select-field` / `generate-dock`）的 class 不在本页
chunk 里，脚本会**明说这道检查覆盖不到它们**，不装作覆盖了。
playwright 从 `work/visual-studio` 借（本工程没装），换目录用 `PLAYWRIGHT_FROM` 指。

## 还没做的部分

1. **微信虚拟支付的线上配置**。客户端下单与轮询、服务端签名与发货/退款回收都已实现（见 `forme-server/API.md`），但 MP 后台还需要人工配好 OfferID、现网 AppKey 和 4 个道具 productId（`forme_pass_30d_30pts` / `forme_pass_30d_100pts` / `forme_points_100_once` / `forme_points_500_once`），且模拟器不支持支付、只能真机测。
2. **远程封面域名**。`posterDirections` 与 `showcase` 用的是 Unsplash 地址，正式上线前需要换成自有 CDN 并加入「downloadFile 合法域名」，否则真机上不显示。
   - ✅ **2026-09-23 已完成服务器与构建侧**：nginx `/media/` 已通（`check:media` **21/21**），
     `TARO_APP_MEDIA_BASE=https://pixeltoy.cn/media` 已填，`verify:dist` 的「远程图片域名已收口」已转绿。
     改动与证据见 `forme-server/deploy/media-rollout-2026-09-23.md`。
   - 🔴 **仍未做**：`pixeltoy.cn` 还没加进小程序后台的 **downloadFile 合法域名**。
     真机**关调试模式**时封面**依旧全空白**，而开发者工具勾着「不校验合法域名」照样正常显示
     —— 很容易被当成样式 bug 查半天。注意产物里仍留着 23 处 Unsplash 字面量，
     那是 `media()` 的**实参**、运行时不会被请求（`verify-dist.mjs` 有注释说明），**不是没收口**。
3. **资产库改服务端**。现在读本地缓存（最近 12 组）。小程序本地缓存上限约 10MB 且卸载即丢，不能作为作品的唯一存储，需要换成服务端资产接口（`/api/assets` 已就绪）。
4. **图标**。原型用 Radix 图标（SVG），小程序里暂时用 `✦ ✧ ▣ ›` 这类字形代替。上线前建议换成一版 PNG 精灵图或图标字体，`src/components/BottomNav.tsx` 与各页面的 `preview-action` / `slot-icon` 是改动点。
5. **内容安全**。用户提示词与上传图片需要过 `security.msgSecCheck` / `imgSecCheck`，否则审核不过。服务端已有三档开关 `SECURITY_MODE=off|log|enforce`。
   ⚠️ **别按「目前是 `log`，上线前要改成 `enforce`」去理解。** 那句话只说对了**代码默认值**：
   `src/config.mjs` 的 `read('SECURITY_MODE','log')` 与 `.env.example` 确实都是 `log`。
   但**生产必须 `enforce`** —— `DEPLOY.md` 明说生产环境 `SECURITY_MODE=log` 时**服务直接拒绝启动**，
   而 `deploy/.env.local.ready` 与 `.env.production.example` 都写着 `enforce`。
   2026-09-23 线上实测 `GET /api/health` → `securityMode: "enforce"`，**已经是 enforce，不需要再改**。
