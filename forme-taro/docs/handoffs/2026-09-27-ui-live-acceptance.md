# 2026-09-27 · 小程序 UI 真机级验收（模拟器实测）

> 这一轮是**第一次真正「看到」小程序**：接上微信开发者工具的自动化通道，在模拟器里逐屏量尺寸、
> 截图、读 console。前面几轮 UI 改动（P0 动效 / 生成页重组 / 导航改名）**只有断言，没有眼睛看过**，
> 这份文档补上眼睛的部分 —— 而第一次看就抓到两个严重问题。

工程根：`C:/Users/Sunyan win/Documents/Codex/2026-09-13/wo/forme-taro`

---

## 0. 一句话结论

**动效改动引入了一个「静默失败」：页面根节点带 `transform` 后，`position: fixed` 的底导与生成条
失去视口包含块，被钉到内容底部 —— 首屏完全看不见，而 60 条产物门禁全绿。** 已修，并补了 6 条门禁
（全部通过对抗测试）。另外修掉一个「内部模型 id 漏进 UI」的破绽。剩 3 个设计问题待王定。

---

## 1. 这一轮怎么「看到」的（可复用配方）

微信开发者工具自带自动化 CLI。**必须在非沙箱下运行**（官方 skill 明确禁止沙箱）。

```bash
ELECTRON="/d/微信开发者工具/微信web开发者工具/微信开发者工具.exe"
CLI='D:\微信开发者工具\微信web开发者工具\resources\app.asar.unpacked\js\common\cli\skill-index.js'
BOOT='const e=process.argv[1],a=process.argv.slice(2).filter(function(x){return x!=="--electron"});if(!process.env.cwd)process.env.cwd=process.cwd();process.argv=[process.execPath,e,"--electron"].concat(a);require(e)'
cwd="$(pwd)" ELECTRON_RUN_AS_NODE=1 "$ELECTRON" -e "$BOOT" "$CLI" -c WorkBuddy <tool> [flags]
```

封装在 `_diag/wx.sh`（`bash _diag/wx.sh <tool> [flags]`）。

| 用途 | 工具 |
|---|---|
| 鉴权握手 | `check_wechatide_status --skill-version 0.3.9`（返回 `pending`+`taskId` → `polling_task_result --taskId`） |
| 开项目 | `open_project_window --project <源码目录>`（`project.config.json` 里 `miniprogramRoot: "dist/"` ⇒ 开**源码目录**，不是 dist） |
| 换页 | `simulator_open_page --page 'pages/xxx/index'` |
| 截图 | `simulator_screenshot --path <abs> --optimize false` |
| 滚动 | `automation_viewport_action --action pageScrollTo --scroll-top <n>` |
| **读真实几何** | `automation_element_action --action size/offset --selector .cls` |
| 读计算样式 | `automation_element_action --action style --selector .cls --name <cssProp>` |
| 当前页 | `automation_runtime_info --action currentPage\|pageStack\|systemInfo` |
| 控制台 | `get_simulator_console --command "grep -n ."` |

### 踩过的四个坑

1. **`automation_navigate --action navigateTo` 会失败**（`Uncaught [object Object]` / `mcp_business_fail`）。
   用 `simulator_open_page` 代替。
2. **`--action style` 必须带 `--name`**（CSS 属性名），否则报 `name is required`；
   `animationName` / `animationFillMode` 这类简写**取不到**（返回空串），
   但 `transform` 取得到 —— 这一条救了整轮排查。
3. **截图被缩放**：`simulator_screenshot` 返回 363×785，而逻辑视口是 **390×844**（iPhone 12/13）。
   换算系数 0.931。**用截图 px 判尺寸前必须先换算**，否则会量错。
4. **`simulator_open_page` 换页后，自动化通道的绑定可能滞后**：
   第一次 `pageScrollTo` 滚的是上一页。判据是 `automation_runtime_info --action currentPage`
   —— 先确认页对了再滚，别假设。

---

## 2. 🔴 Bug 1：底导与生成条被推到屏幕外（P0 动效引入的回归）

### 症状

首页滚 0 时**看不到底导**（创作 / 资产）；自由生图页滚 0 时**看不到「生成」按钮**。
必须往下滚约 435px 才出现。

### 证据链（全部可复现）

| # | 测什么 | 结果 |
|---|---|---|
| 1 | `.bottom-nav` 视口 top @滚0 / @滚500 | **1279.36 / 779.36** ⇒ 差**正好 500** ⇒ 跟着内容走，没钉住 |
| 2 | `.app-screen` 计算 `transform` | **`matrix(1, 0, 0, 1, 0, 0)`**（= `translateY(0)`，**不是 `none`**） |
| 3 | 坐标系校准 | `.home-composer-card` top=643.36；截图里卡顶边 y≈600px ÷ 0.931 = 644 ⇒ **吻合**，证明 `offset` 是视口相对坐标 |
| 4 | 截图（滚 0 底部 85px 放大） | 只有 `+ 参考图` / `生成 ↑`，**没有底导** |
| 5 | 截图（滚 500 底部） | 底导（创作 / 资产）出现了 |
| 6 | 基线 `git show HEAD:./src/styles/forme.scss` | **没有任何 `@keyframes`，也没有 `page-enter`** ⇒ transform 是这次新加的 |

### 根因（一行）

```scss
.page-enter { animation: pageEnter 200ms cubic-bezier(0.22, 0.61, 0.36, 1) both; }
@keyframes pageEnter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
```

`animation-fill-mode: both` 让元素在动画结束后**保留 `to` 状态**，即 `transform: translateY(0)`。
CSS Transforms 规范：**祖先的 transform 只要不是 `none`，就成为 `position: fixed` 后代的包含块。**

而 `.page-enter` 挂在**页面根** `.app-screen` 上（14 个页面全部如此），
`.bottom-nav` / `.generate-dock` / `.privacy-mask` 都是它的后代且都是 `position: fixed`：

| 元素 | 声明 |
|---|---|
| `.bottom-nav` | `position: fixed; right:0; bottom:0; left:0` |
| `.generate-dock` | `position: fixed; right:0; bottom:0; left:0` |
| `.privacy-mask` | `position: fixed; top:0; right:0; bottom:0; left:0` |

⇒ 它们的 `bottom: 0` 变成「**`.app-screen` 的底**」（= 内容总高），而不是「屏幕底」。
实测内容高 1357 ⇒ 底导 top = 1357 − 78 = **1279**，而视口只有 844。

**连带影响**：`.privacy-mask` 是 `top:0; bottom:0` 的遮罩 —— 它的「全屏」也是相对内容高，
隐私弹窗的遮罩范围同样不对（这一条**未逐屏验证**，但由同一机制推出）。

### 修复

```scss
/* 入场只做 opacity —— 位置正确性优先于 8px 上浮 */
@keyframes pageEnter { from { opacity: 0; } to { opacity: 1; } }
```

源码里留了长注释说明为什么**这个关键帧不许出现 transform**。

### 修复验证（同时就是控制组）

| | 修复前 | 修复后 |
|---|---|---|
| `.app-screen` 计算 `transform` | `matrix(1,0,0,1,0,0)` | **`none`** |
| `.bottom-nav` top @滚0 | 1279.36 | **734** |
| `.bottom-nav` top @滚500 | 779.36 | **734（不动）** |
| `.generate-dock` top @滚0（自由生图） | 屏幕外 | **719（屏内）** |
| 截图 | 看不到底导 | **底导 / 生成条都在屏幕底部** |

---

## 3. 🟡 Bug 2：高级设置徽标把内部模型 id 漏给了用户

自由生图「高级设置」右侧徽标显示 **`1:1 · 自动 · gpt-image-2.5-sunburst`**。

- `src/data/catalog.ts:61-64` 里模型**是有 `label` 的**：`{ value: 'gpt-image-2.5-sunburst', label: 'Sunburst' }`
- 但 `create-freeform/index.tsx` 渲染的是**原始 `model` 值**
- **同一行里还有第二个同类 bug**：`quality === 'auto' ? '自动' : quality` ——
  四个档位里**只有 `auto` 被硬编码成中文**，选「高清」（`medium`）时徽标显示 `medium`
- ⇒ 同一个页面里「模型」选择器显示 `Sunburst`、旁边的徽标显示 `gpt-image-2.5-sunburst`：
  **同一事物两个名字**，且一个是内部标识

**设计真源核对**：`work/visual-studio/src/Prototype.tsx` 的自由生图页**根本没有这个徽标**
⇒ 它是移植时自己加的（加得对，是好东西；只是实现用错了字段）。

### 修复

`catalog.ts` 新增唯一映射口：

```ts
export function optionLabel(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string
) {
  return options.find((item) => item.value === value)?.label ?? value
}
```

页面改为 `{ratio} · {optionLabel(QUALITY_OPTIONS, quality)} · {optionLabel(MODEL_OPTIONS, model)}`。
徽标只存在于 `create-freeform`（另三个生成页是字段式结构，没有这个徽标）。

---

## 4. 新增的 6 条门禁（这次「零门禁」是问题的另一半）

原来 **`verify-dist.mjs` 60 条、`test-creator-ui.mjs` 全部断言，没有一条提到动效** ——
`pageEnter` / `page-enter` / `@keyframes` / `transition` / `is-expanded` 一个都没有。
**把整套动效删光，门禁照样全绿。** 这是 Bug 1 能溜到模拟器里的直接原因。

### `scripts/verify-dist.mjs`（产物级，+4 条 ⇒ 60 → **64 项**）

| 判据 | 为什么 |
|---|---|
| 入场关键帧 `pageEnter` 不含 `transform` | 直接钉死 Bug 1 的成因 |
| 三个固定定位元素仍是 `position: fixed` | 上一条的**前提**；它们若改成 sticky/absolute，包含块分析就换了前提，这条先红逼人重看 |
| 入场 / 骨架 / 加载三个关键帧都在产物里 | 存在性：删光了也得有人知道 |
| `prefers-reduced-motion` 降级仍在产物里 | 无障碍降级不能被顺手删掉 |

**关键约束（写进注释了）**：判据**只针对 `pageEnter`**，
**绝不能写成「所有关键帧都不许有 transform」** —— `spin` 就是靠 transform 转的
（挂在 `.spinner` 这种小元素上，不构成包含块）。写成通用规则会变成**假红**，而假红会让人把门禁删掉。

配套写了 `keyframesBody(css, name)`：按**花括号配平**取关键帧体，
不依赖「后面紧跟着什么选择器」—— 压缩器换序也不会失准。

### `scripts/test-creator-ui.mjs`（源码级，1 组 5 条断言）

锚**表达式形态**，不是「文件里有没有 `optionLabel`」（只查存在性的话，引进来不用也算过）：

```js
assert.match(badgeBlock, /optionLabel\(QUALITY_OPTIONS,\s*quality\)/)
assert.match(badgeBlock, /optionLabel\(MODEL_OPTIONS,\s*model\)/)
assert.doesNotMatch(badgeBlock, /\{model\}/)
assert.doesNotMatch(badgeBlock, /\{quality\}/)
assert.match(catalogSrc, /\?\? value/)   // 找不到时须回落，不许渲染空白
```

### 对抗测试：证明它们真的会拦

`_diag/adversarial-motion-and-badge.py`（Python 驱动子进程，`try/finally` 恢复，铁律 #17）。

```
控制组 verify-dist 应当绿                            ✅  (exit=0)
控制组 test-creator-ui 应当绿                        ✅  (exit=0)
变异 A → verify-dist 必须红                         ✅  (exit=1)
变异 A → 红的必须是那条判据                               ✅
变异 B → test-creator-ui 必须红                     ✅  (exit=1)
变异 B → 报的必须是徽标判据                               ✅
恢复后 verify-dist 应当绿                            ✅  (exit=0)
恢复后 test-creator-ui 应当绿                        ✅  (exit=0)
总判定：✅ 全部符合预期
```

- **变异 A**：往 `dist/app.wxss` 的 `pageEnter` 里塞回 `transform` ⇒ 报
  `❌ 入场关键帧 pageEnter 不含 transform`。
  （注意：产物里 `@keyframes` 与 `@-webkit-keyframes` **各一份**，锚点命中 2 次，要全部替换。）
- **变异 B**：徽标改回 `{model}` / `{quality}` ⇒ 报
  `AssertionError: 徽标里的清晰度必须走 label 映射（否则显示 low/medium/high）`。

---

## 5. 🔵 发现但**没改**的（等王定）

### 5.1 首页 composer 卡的操作行被底导盖住（40%）

滚 0，视口 844：

| 元素 | top | 高 | 底 |
|---|---|---|---|
| `.hd-stage`（轮播） | 112 | 399 | 511 |
| `.home-intro` | 511 | 132.4 | 643.4 |
| `.home-composer-card` | 643.4 | 200 | 843.4 |
| `.composer-card-footer` | 785.4 | 43 | 828.4 |
| `.bottom-nav` | **734** | 69 | **803** |

⇒ 底导盖住 footer 的 **785.4–803 = 17.6px**，
「生成 ↑」（786.4–827.4）与「+ 参考图」（785.4–828.4）**各被盖掉约 40%**。

**这是既有问题，不是 P0 引入的**：基线 HEAD 的首页**已经有 `BottomNav`**，
`.hd-swiper` 高 356px（现在 353px，几乎没变）⇒ 布局基本一致。
它一直存在，只是被 Bug 1「底导跑到屏幕外」掩盖了 —— 修好底导才重新露出来。

**为什么没直接改**：首页底部留白（`forme.scss:2639` 的 `--nav-h + --safe-b + --home-bottom-pad`）
只保证**最后一块内容**不被盖；composer 卡在页面中部，留白救不了它。
要让它整块露出来，必须**缩短它上面的东西**（轮播 399px 或 intro 132px 各让 ~110px）——
这是设计取舍，不是 bug 修复。**待王定。**

### 5.2 首页轮播 13 个 5px 圆点

`.hd-dots { gap: 6px }` + `.hd-dot { width:5px; height:5px }`，**一张卡一个点**。
白名单落地后是 13 张 ⇒ 13 个点，整行约 137px（`.hd-dots` 实测宽 390 = 满屏宽，不溢出）。

问题不在溢出，在**指示失效**：13 个 4px 点里，当前项只靠颜色区分，几乎看不出来。
**待王定**（选项：只显示首尾+当前 / 换成 `03 / 13` 计数 / 换成细进度条 / 超过 N 张时自动降级）。

### 5.3 「更多工具」2 列 5 项 ⇒ 最后一行右侧空洞

`.workflow-row { grid-template-columns: repeat(2, minmax(0, 1fr)) }`，`QUICK_ACTIONS` 有 5 项
⇒ 第 3 行只有「头像」一个，右侧空一格（截图已确认）。
**待王定**（选项：改 3 列 / 让第 5 项跨两列 / 补第 6 项）。

---

## 6. 撤回的两条判断（今天自己发现的错）

| 我一度以为 | 实测 | 处置 |
|---|---|---|
| 首页 `+ 参考图` 按钮**尺寸会跳变**（空态 ~37.5×42 vs 选中态 42×42） | `.composer-ref-add` = **43×43**，`.composer-ref-thumb` = 42×42 ⇒ **差 1px，不跳变** | **撤回**。错因：拿放大截图的像素目测，没量 |
| 控制台那条 `getSystemInfoSync is deprecated` 是技术债 | `test-creator-ui.mjs:93` 有一条**故意要求**用它、并**禁止** `getWindowInfo` 的断言 ⇒ 是刻意的、有门禁守着 | **撤回**。差点把一个被门禁保护的决策报成缺陷 |

（另：`.composer-ref-add` 43×43 与自由生图 `.reference-add-inline` 64×64 尺寸不同 ——
**不是缺陷**：前者旁边是 42×42 的缩略图，后者在 64×64 的参考图网格里，各自与自己上下文对齐。）

---

## 7. 未验证 / 常态缺口（每次都要说清）

- **没有 `LLM_API_KEY`** ⇒ 真出图一次没跑过。这一轮全部是**布局与样式**验收，**没有**验证生成链路。
- **只有模拟器，没有真机**。模拟器逻辑视口 390×844、`--safe-b` 实测 33。
  真机 safe-area、刘海、胶囊位置都可能不同 ⇒ 第 5.1 节的重叠量在真机上需复测。
- **`.privacy-mask` 的遮罩范围**：由同一机制推出「也应该不对」，**未逐屏验证**。
- **`prefers-reduced-motion` 在真机 WebView 里是否真的生效**：产物里有降级块，但没在开启「减弱动态效果」的机器上验过。
- 王手上的外部依赖（每轮都要说）：4 条 MP 后端域名白名单、《用户隐私保护指引》、4 个道具已发布、消息推送、苹果支付开关、体验版、真机支付/退款、提审 → 发布。

---

## 8. 状态

| 项 | 值 |
|---|---|
| `npm run release` | **EXIT=0** |
| `verify:dist` | **64 项通过 · 0 项提醒 · 0 项阻断** |
| `check:prompt-mirror` | 34 模板 · 16 字段 |
| `check:poster-directions` | 15 个方向 |
| `test:creator-ui` | ✅（含新增徽标断言） |
| 主包 | **74 文件 · 1,736,787 B · 82.82% · 余量 351.9 KB** |
| 控制台 | 1 `[info]`（WeChatLib 3.17.3）+ 1 `[warn]`（已废弃 API，刻意保留）· **0 error** |

改动文件：

```
src/styles/forme.scss                      pageEnter 去掉 transform（+ 长注释说明原因）
src/data/catalog.ts                        新增 optionLabel（value → label 唯一映射口）
src/pages/create-freeform/index.tsx        徽标改用 optionLabel
scripts/verify-dist.mjs                    +4 条动效门禁 + keyframesBody 助手
scripts/test-creator-ui.mjs                +5 条徽标断言
```

新增诊断脚本（`_diag/`，不进包）：
`wx.sh`、`zoom-shots.py`、`fix-badge-and-fixed-position.py`、`adversarial-motion-and-badge.py`。

---

## 9. 王的三个决定与执行情况（2026-09-27 收尾）

验收报告交上去后，王对 §5 的三条各给了一个选择：

| # | 问题 | 王的决定 | 状态 |
|---|---|---|---|
| 1 | 首页 composer 操作行被底导盖住 40% | **首页不显示底导** | 🔴 **卡住，等王定**（见 §9.1） |
| 2 | 轮播 13 个 5px 圆点 | **换成细进度条** | ✅ 已完成并验证 |
| 3 | 「更多工具」2 列 5 项空洞 | **改成 3 列** | ✅ 已完成并验证 |

### 9.1 🔴 第 1 条卡住了：「首页不显示底导」会让**资产页彻底孤儿**

撤底导之前先做了入口侦察，结果：

```
grep -rn "assets/index" src/
  src/app.config.ts:14:    'pages/assets/index',      ← 只是路由注册
  src/data/app-nav.ts:3:  { key:'assets', …, path:'/pages/assets/index' }  ← BottomNav 的数据源

全项目所有跳转目标：
  /pages/create-freeform/index
  /pages/home/index
  /pages/profile/index
  /pages/recharge/index
  /pages/result/index          ← 没有 /pages/assets/index

BottomNav 只出现在两处：
  src/pages/home/index.tsx:404   <BottomNav active='create' />
  src/pages/assets/index.tsx:191 <BottomNav active='assets' />
```

⇒ **`/pages/assets/index` 全项目唯一入口就是首页底导。** 撤掉它，「资产」页永远进不去
（资产页自己的 `BottomNav active='assets'` 会渲染，但没有任何路径能到达那一页）。

**第二个连带问题**：`verify-dist.mjs:727` 那条门禁的判据里**包含 `{active:"create"}`**：

```js
const privacyProxy =
  /jsx\((\w+)\.\w+,\{\}\),\(0,\w+\.jsx\)\(\1\.\w+,\{active:"create"\}\)/.test(homeCode)
must('首页在底部导航之前挂了隐私弹窗（wx.chooseMedia 是隐私接口）', privacyProxy, …)
```

它是 `<PrivacyGate />` 的**结构代理**（因为 PrivacyGate 编译进 `common.js`，在页面 bundle 里
永远找不到，直接判 `includes('PrivacyGate')` 是**永远红的假门禁**）。
撤掉首页底导 ⇒ 这个形状消失 ⇒ **这条门禁变红**。

而它守的东西不能丢：`wx.chooseMedia` 在未同意隐私协议时会被系统拦下，
`ensurePrivacyAuthorized` 在没有订阅者时**直接放行** ⇒ 自定义弹窗永远不弹、
用户点「+ 号」像是**点了没反应**（静默失败）。
⇒ 撤底导的同时**必须把这条代理判据重新锚**到一个仍然存在的形状上（例如「渲染序列末尾
是一个不接 props 的同模块组件」），**不能直接删**。

**所以这一条没有直接做** —— 需要王定「资产入口放哪儿」。

### 9.2 ✅ 轮播指示器 → 细进度条

`src/pages/home/index.tsx`：

```tsx
{/* 细进度条取代圆点（2026-09-27 模拟器实测后改）。
    原来是一张卡一个 5px 圆点：白名单落地后轮播 13 张 ⇒ 13 个点、
    整行约 137px，当前项只靠颜色区分，**在 13 个 4px 点里根本看不出来**。
    进度条把「第几张」变成连续量，一张卡也读得出位置。 */}
<View className='hd-progress'>
  <View
    className='hd-progress-fill'
    style={{ width: `${((active + 1) / CARDS.length) * 100}%` }}
  />
</View>
```

`src/styles/forme.scss`：删掉 `.hd-dots` / `.hd-dot` / `.hd-dot.is-active` 三条规则，
换成 `.hd-progress`（120×2px，圆角，`margin: 16px auto 0`，轨道 `rgba(255,255,255,.16)`）
+ `.hd-progress-fill`（`var(--ink)`，`transition: width 280ms`）。

**实测**：`.hd-progress` = **119×1px**（CSS 120×2，渲染取整），top = **507**（就在
`.hd-caption` 的 `INSPIRATION RECREATE` 下方）。截图确认。

⚠️ 墓碑注释里故意写了 `` `.hd-dots` `` 说明历史 ⇒ 负向断言必须锚 `.hd-dots {`（带花括号），
**不能锚裸子串**（同 §2 ④ 与铁律 #11 ④）。首页 TSX 里没有这种注释，可以锚裸子串。

### 9.3 ✅ 「更多工具」→ 3 列

`src/styles/forme.scss` 的 `.workflow-row`：`repeat(2, …)` → `repeat(3, …)`。

**实测**：`.workflow-item` **172.5 → 112.66px** 宽，`.workflow-row` 352×**241**（2 行）。
截图确认：行 1 = 自由生图 / 灵感复刻 / 海报，行 2 = 产品图 / 头像。

⚠️ **3 列 + 5 项仍然空一格**（3+2）—— 空格从 1/2 变成 1/3，**没有消失**。
真要填满需要第 6 个工具方向（**待王定**）。这一点已写进源码注释，免得下一个人以为改错了。

### 9.4 新增的门禁（`test-creator-ui.mjs`，5 条）

```js
assert.match(home, /hd-progress/)
assert.doesNotMatch(home, /hd-dots/)
assert.match(css, /\.hd-progress-fill\s*\{/)
assert.doesNotMatch(css, /\.hd-dots\s*\{/)          // 带花括号，避开墓碑注释
assert.match(css, /\.workflow-row\s*\{[^}]*grid-template-columns:\s*repeat\(\s*3\s*,/)
```

`npm run release` **EXIT=0**；`verify:dist` 仍 **64 项通过 · 0 提醒 · 0 阻断**；
`test:creator-ui` ✅。

---

## 10. 收尾：首页撤底导 + 资产入口挪进「我的」

王对 §9.1 的回答：**「放进『我的』页」**；对 §9.3 的空格：**「就这样」**。

### 10.1 改动清单

| 文件 | 改了什么 |
|---|---|
| `src/pages/home/index.tsx` | 删 `<BottomNav active='create' />` 与它的 import；原位留注释说明为什么（含「撤底导必须保证资产页还有入口」） |
| `src/styles/forme.scss` | `.home-dark` 的底部留白去掉 `var(--nav-h) + `（首页不再有底导，多算 70px 会在页尾留死空白）；`--safe-b` **保留**（底部指示条还在）。新增 `.me-assets-entry` / `.me-assets-label` / `.me-assets-arrow` |
| `src/pages/profile/index.tsx` | 余额卡下方新增「我的资产 ›」入口，`Taro.navigateTo('/pages/assets/index')`（与上面「充值点数」一致） |
| `scripts/verify-dist.mjs` | **重新锚** PrivacyGate 的结构代理判据（见 10.2） |
| `scripts/test-creator-ui.mjs` | 新增「首页不许有 `<BottomNav>`」+「资产页不许变孤儿」两条 |

### 10.2 🔴 必须重新锚、不能删的那条判据

`verify-dist.mjs` 里 PrivacyGate 的**结构代理**判据原本是：

```js
/jsx\((\w+)\.\w+,\{\}\),\(0,\w+\.jsx\)\(\1\.\w+,\{active:"create"\}\)/
//   ↑ 无 props 的同模块组件         ↑ BottomNav
```

它用「紧挨着 BottomNav 的前一个元素」来**定位渲染序列的末尾**。
首页撤掉底导后 `active:` 在首页 bundle 里出现 **0 次** ⇒ 这条判据会**永远红**。

**永远红的假门禁比没有更坏** —— 下一个人会直接把它删掉，而它守的是：

> `wx.chooseMedia` 在未同意隐私协议时会被系统拦下，
> `ensurePrivacyAuthorized` 在没有订阅者时**直接放行** ⇒ 自定义弹窗永远不弹、
> 用户点「+ 号」像是**点了没反应**。

**新定位器**：文件里**最后一个 `jsx)(`**。实测位置 **6938 / 总长 7257**，
其后 70 字符是 `jsx)(u.CU,{})]})}var A={navigationBarTitleText:"Pixel Box"…` ——
Page 注册代码排在它之后且不含 jsx 调用，所以「最后一个」就是渲染序列的末尾。

```js
const lastJsxAt = homeCode.lastIndexOf('jsx)(')
const homeSeqTail = lastJsxAt < 0 ? '' : homeCode.slice(lastJsxAt)
const privacyProxy = /^jsx\(\w*\$?\w*)\./  // 实际写法见源码
```

判据名也从「首页在底部导航之前挂了隐私弹窗」改成
**「首页渲染序列的末尾挂着隐私弹窗」**，并在失败提示里**把取到的序列末尾打出来**
（否则下次再改结构时，人只能靠猜为什么红）。

### 10.3 防孤儿门禁（这次差点永久失联一个页面）

```js
const ASSETS_NAV_FORM = "url: '/pages/assets/index'"
const navToAssets = readdirSync(pagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'assets')
  .map((entry) => `../src/pages/${entry.name}/index.tsx`)
  .filter((rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').includes(ASSETS_NAV_FORM))
assert.ok(navToAssets.length >= 1, '「资产」页成了孤儿页…')
```

⚠️ 判据锚**跳转形态** `url: '/pages/assets/index'`，**不是裸子串** ——
首页与「我的」页的**注释里都写着** `` `/pages/assets/index` `` 说明背景，
裸子串会被自己的注释命中（同 §2 ④ 与铁律 #11 ④）。

### 10.4 验证（产物级 + 功能级 + 视觉）

**产物级**（`dist` 里的 `BottomNav` / `bottom-nav` / `active:` 计数）：

| 文件 | BottomNav | bottom-nav | `active:` | `pages/assets/index` | `me-assets` |
|---|---|---|---|---|---|
| `pages/home/index.js` | **0** | **0** | **0** | **0** | 0 |
| `pages/assets/index.js` | 0 | 0 | 1 | 1 | 0 |
| `pages/profile/index.js` | 0 | 0 | 0 | **1** | **3** |

⇒ 首页的底导**整个消失**，资产页自己的 nav 保留，入口落在「我的」页。

**功能级**（真的点一下）：

```
点前 currentPage = pages/profile/index
tap .me-assets-entry → success
点后 currentPage = pages/assets/index
pageStack = [pages/profile/index, pages/assets/index]   ← navigateTo 压栈，返回箭头可回「我的」
```

**几何**：

| 元素 | 值 |
|---|---|
| `.bottom-nav` @首页 | **`no such element`**（已不存在） |
| `.composer-card-footer` | top **782.36** + 43 ⇒ 底 **825.36** < 视口 844 ⇒ **完整可见** |
| `.me-assets-entry` | **352 × 53**，文案「我的资产」 |

**视觉**：`_diag/shots/v3-home.png`（无底导、操作行完整）、`v3-profile.png`（入口就位）、
`v3-assets.png`（资产库正常渲染）。

### 10.5 🔵 一个残留（未改，等王定）

撤底导后 composer 卡**不再被任何东西盖住**，但它的下边缘落在 **843.36**（视口 844）
—— 也就是**卡片底边正好贴着屏幕底**，其底部约 11px（811–843 属底部安全区、
832–840 是底部指示条）落在安全区里。

- **交互内容没问题**：`.composer-card-footer` 底在 825.36，在指示条（≈832）之上。
- 只是**观感**上卡片像是被切掉了。要给它呼吸空间需要把上方内容压 ~30px
  （`.home-dark .home-intro` 的 padding 或 `.hd-stage` 的 margin）。
  **属设计取舍，没动。**

### 10.6 最终状态

| 项 | 值 |
|---|---|
| `npm run release` | **EXIT=0** |
| `verify:dist` | **64 项通过 · 0 项提醒 · 0 项阻断** |
| `test:creator-ui` | ✅（含徽标 5 条 + 进度条/3 列 5 条 + 防孤儿 2 条） |
| 主包 | **74 文件 · 1,737,581 B · 82.85% · 余量 351.1 KB** |
| 控制台 | **0 error** |
