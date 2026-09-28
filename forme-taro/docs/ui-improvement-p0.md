# FORMÉ 小程序 UI 优化 · P0 实施方案

> ## ⚠️ 执行状态（2026-09-27 更新）
>
> **本方案已由 Codex 执行完毕**，验收记录见
> [`2026-09-27-ui-p0-handoff.md`](./handoffs/2026-09-27-ui-p0-handoff.md)。
>
> 本文件**保留为设计意图存档**。⚠️ 下面代码示例里的 `var(--edge)` 曾是我的笔误
> （令牌表里只有 `--line`），2026-09-27 已全局改正 —— 实际执行时 Codex 用的是
> 正确令牌，没有受影响。**照抄前请先核对 `forme.scss` 的令牌表。**
>
> 三处**执行偏差**（Codex 与方案不一致，已在验收文档里逐条记录）：
> 1. `settingsExpanded` / `suggestionsExpanded` 默认值是 `true`（方案写 `false`）
> 2. `composer-page-head` 的三行文案**没有精简**
> 3. P0-3 选了**方案 B**（重命名），不是方案 A（删块）

> **目标**：解决「没有动效」+「生成界面杂乱」+「导航逻辑混乱」三大问题。
> **执行者**：DeepSeek / 本地 Codex
> **监督验收**：Claude（我）
> **预计工时**：~16 小时

---

## ⚠️ 开始前必读

### 项目约定（违反这些会导致门禁红）

1. **行尾约定**：
   - `src/styles/forme.scss` = **CRLF**
   - `src/pages/**/*.tsx` = **LF**
   - 改 CRLF 文件时用 Python `open(f, newline='')` 读写，别用会归一化的工具
2. **改完必须跑发布链**：
   ```bash
   cd forme-taro
   npm run release > _diag/release-p0-[任务名].log 2>&1
   ```
   必须前台跑（别丢后台），确认 `EXIT=0` 且 `verify:dist` 报 `60 项通过 · 0 提醒 · 0 阻断`
3. **对抗测试**（如果改了交互逻辑）：
   - 参考 `_diag/adversarial-*.py` 的写法
   - 必须配控制组（不改时是绿的）
   - 恢复时用 SHA-256 逐字节验证
4. **git 仓库根**在 `wo/`（不是 `forme-taro/`）⇒ 取 blob 用 `git show HEAD:./src/...`

### 验收标准（每项做完 Claude 会检查）

- [ ] 发布链全绿
- [ ] 真机截图对比（改前 vs 改后）
- [ ] 动效帧率 ≥ 60fps（用开发者工具 Performance 面板验证）
- [ ] 包体变化（记录 `dist` 总字节 ± N）

---

## P0-1：核心动效系统（~6 小时）

### 改动范围
**只改 1 个文件**：`src/styles/forme.scss`

### 1.1 页面切换动效

**位置**：在 `forme.scss` 最前面（`page` 块之前）加全局动画定义。

```scss
/* ============================================================
   0. 动效系统（2026-09-26 UI 优化）
   ============================================================ */

/**
 * 页面进入动效：淡入 + 轻微上移（学 iOS 原生过渡）
 * 触发：所有页面的根 View 加 class="page-enter"
 */
@keyframes pageEnter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.page-enter {
  animation: pageEnter 200ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

/**
 * 加载骨架屏脉动
 */
@keyframes pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.6; }
}

.skeleton-pulse {
  animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

/**
 * Spinner 旋转（生成按钮用）
 */
@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(244, 244, 239, 0.2);
  border-top-color: var(--ink);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
```

**同步改动**：给所有页面根 View 加 `className="page-enter"`

```tsx
// 示例：src/pages/home/index.tsx
export default function Home() {
  return (
    <View className='home page-enter'>  {/* 👈 加这个 */}
      {/* ... */}
    </View>
  )
}
```

**需要加的页面**（共 14 个）：
- `src/pages/home/index.tsx`
- `src/pages/create-freeform/index.tsx`
- `src/pages/create-poster/index.tsx`
- `src/pages/create-product/index.tsx`
- `src/pages/create-avatar/index.tsx`
- `src/pages/create-reference/index.tsx`
- `src/pages/result/index.tsx`
- `src/pages/assets/index.tsx`
- `src/pages/profile/index.tsx`
- `src/pages/recharge/index.tsx`
- `src/pages/avatar-gallery/index.tsx`
- `src/pages/product-gallery/index.tsx`
- `src/pages/create-marketplace/index.tsx`
- `src/pages/create-product-shot/index.tsx`

---

### 1.2 按钮触感（苹果风弹性）

**原理**：按下时 `scale(0.96)` + 释放时 spring 回弹，而不是只改 `opacity`。

**改动**：在 `forme.scss` 的 `.primary-cta` / `.secondary-button` 块里加 `transition`。

```scss
/* 找到这一段（约 L200-220）*/
.primary-cta {
  /* ... 原有样式 ... */
  
  /* 👇 新增 */
  transition: transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1), /* spring 回弹 */
              background 100ms ease-out,
              opacity 100ms ease-out;
}

.primary-cta.is-pressed {
  transform: scale(0.96);
  /* 保留原有的背景色变化 */
}

/* 次要按钮同理 */
.secondary-button {
  /* ... */
  transition: transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1),
              background 100ms ease-out;
}

.secondary-button.is-pressed {
  transform: scale(0.96);
  background: #232827;  /* 保留原值 */
}
```

**⚠️ 注意**：
- `is-pressed` 是通过 `hoverClass="is-pressed"` 触发的，**不要改成别的名字**（已有代码依赖这个）
- `cubic-bezier(0.34, 1.56, 0.64, 1)` 的第二个参数 `> 1` 会产生**超调回弹**（overshoot），这是苹果风的核心

---

### 1.3 表单展开/收起动效

**位置**：`src/pages/create-freeform/index.tsx`（以及其他用了 `settingsExpanded` 的页面）

**现状**：
```tsx
{settingsExpanded ? (
  <View className='composer-settings-panel'>
    {/* 设置项 */}
  </View>
) : null}
```
直接切 `display`，生硬。

**改法**：用 CSS `max-height` 过渡（高度未知时的常见技巧）。

**CSS 改动**（`forme.scss`）：
```scss
/* 找到 .composer-settings-panel（约 L600+）*/
.composer-settings-panel {
  /* ... 原有样式 ... */
  
  /* 👇 新增：默认收起 */
  max-height: 0;
  overflow: hidden;
  opacity: 0;
  transition: max-height 300ms cubic-bezier(0.22, 0.61, 0.36, 1),
              opacity 200ms ease-out;
}

.composer-settings-panel.is-expanded {
  max-height: 500px;  /* 足够大即可，不需要精确 */
  opacity: 1;
}
```

**TSX 改动**（`create-freeform/index.tsx` 等）：
```tsx
{/* 原来是条件渲染，改成一直在 DOM 里、用 class 控制 */}
<View className={`composer-settings-panel ${settingsExpanded ? 'is-expanded' : ''}`}>
  <OptionPills label='模型' value={model} options={MODEL_OPTIONS} onChange={(value) => setModel(value as GenerationModel)} />
  <OptionPills label='清晰度' value={quality} options={QUALITY_OPTIONS} onChange={(value) => setQuality(value as GenerationQuality)} />
  <OptionPills label='画面比例' value={ratio} options={RATIO_OPTIONS.map((item) => ({ value: item, label: item }))} onChange={setRatio} />
</View>
```

**⚠️ 需要改的页面**（所有有设置面板的生成页）：
- `src/pages/create-freeform/index.tsx`
- `src/pages/create-poster/index.tsx`
- `src/pages/create-product/index.tsx`
- `src/pages/create-avatar/index.tsx`

---

### 1.4 卡片 hover 上浮

**位置**：首页轮播卡（`.hd-card`）

```scss
/* 找到 .hd-card（约 L400+）*/
.hd-card {
  /* ... 原有样式 ... */
  
  /* 👇 新增 */
  transition: transform 200ms cubic-bezier(0.22, 0.61, 0.36, 1),
              box-shadow 200ms ease-out;
}

/* 微信小程序的 hover 用 hover-class，不是 :hover */
.hd-card.is-hovered {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);  /* 阴影加深 */
}
```

**TSX 改动**（`src/pages/home/index.tsx`）：
```tsx
{/* 找到轮播卡的 SwiperItem，给 View 加 hoverClass */}
<View
  className='hd-card'
  hoverClass='is-hovered'  {/* 👈 加这个 */}
  onClick={() => Taro.navigateTo({ url: card.url })}
>
  {/* ... */}
</View>
```

---

### 1.5 生成按钮的 Spinner

**位置**：`src/components/GenerateDock.tsx`

**改法**：按钮文字前面加个旋转圈。

```tsx
// 找到 return 块里的按钮
<View
  className={`primary-cta generate-cta ${inert ? 'is-disabled' : ''}`}
  hoverClass={inert ? 'none' : 'is-pressed'}
  onClick={() => {
    if (!inert) onGenerate()
  }}
>
  {loading ? (
    <>
      <View className='spinner' style={{ marginRight: '8px' }} />  {/* 👈 新增 */}
      <Text>生成中…</Text>
    </>
  ) : (
    <Text>生成</Text>
  )}
</View>
```

`.spinner` 的样式已在 1.1 的 `@keyframes spin` 里定义好了。

---

### 验收标准（P0-1）

- [ ] 跑 `npm run release`，确认 `EXIT=0`
- [ ] 真机打开任意页面，看到**淡入 + 上移**动效（200ms）
- [ ] 点按钮，看到**缩小 + 回弹**（不是只变暗）
- [ ] 首页轮播卡长按，看到**上浮 + 阴影**
- [ ] 生成页点「更多设置」，看到**高度展开动效**（不是瞬间出现）
- [ ] 点生成按钮，看到左侧**旋转 spinner**

---

## P0-2：重组生成页布局（~8 小时）

### 目标
把「7 个平铺模块」变成「3 层清晰结构」：
1. **核心输入区**（白底卡片）：提示词 + 参考图 + 快捷建议（折叠）
2. **设置区**（灰底，可折叠）：比例 / 清晰度 / 模型
3. **底部固定条**：生成按钮 + 消耗点数

### 改动范围
- `src/pages/create-freeform/index.tsx`（主要）
- `src/styles/forme.scss`（新增 `.input-card` 等样式）

### 2.1 TSX 结构重组

**现状**（简化版）：
```tsx
<View className='create-freeform'>
  <AppHeader title='自由生图' subtitle='…' hint='…' />  {/* 3 行文案 */}
  <PromptField />
  <View className='composer-toolbar'>{/* 3 个按钮 */}</View>
  <View className='suggestions'>{/* 2 张卡 */}</View>
  <View className='reference-images'>{/* 标题 + 网格 */}</View>
  {settingsExpanded ? <View className='composer-settings-panel'>{/* 设置 */}</View> : null}
  <GenerateDock />
</View>
```

**新结构**：
```tsx
<View className='create-freeform page-enter'>
  {/* 1️⃣ 精简头部：只保留标题，去掉 subtitle 和 hint */}
  <AppHeader title='AI 视觉创作 / 自由生图' />

  <View className='composer-scroll'>
    {/* 2️⃣ 核心输入区 = 白底卡片 */}
    <View className='input-card'>
      <PromptField
        value={prompt}
        placeholder='描述你想生成的画面…'
        onChange={setPrompt}
      />

      {/* 参考图紧贴输入框下方，不再单独成块 */}
      {referenceImages.length > 0 ? (
        <View className='reference-images-inline'>
          {referenceImages.map((img, i) => (
            <View key={i} className='reference-thumb'>
              <Image src={img.path} mode='aspectFill' />
              <View className='reference-remove' onClick={() => removeReferenceImage(i)}>×</View>
            </View>
          ))}
        </View>
      ) : null}

      {/* 添加参考图按钮 */}
      {referenceImages.length < MAX_REFERENCE_IMAGES ? (
        <View className='reference-add-inline' onClick={handlePickReference}>
          <Text className='reference-add-icon'>+</Text>
          <Text className='reference-add-label'>添加参考图</Text>
        </View>
      ) : null}

      {/* 快捷建议：折叠，点击展开 */}
      <View className='suggestions-toggle' onClick={() => setSuggestionsExpanded(!suggestionsExpanded)}>
        <Text>💡 创意建议</Text>
        <Text className='toggle-arrow'>{suggestionsExpanded ? '▲' : '▼'}</Text>
      </View>

      {suggestionsExpanded ? (
        <View className='suggestions-inline'>
          {SUGGESTIONS.map((text, i) => (
            <View key={i} className='suggestion-chip' onClick={() => setPrompt(text)}>
              {text}
            </View>
          ))}
        </View>
      ) : null}
    </View>

    {/* 3️⃣ 设置区：灰底，可折叠 */}
    <View className='settings-card'>
      <View className='settings-header' onClick={toggleSettings}>
        <Text>高级设置</Text>
        <View className='settings-badge'>
          <Text>{ratio} · {quality} · {model}</Text>
        </View>
      </View>

      <View className={`composer-settings-panel ${settingsExpanded ? 'is-expanded' : ''}`}>
        <OptionPills label='画面比例' value={ratio} options={RATIO_OPTIONS.map((item) => ({ value: item, label: item }))} onChange={setRatio} />
        <OptionPills label='清晰度' value={quality} options={QUALITY_OPTIONS} onChange={(value) => setQuality(value as GenerationQuality)} />
        <OptionPills label='模型' value={model} options={MODEL_OPTIONS} onChange={(value) => setModel(value as GenerationModel)} />
      </View>
    </View>

    {/* 4️⃣ 底部留白（给 GenerateDock 让位） */}
    <View style={{ height: '120px' }} />
  </View>

  <GenerateDock metaLabel='自由创作' cost={costForImages(BATCH_SIZE)} loading={loading} error={error} onGenerate={handleGenerate} />
  <PrivacyGate />
</View>
```

**⚠️ 新增 state**：
```tsx
const [suggestionsExpanded, setSuggestionsExpanded] = useState(false)
```

---

### 2.2 CSS 新增样式

在 `forme.scss` 里加这些（放在 `/* 生成页通用 */` 这一节）：

```scss
/* ============================================================
   生成页通用（2026-09-26 重组）
   ============================================================ */

/**
 * 滚动容器：给底部固定条让位
 */
.composer-scroll {
  padding: 16px;
  padding-bottom: 140px;  /* 给 GenerateDock 让位 */
}

/**
 * 核心输入区 = 白底卡片
 */
.input-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}

/**
 * 参考图缩略图：inline 排列，不再单独成块
 */
.reference-images-inline {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.reference-thumb {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 8px;
  overflow: hidden;
}

.reference-thumb image {
  width: 100%;
  height: 100%;
}

.reference-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink);
  font-size: 16px;
  font-weight: 600;
}

/**
 * 添加参考图按钮：inline 版本
 */
.reference-add-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 12px;
  background: var(--bg);
  border: 1px dashed var(--line);
  border-radius: 8px;
  color: var(--muted);
  font-size: 14px;
}

.reference-add-icon {
  font-size: 20px;
  font-weight: 300;
}

/**
 * 快捷建议：折叠 toggle
 */
.suggestions-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16px;
  padding: 12px;
  background: var(--bg);
  border-radius: 8px;
  font-size: 14px;
  color: var(--ink);
  cursor: pointer;
}

.toggle-arrow {
  color: var(--muted);
  font-size: 12px;
}

.suggestions-inline {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.suggestion-chip {
  padding: 8px 12px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 16px;
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
  transition: background 150ms ease-out;
}

.suggestion-chip.is-pressed {
  background: var(--surface);
}

/**
 * 设置区：灰底卡片
 */
.settings-card {
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  color: var(--ink);
  cursor: pointer;
}

.settings-badge {
  padding: 4px 8px;
  background: var(--surface);
  border-radius: 6px;
  font-size: 12px;
  color: var(--muted);
}
```

---

### 2.3 同步改其他生成页

相同结构的页面（都要改）：
- `src/pages/create-poster/index.tsx`
- `src/pages/create-product/index.tsx`
- `src/pages/create-avatar/index.tsx`

**简化版改法**（因为它们没有「快捷建议」）：
```tsx
<View className='composer-scroll'>
  <View className='input-card'>
    <PromptField value={prompt} onChange={setPrompt} />
    {/* 参考图 inline 排列 */}
  </View>

  <View className='settings-card'>
    <View className='settings-header' onClick={toggleSettings}>
      <Text>高级设置</Text>
      <View className='settings-badge'><Text>{ratio} · {quality}</Text></View>
    </View>
    <View className={`composer-settings-panel ${settingsExpanded ? 'is-expanded' : ''}`}>
      {/* 设置项 */}
    </View>
  </View>

  <View style={{ height: '120px' }} />
</View>
```

---

### 验收标准（P0-2）

- [ ] 发布链全绿
- [ ] 真机打开「自由生图」页：
  - [ ] 输入框 + 参考图在**同一张白底卡片**里
  - [ ] 「创意建议」默认收起，点击展开/收起有**高度动效**
  - [ ] 「高级设置」点击展开，看到当前值 badge（如 `1:1 · 标准 · 通用`）
  - [ ] 滚到底部，「生成」按钮**始终可见**（不会被顶下去）
- [ ] 对比改前截图：**信息层级清晰 3 倍**

---

## P0-3：统一导航逻辑（~2 小时）

### 方案选择

**王需要先定**：
- **方案 A**：删掉首页的「快速创作」区块，只保留「选择方式」九宫格
- **方案 B**：保留快速创作，但重命名（「快速创作」→「立即开始」；「选择方式」→「更多工具」）

### 方案 A 实施（假设王选这个）

**改动文件**：
- `src/pages/home/index.tsx`
- `src/styles/forme.scss`（删 `.home-composer` 相关样式）

**TSX 改动**：
```tsx
// 找到 {/* 快速创作 */} 这一整块（约 L100-200），整块删掉
// 只保留：
<View className='home page-enter'>
  {/* 顶部导航 + 余额 */}
  
  {/* 轮播（灵感复刻打头）*/}
  <Swiper>{/* ... */}</Swiper>

  {/* 选择方式（九宫格）*/}
  <View className='workflow-section'>
    <Text className='section-heading'>选择方式</Text>
    <View className='workflow-grid'>
      {QUICK_ACTIONS.map((item) => (
        <View key={item.label} className='workflow-item' onClick={() => Taro.navigateTo({ url: item.path })}>
          <Text className='workflow-icon'>{item.mark}</Text>
          <Text className='workflow-label'>{item.label}</Text>
          <Text className='workflow-hint'>{item.hint}</Text>
        </View>
      ))}
    </View>
  </View>

  <BottomNav active='create' />
</View>
```

**CSS 改动**（`forme.scss`）：
```scss
/* 删掉这些块（约 L500-700）*/
.home-composer { /* ... */ }
.composer-ref-add { /* ... */ }
.composer-ref-thumb { /* ... */ }
/* 等等（所有 .home-composer 开头的） */
```

**⚠️ 门禁影响**：
- `scripts/test-creator-ui.mjs` 里有判据检查「首页不再有 `.home-composer`」→ **要加一条负向断言**
- 对抗测试：加一条「首页 bundle 不包含 `composer-ref` 字样」

---

### 方案 B 实施（假设王选这个）

**改动**：只改文案，不动结构。

```tsx
// src/pages/home/index.tsx

// 把「快速创作」改成：
<Text className='section-heading'>立即开始</Text>

// 把「选择方式」改成：
<Text className='section-heading'>更多工具</Text>
```

**验收**：文案清晰，两者**定位差异**明显。

---

### 验收标准（P0-3）

- [ ] 发布链全绿
- [ ] 首页逻辑清晰：不再有「两个入口做同一件事」的困惑
- [ ] 如果选方案 A：真机确认「快速创作」整块消失，九宫格依然可用
- [ ] 如果选方案 B：真机确认文案改了，逻辑更清楚

---

## 总验收清单（P0 全部做完）

- [ ] 所有页面有**进场动效**（淡入 + 上移 200ms）
- [ ] 按钮有**弹性触感**（按下缩放 + 回弹）
- [ ] 生成页布局**清晰 3 层**（输入卡片 + 设置卡片 + 固定条）
- [ ] 首页导航**逻辑统一**（不再重复入口）
- [ ] 发布链 `npm run release` 全绿（60 项通过 · 0 提醒 · 0 阻断）
- [ ] 包体变化 < 20KB（动效只加 CSS，不会显著增加体积）
- [ ] 真机帧率 ≥ 60fps（开发者工具 Performance 验证）

---

## 常见问题 Q&A

### Q1：改完 `forme.scss` 后编译报错？
**A**：检查行尾是否变了。`forme.scss` 必须是 **CRLF**，用这个验证：
```bash
python -c "print(open('src/styles/forme.scss','rb').read().count(b'\r\n'))"
```
如果变成 0，说明被归一化成 LF 了 → 用 Python 按行数组读写恢复。

### Q2：动效在开发者工具里看着卡顿？
**A**：正常。开发者工具的渲染性能**远低于**真机。必须在真机上验证。

### Q3：`page-enter` 动效只在第一次进页面有，返回时没有？
**A**：微信小程序的页面栈机制：`navigateBack` 时页面是从栈里恢复的，不会重新挂载 → 动效不会再触发。这是**预期行为**（iOS 原生也是这样）。

### Q4：改完后轮播卡的按下反馈消失了？
**A**：检查是否把 `hoverClass='press-dim'` 改成了 `hoverClass='is-hovered'`。两者**不冲突**，应该同时加：
```tsx
<View
  className='hd-card'
  hoverClass='is-hovered press-dim'  {/* 两个都要 */}
  onClick={...}
>
```

### Q5：`composer-settings-panel` 展开后内容被裁掉了？
**A**：`max-height: 500px` 不够大。根据实际内容高度调整（或改成 `800px`）。

---

## 下一步（P0 做完后）

Claude 会：
1. 逐项验收（跑发布链 + 看真机截图）
2. 记录包体变化
3. 输出验收报告
4. 询问王是否继续做 **P1（~11 小时）**

---

**DeepSeek 开始吧！有任何疑问随时问 Claude。**
