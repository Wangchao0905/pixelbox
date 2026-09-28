# 2026-09-27 · UI 优化 P0 验收交接文档

> **文档性质**：验收报告 + 交接文档。
> **方案原文**：[`../ui-improvement-p0.md`](../ui-improvement-p0.md)（设计意图存档）
> **验收人**：阿查
> **执行人**：Codex（王本机安装的工具）
> **王的要求**：「你制定方案并监督和验收，具体实施交给 deepseek 或者调用本机安装的 codex 客户端来完成」

---

## 0. 一句话结论

**P0 三项都动了，发布链全绿，但只有 P0-1 是完整达标的。**
P0-2 只落地了 1/4 个页面（其余三页结构不同，**我的方案假设错了**，不是执行方遗漏）；
P0-3 选了方案 B 但**王没有确认过选哪个**。

| 项 | 方案要求 | 实际 | 判定 |
|---|---|---|---|
| **P0-1** 核心动效 | 5 个子项 | 5 个全做，且**优于方案** | ✅ 通过 |
| **P0-2** 生成页重组 | 7 模块 → 3 层 | 只做了「自由生图」1 页 | ⚠️ **部分**（1/4） |
| **P0-3** 导航逻辑 | 方案 A 或 B（王定） | 做了方案 B（重命名） | ⚠️ 通过但**未经确认** |

**发布链**：`EXIT=0`，`60 项通过 · 0 项提醒 · 0 项阻断`
**包体**：1,717,239 → **1,736,883 B**（**+19,644 B / +19.2 KB**），余量 371.0 → **351.8 KB**（82.82%）

---

## 1. 时间线（怎么确认「已经执行过」的）

发现过程本身值得记录 —— 我第一次审计时**判断错了**。

| 时间 | 事件 | 证据 |
|---|---|---|
| 09-26 16:39 | 王：「先做 P0，交给 deepseek」 | 对话 |
| 09-26 16:44 | 我写出 `docs/ui-improvement-p0.md` | 文件 |
| 09-26 16:56 | **14 个页面统一加上 `page-enter`** | 文件 mtime |
| 09-26 17:01 | `GenerateDock.tsx` 加 spinner | 文件 mtime |
| 09-26 17:44 | **`forme.scss` 加动效系统** | 文件 mtime |
| 09-26 18:25 | `create-freeform` 重组（P0-2） | 文件 mtime |
| 09-27 10:00 | 王：「给完完整的交接文档」 | 对话 |

**这不是我做的** —— 我的上一个任务（Task D）在 09-26 16:14 就结束了。
所以是**王把方案交给了 Codex，Codex 在 16:56–18:25 执行完毕**。

> ⚠️ **诚实标注**：以上是**推断**。文件系统只能证明「这些文件在这些时间被改过」，
> **不能证明是谁改的**。如果另有其人，请王更正。

### 1.1 我犯的错（第一次审计）

我第一次审计时写了「**全项目只有 1 处动效**」，并据此判定「P0-1 是重复劳动」。
**这是错的**，原因是我用了 **shell 内联正则**：

```bash
python -c "... re.finditer(r'^[^/\n]*?(transition|animation|...)' ...)"
```

`animation:` 和它所在的选择器 `.page-enter {` 在**不同行**，我的正则要求「行首到关键字之间无换行」⇒ **静默返回 0 命中**。
于是我漏掉了整套动效系统。

> 🔴 **这正是项目铁律 #5**：「任何带 `\s` / 引号 / 括号的正则，一律写进 `.py` 文件跑，不要走 shell 内联（已连续踩 4+ 次，静默返回 0 命中）」。
> **我又踩了一次。** 改用 `_diag/audit-motion.py` 后真相立刻出来。

---

## 2. P0-1 验收：核心动效 ✅ 完整达标

### 2.1 逐项核对

| 子项 | 方案要求 | 实际 | 证据 |
|---|---|---|---|
| 1.1 页面进场 | 14 页加 `page-enter` | ✅ 14/14 | `@keyframes pageEnter` 在 `src` 与 `dist/app.wxss` 都在 |
| 1.2 按钮弹性 | `transition` + `scale(0.96)` | ✅ | `.primary-cta` / `.secondary-button` 都有，且用了 `cubic-bezier(0.34, 1.56, 0.64, 1)`（超调回弹） |
| 1.3 表单展开 | `is-expanded` + `max-height` | ✅ | `create-freeform` L154 是模板字符串写法，**不是**条件渲染 ⇒ 过渡真的生效 |
| 1.4 卡片 hover | `hoverClass` + `translateY(-2px)` | ✅ | `hoverClass='is-hovered press-dim'`（**两个类都加了**） |
| 1.5 生成按钮 spinner | 按钮内旋转圈 | ✅ | `<View className='spinner' />` + `@keyframes spin` |

**产物级复核**（`dist/app.wxss`，68,778 B）：

```
@keyframes : pageEnter / pulse / spin     ← 3 个，全在产物里
animation  : 8 处
transition : 24 处
transform  : 24 处
prefers-reduced-motion 降级块 : ✅ 在
```

### 2.2 🏆 Codex 做得比我方案更对的地方（值得记）

**问题**：我方案里让 `.hd-card` 同时承担「轮播 scale 动画」（280ms）和「hover 上浮」（200ms）。
但 `.hd-card` 上已经有 `transform: translateX(...) scale(...)`（轮播用）——
如果 hover 的 `translateY(-2px)` 也写在同一元素上，**两个 transform 会互相覆盖**（后写的赢），
轮播的缩放会**静默失效**。

**Codex 的处理**：把轮播的 transform **下沉到内层 `.hd-card-content`**，外层 `.hd-card` 只负责 hover。

```
.hd-card          → transition: transform 200ms, box-shadow 200ms;   /* hover 用 */
.hd-card-content  → transition: transform 280ms;                     /* 轮播用 */
```

这是**正确的分层**，我方案里没写到。

### 2.3 ⚠️ 遗留瑕疵：`.hd-card` 上有一条孤儿 transition

`forme.scss` **L2683**（旧块）里还留着：

```scss
.hd-card { … transition: transform 280ms cubic-bezier(0.22, 0.61, 0.36, 1); }
```

但轮播的 transform 已经下沉到 `.hd-card-content`（L3356）⇒ **L2683 这条 transition 现在没有任何东西可过渡**。
同时 L3346（新块）又给 `.hd-card` 写了一条 `transition` ⇒ **同一选择器两条 transition，后者覆盖前者**。

**影响**：**良性**（功能正常，只是有一条死声明 + 同选择器重复定义）。
**建议**：把 L2683 那条 transition 删掉，或把 L3346 合并进 L2683。

---

## 3. P0-2 验收：生成页重组 ⚠️ 只完成 1/4

### 3.1 已完成的部分：「自由生图」✅

`create-freeform/index.tsx` 按方案重组完毕，新结构全在：

| 新类名 | SCSS 定义 | TSX 使用 |
|---|---|---|
| `composer-scroll` | ✅ | ✅ |
| `input-card` | ✅ | ✅ |
| `reference-images-inline` | ✅ | ✅ |
| `reference-add-inline` | ✅ | ✅ |
| `suggestions-toggle` / `suggestions-inline` / `suggestion-chip` / `toggle-arrow` | ✅ | ✅ |
| `settings-card` / `settings-header` / `settings-badge` | ✅ | ✅ |

**关键复核：TSX 用了但 SCSS 没定义的类 = 0**（这类「编译通过、没样式、不报错」是典型的沉默失败，专门查了）。

**令牌复核**：`forme.scss` 里 `var(--xxx)` 引用的令牌 **33 个全部有定义**，没有悬空引用。

### 3.2 🔴 三处偏离方案

| # | 偏离 | 方案写的 | 实际 | 我的判断 |
|---|---|---|---|---|
| 1 | 默认展开状态 | `false`（收起） | **`true`（展开）** | **接受** —— Codex 在代码里留了理由：都收起会让页面「像旧版 composer」。这是合理的产品判断 |
| 2 | 头部文案 | 精简成 1 行 | **保留 3 行**（`composer-page-head`） | 待王定 |
| 3 | `skeleton-pulse` | 用于加载骨架 | **定义了但全项目没人用** | 死代码，建议删或补上用它的地方 |

### 3.3 🔴 我的方案有缺陷：其他三页结构与「自由生图」完全不同

方案 §2.3 写「**同步改** create-poster / create-product / create-avatar」。
**这个前提是错的。** 实测这三页的结构是：

```
preview-panel        ← 大图预览（可复用模板 + 收藏按钮）
structured-intro     ← eyebrow + h1 双行 + copy（和 composer-page-head 同构）
structured-section / replace-upload-section   ← 字段式表单
replace-template-meta ← 模板元信息（提示词已锁定）
```

它们：
- **本来就是字段式（表单驱动）**，不是提示词式
- **本来就没有「设置面板」**（参数由模板锁定）⇒ 不需要 `is-expanded` 改造

所以「漏了改」这个判断**不成立**。准确的说法是：
**方案没有针对「字段式生成页」给出具体设计**（我错误地假设了四页同构）。

**这三页仍可做的等价改造**（需要重新设计方案）：
- `structured-intro` 的三行文案是否精简
- 平铺的表单字段是否收进卡片（学 `input-card`）
- `preview-panel` 的收藏按钮 `♡` 目前只弹 Toast「已收藏到灵感夹」，**没有实际功能** —— 这是个真问题

---

## 4. P0-3 验收：导航逻辑 ⚠️ 通过但未经确认

### 4.1 实际改动（选了方案 B）

| 位置 | 旧文案 | 新文案 |
|---|---|---|
| 输入卡片标题 | 快速创作 | **立即开始** |
| 区块标题 | 选择方式 | **更多工具** |
| 区块副标题 | 按你的任务开始 | **按你的任务选择** |

**复核**：旧文案「快速创作」「选择方式」**只出现在注释里**（`home/index.tsx` L169–173），
实际渲染的是新文案 ✅。

### 4.2 ⚠️ 两个问题

1. **未经王确认**。方案 §P0-3 明确写「**王需要先定**：方案 A 还是方案 B」。
   Codex 直接选了 B。**B 是合理的**（保留快捷入口，只改命名），但按项目规矩
   「遇到任何问题不要猜，先问我」——这一步应该先问。
2. **注释已过时**。`home/index.tsx` L169 还写着：
   > 现在的首页结构：轮播（灵感复刻打头）→ 快速创作 → 「选择方式」九宫格。

   实际已是「轮播 → 立即开始 → 更多工具」。L187「「快速创作」里选中的参考图」同理。

---

## 5. 🔴 最重要的一条：动效**零门禁**

**验收发现**：`verify-dist.mjs`（60 项）和 `test-creator-ui.mjs` 里
**没有任何一条判据提到 `pageEnter` / `page-enter` / `spinner` / `@keyframes` / `transition`**。

**后果**：将来任何人删掉 `page-enter`、删掉 `@keyframes spin`、把 `is-expanded` 改回条件渲染
—— **发布链依然全绿，没有任何东西会红**。

这正是本项目最警惕的那类失败：

> **沉默的失败比响亮的崩溃危险得多。**

**建议补的判据**（P0 收尾应该做）：

| 层 | 判据 |
|---|---|
| 产物级 | `dist/app.wxss` 里 `@keyframes` 数量 ≥ 3，且含 `pageEnter` / `spin` |
| 产物级 | `prefers-reduced-motion` 降级块存在 |
| 源码级 | 14 个页面根 View 都带 `page-enter`（**逐个断言，不是「至少一个」**） |
| 源码级 | `composer-settings-panel` 必须是模板字符串写法，**不是** `{cond ? <View className='composer-settings-panel'>` |

⚠️ 按项目规矩，**每条新门禁都要能证明自己真的会拦**（配对抗测试 + 控制组）。

---

## 6. 我自己的错（已修）

### 6.1 方案文档里的错误令牌

我在 `docs/ui-improvement-p0.md` 的 CSS 示例里用了 **`var(--edge)`** —— **这个令牌不存在**
（`forme.scss` 的令牌表里只有 `--line`）。**4 处**。

**影响**：如果 Codex 照抄，那些 `border: 1px solid var(--edge)` 会**静默失效**
（`var()` 解析失败 ⇒ 属性退回初始值 ⇒ 边框不画，**不报错**）。

**实际影响：无** —— 复核确认 Codex **用的是正确令牌**（`var(--edge)` 在 `forme.scss` 里出现 **0 次**）。
**已修**：方案文档里 4 处全部改成 `var(--line)`，并在文档顶部加了执行状态标注 + 一条「照抄前先核对令牌表」的警告。

### 6.2 验收脚本两次误报

1. **第一次**：shell 内联正则漏掉整套动效（见 §1.1）
2. **第二次**：我用 `re.search(r'\{settingsExpanded\s*\?', t)` 判「是否条件渲染」，
   结果匹配到了模板字符串 `` `composer-settings-panel ${settingsExpanded ? 'is-expanded' : ''}` ``
   里的 `{settingsExpanded ?` ⇒ **误报 `create-freeform` 仍是条件渲染**。

   **修正判据**：区分「静态 `className='composer-settings-panel'`」（条件渲染）
   vs「模板字符串 `className={\`composer-settings-panel`」（`is-expanded` 写法）。
   修正后判定正确 ✅。

> 教训：**验收脚本自己也会说谎**。判据写错时它会给出**看起来很像真的**错误结论。

---

## 7. 未验证（必须说清楚）

- 🔴 **没有真机 / 模拟器截图**。动效是否真的「好看」、是否真的 60fps，**只有代码证据，没有眼睛看过**。
  这是本项目一贯的缺口：「看图不能替代断言，断言也不能替代看图」。
- 🔴 **没有 `LLM_API_KEY`** ⇒ 真出图链路一次没跑过（本次改动不涉及出图，但整链仍未验证）。
- ⚠️ **动效在开发者工具里的表现 ≠ 真机**。工具渲染性能远低于真机，工具里卡不代表真机卡（反之亦然）。
- ⚠️ **`prefers-reduced-motion` 在小程序 WebView 里是否真的生效未验证**（该媒体查询在部分 WebView 上不可靠）。

---

## 8. 待办清单

### 建议立刻做（P0 收尾）
- [ ] 给动效补门禁 + 对抗测试（§5）
- [ ] 修 `home/index.tsx` L169 / L187 的过时注释（§4.2）
- [ ] 处理 `.hd-card` 的孤儿 transition（§2.3）
- [ ] 决定 `skeleton-pulse`：删掉，或补上用它的地方（§3.2 #3）

### 需要王决定
- [ ] `composer-page-head` 的三行文案要不要精简（§3.2 #2）
- [ ] 三个字段式生成页（海报/产品/头像）要不要做等价改造（§3.3）—— 需要**重新设计方案**
- [ ] `preview-panel` 的收藏按钮 `♡` 目前是**假功能**（只弹 Toast），做真还是删掉
- [ ] P0-3 选方案 B 是否确认（§4.2）

### 之后（P1 / P2）
- P1：首页轮播视觉差异化、按钮触感统一、加载状态（部分已被 P0-1 覆盖）
- P2：微交互细节、空状态插画
- ⚠️ **P1/P2 方案需按「三种页面结构」重新分类设计**，不能再假设同构

---

## 9. 附录：本次用到的验收脚本

全部在 `forme-taro/_diag/`，可复跑：

| 脚本 | 作用 |
|---|---|
| `audit-motion.py` | 真实动效审计（keyframes / animation / transition / 关键类） |
| `audit-motion-dist.py` | 动效是否进了产物 `dist/app.wxss` |
| `audit-motion-origin.py` | 动效是基线就有还是后加的（git blob 对比） |
| `verify-p0-1.py` | P0-1 的 TSX 接线（spinner / hoverClass / is-expanded） |
| `verify-p0-2-3.py` | 新类名 SCSS 定义 + 令牌悬空引用 + 死代码 |
| `verify-p0-2-3-pages.py` | 各生成页的重组标记（⚠️ 含一次误报，见 §6.2） |
| `verify-settings-panel.py` | 修正版：精确区分条件渲染 vs `is-expanded` |
| `verify-p0-gates.py` | 动效门禁存在性 + spinner 样式 + transform 分工 |
| `verify-p0-3-leftover.py` | 旧文案残留性质（注释 vs 渲染） |
| `fix-plan-doc-token.py` | 修正方案文档里的错误令牌 |

**验收命令**：

```bash
cd forme-taro
npm run release > _diag/release-p0-accept.log 2>&1; echo "EXIT=$?"
# 期望：EXIT=0，且日志里出现「60 项通过 · 0 项提醒 · 0 项阻断」
```

---

## 10. 一句话给下一个人

**P0 让界面「动起来了」，但动效没有任何东西守着。**
下一个改动之前，先把 §5 的门禁补上 —— 否则这次做的动效，下次重构会被静默删掉，而所有人都以为它还在。
