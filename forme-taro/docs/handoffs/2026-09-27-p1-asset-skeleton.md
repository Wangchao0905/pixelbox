# P1-2 · 资产库骨架屏（把 `skeleton-pulse` 用起来）

> 日期：2026-09-27
> 前置：`docs/ui-improvement-p1.md` §3
> 王定的范围：**只做资产库**

---

## 1. 先说结论：原方案的前提是错的

P1 方案写的是「**三个**列表页补骨架屏：资产库、产品模板库、头像模板库」。
取证后发现**只有资产库真的异步取数据**：

| 页面 | 数据来源 | 有异步吗 |
|---|---|---|
| 资产库 | `loadAssets()` → `GET /api/assets` | ✅ 真的异步 |
| 产品工作室 | `productReplacementTemplates` / `PRODUCT_STUDIO_INTENTS`（**本地常量**） | ❌ 同步（0 处 await / useDidShow） |
| 头像模板库 | `avatarTemplates`（**本地常量**） | ❌ 同步 |

证据：`prompt-templates.ts:185` / `:273` 是普通静态数组；两页的 `await|useDidShow` 计数都是 **0**。

⇒ 给后两页加数据骨架屏，**它永远不会显示** —— 那就是「留一条永远为真的断言」。
这两页上唯一异步的是**封面图**（远程图 + `lazyLoad`），而**全项目还没有任何图片加载占位**
（`onLoad` 一次都没用过）。

**问过王 → 王定：只做资产库。**（「封面图骨架」是个可选的新增视觉元素，暂不做。）

> ⚠️ 这与 P0-2 是**同一类错误**：方案凭印象列清单，没有先查数据来源。
> 教训：**「这一页需要加载态」这句话必须先问「这一页有什么东西是异步的」。**

---

## 2. 做了什么

### 2.1 资产库：文字加载态 → 真骨架屏

原来：

```tsx
{loading && !loadedOnce.current ? (
  <View className='asset-loading'><Text>正在同步资产库…</Text></View>
) : null}
```

现在：2 组 × 4 格的骨架屏，每组 = 两条骨架条（标题 / 元信息）+ 2×2 占位格。

### 2.2 🔴 关键设计：占位块**复用真实列表的类**

```tsx
<View className='asset-group'>            {/* ← 真实列表的类 */}
  <View className='asset-group-heading'>  {/* ← 真实列表的类 */}
    <View className='asset-skeleton-bar is-title' />
    <View className='asset-skeleton-bar is-meta' />
  </View>
  <View className='asset-grid'>           {/* ← 真实列表的类 */}
    {SKELETON_CELLS.map((cell) => (
      <View className='asset-cell' key={cell}>   {/* ← 真实列表的类 */}
        <View className='asset-img' />           {/* ← 真实列表的类 */}
      </View>
    ))}
  </View>
</View>
```

只有「骨架条」是新的类（`.asset-skeleton-bar`）。
**卡片几何全部交给已有规则** —— 另写一套 `skeleton-cell-*` 一定会漂，
而漂开的表现是「数据到了之后卡片高度跳一下」：不报错，只是看着廉价。

**实测证明复用生效**（模拟器量 `.asset-img`）：

| 元素 | 宽 × 高 | 说明 |
|---|---|---|
| `.asset-grid` | 356 | 2 列 |
| `.asset-img` | **174 × 193.33** | 174 / 193.33 = **0.9000** ⇒ `aspect-ratio: 0.9` 真的作用在普通 `View` 上 |

### 2.3 清掉旧的文字加载态

- 删 `.asset-loading { ... }` 整块（TSX + SCSS 两处）
- ⚠️ 逗号组 `.asset-hint, .asset-notice, .asset-loading { … }` 只**摘成员、保留块体**
  （铁律 #12）—— 删整块会把 `.asset-hint` / `.asset-notice` 的样式一起带走。
  改动脚本里有自检：摘之前先确认那两个类**还有独立规则**。

### 2.4 没动的

- `@keyframes pulse` 的**参数**（0.3 ↔ 0.6 / 1.5s）—— 方案 §9 明写「不改动效参数」。
- `loadedOnce` 的「只在首次显示」逻辑。
- `GenerateDock` 的 spinner（生成中的等待态）。

---

## 3. 门禁（+5 源码级、+2 产物级）

### 源码级（`scripts/test-creator-ui.mjs`）

| # | 判据 |
|---|---|
| ① | 资产库存在 `className='asset-skeleton skeleton-pulse'` |
| ② | 骨架屏仍是**条件渲染**（`loading && !loadedOnce.current ?`）—— 常驻就会一直显示骨架 |
| ③ | 占位块复用了真实列表的 4 个类（**只查骨架屏那段 JSX**，见 §4） |
| ④ | `.asset-loading` 已从 TSX **和** SCSS 两处消失 |
| ⑤ | `.asset-skeleton` / `.asset-skeleton-bar` 在 SCSS 里**有定义**（TSX 用了没定义 = 静默失败） |

### 产物级（`scripts/verify-dist.mjs`，64 → **66 项**）

| 判据 | 为什么 |
|---|---|
| `skeleton-pulse` **被 `dist/pages/assets/index.js` 引用** + 在 `app.wxss` 有规则 | 原来只有「`@keyframes pulse` 存在」的门禁 —— **存在 ≠ 被用**。动画定义了却没人触发，所有门禁照样全绿 |
| `.asset-loading` 已从产物消失 | TSX 与 SCSS 两处都要清，只清一处时另一处会静默留着 |

> ⚠️ 类名字符串要查**页面 bundle**（`dist/pages/assets/index.js`），不是 `app.wxss` ——
> 从 `app.wxss` 看不出「谁在用它」。

---

## 4. 🔴 我自己写了一条「永远为真」的门禁，被对抗测试抓出来

门禁 ③ 第一版：

```js
const REUSED = ['asset-group', 'asset-grid', 'asset-cell', 'asset-img']
const missing = REUSED.filter((cls) => !assetsCode.includes(`'${cls}'`))   // ❌ 整份文件
```

**问题**：真实列表本身就已经含有这四个字符串
（`className='asset-group'` 等）⇒ 骨架屏就算改用 `asset-skeleton-fill`，
整份文件里照样找得到 `'asset-img'`（真列表那份）⇒ **这条判据永远不会红**。

**修法**：只截取骨架屏那段 JSX，并加一条守卫：

```js
const skStart = assetsCode.indexOf("className='asset-skeleton skeleton-pulse'")
const skEnd = skStart >= 0 ? assetsCode.indexOf(') : null}', skStart) : -1
const skeletonJsx = skStart >= 0 && skEnd > skStart ? assetsCode.slice(skStart, skEnd) : ''
assert.ok(skeletonJsx.length > 0, '取不到骨架屏那段 JSX —— 这条判据会退化成永远为真，必须先修它。')
```

⇒ 「**留一条永远为真的断言比没有更坏**」这次是我自己犯的。
**凡判据里出现「在整份文件里找某个字符串」，先问：这个字符串是不是别处本来就有？**

---

## 5. 对抗测试（`_diag/adversarial-asset-skeleton.py`）**10/10**

| 用例 | 期望 | 实际 |
|---|---|---|
| C0 控制组（不改） | 绿 | ✅ |
| C1 **负控制组**（加一条合法的骨架条） | 绿 | ✅ |
| M1 去掉 `skeleton-pulse` | 红（门禁 ①） | ✅ 命中 `asset-skeleton skeleton-pulse` |
| M2 骨架屏改成常驻（`{true ? (`） | 红（门禁 ②） | ✅ 命中 `条件渲染` |
| M3 占位块改用自造类 | 红（门禁 ③） | ✅ 命中 `复用真实列表的类` |
| M4 SCSS 里 `.asset-loading` 回来 | 红（门禁 ④） | ✅ 命中 `asset-loading` |
| M5 SCSS 里 `.asset-skeleton` 被改名 | 红（门禁 ⑤） | ✅ 命中 `找不到 .asset-skeleton` |
| D0 控制组（产物级不改） | 绿 | ✅ |
| D1 产物里去掉 `skeleton-pulse` | 红 | ✅ 命中 `skeleton-pulse` |
| D2 产物里 `asset-loading` 回来 | 红 | ✅ 命中 `asset-loading` |

还原：4 个文件（TSX / SCSS / `dist/pages/assets/index.js` / `dist/app.wxss`）**SHA-256 全部一致** ✅

---

## 6. 「看图」那一半

骨架屏只在首次加载时显示，模拟器里没有服务端 ⇒ `loadAssets()` 很快失败回落缓存，
骨架屏**只闪几毫秒**，截不到。
⇒ 改**编译产物** `dist/pages/assets/index.js`，把渲染条件 `v&&!O.current` 强制成 `true`，
截图后还原（`_diag/see-asset-skeleton.py`）。

| 截图 | 看到什么 |
|---|---|
| `_diag/shots/skeleton-assets.png` | 2 组骨架：每组两条骨架条（左宽右窄）+ 2×2 圆角占位格，整体脉动 |
| `_diag/shots/skeleton-restored.png` | 还原后 = 正常空态（「还没有作品」+「去创作」），无回归 |

还原后 `.asset-skeleton` 在模拟器里 `success: false`（元素不存在）⇒
**骨架屏确实是条件渲染的，不是常驻**。

---

## 7. 未验证 / 需真机

- **只有模拟器，没有真机。** 骨架屏的几何、脉动观感都需真机复测。
- 模拟器里没有服务端 ⇒ **从没看到过「真实加载中」的骨架屏** ——
  看到的是把渲染条件强制成 `true` 之后的样子。两者在 DOM 上等价，但**严格说不是同一个状态**。
- `prefers-reduced-motion` 在小程序 WebView 里是否真生效，**仍未验证**。
- `.asset-skeleton-bar.is-title` 的 `height: 13px` 在产物里是 `24.80916rpx`（= 12.9px），
  但模拟器 `size` 报 **12** —— 疑为测量取整，**未证实**（CSS 源码与产物顺序/特异性都正确）。

---

## 8. 顺手发现（**没改**，留作 P1-3 的输入）

资产库里有一批**和 8 个死令牌同类**的「被覆盖的死声明」：

| 位置 | 死的声明 | 被谁覆盖 |
|---|---|---|
| `.asset-notice`（L1552） | `color: #8d948e` | L2554 逗号组的 `var(--muted)` |
| `.asset-loading`（已删） | `color: #717972` | 同上 |
| `.asset-group-heading .asset-skill`（L1493） | `color: #717972` | L2551 的 `var(--muted)` |
| `.asset-hint`（L1568） | `color: #5f6660` | L2554 逗号组的 `var(--muted)` |

⇒ **「同一选择器、同特异性、后面又被覆盖」这种死声明，全项目可能远不止 8 个。**
P1-3 第 2/3 步可以顺手用脚本扫一遍（现在只扫了令牌块）。

---

## 9. 文件清单

| 文件 | 改动 |
|---|---|
| `src/pages/assets/index.tsx` | 文字加载态 → 骨架屏；新增 `SKELETON_GROUPS` / `SKELETON_CELLS` |
| `src/styles/forme.scss` | 删 `.asset-loading` 块 + 从逗号组摘成员；新增 `.asset-skeleton` / `.asset-skeleton-bar`（86,697 → **87,325 B**） |
| `scripts/test-creator-ui.mjs` | +5 条源码门禁 |
| `scripts/verify-dist.mjs` | +2 条产物门禁（**64 → 66 项**） |
| `_diag/apply-asset-skeleton.py` | **新增** 带 5 条自检的改动脚本 |
| `_diag/adversarial-asset-skeleton.py` | **新增** 对抗测试 10 用例 |
| `_diag/see-asset-skeleton.py` | **新增** 强制渲染 + 截图 + 量尺寸 |
| `docs/ui-improvement-p1.md` | §1.2 加推翻说明；§3 重写；§11 勾掉 P1-2 |

**本轮实测**：`npm run release` **EXIT=0**；`verify:dist` **66 项通过 · 0 项提醒 · 0 项阻断**；
包体 **74 文件 · 1,736,674 B · 82.81% · 余量 352.0 KB**（比改前 **+606 B**）。

---

## 10. 下一步

方案 §11 顺序：**P1-1（灵感复刻一页）** → P1-4（按钮触感）→ P1-3 第 2/3 步 → P1-5（轮播 A）。
