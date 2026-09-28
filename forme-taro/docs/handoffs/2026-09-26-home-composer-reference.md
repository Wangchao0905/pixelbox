# 首页「快速创作」加参考图入口（2026-09-26）

> 王的原话：
> 「在快速创作哪里左下角增加一个+号，点击上传单靠图，不要下下一步添加，
> 开始按钮改成生成按钮」
> （「单靠图」按上下文读作**参考图**，已向王确认）

三个细节由王在选项里确认：
1. 上传后的样子 → **变成缩略图，可删可换**
2. 「生成」的去向 → **跳转到「自由生图」页**（沿用原 `openComposer` 的目标页）
3. 右上角那行 → **删掉**（原「生成 1 张」）

---

## 1. 改了什么

| 文件 | 改动 |
|---|---|
| `src/pages/home/index.tsx` | 左下角 `+` 号 / 缩略图两态；`handlePickReference`；`handleRemoveReference`；`openComposer` 里交棒；`<PrivacyGate />`；按钮文案「开始」→「生成」；删掉右上角「生成 1 张」 |
| `src/styles/forme.scss` | 新增 `.composer-ref-*` 6 个类；清掉两条死类（见下） |
| `scripts/test-creator-ui.mjs` | 新增 10 条源码级断言（含 1 条 CSS 共享规则断言） |
| `scripts/verify-dist.mjs` | 新增 5 条**产物级**断言（4 must + 1 should） |

**没有新造机制。** 参考图从首页交到「自由生图」走的是一条**已有**的路：

```
src/services/reference-images.ts
  setReferenceDraft(image)      ← 首页在 navigateTo 之前调用
  takeReferenceDraft()          ← 自由生图 useState 初始化时读走并清空（一次性）
```

既有先例是 `src/pages/result/index.tsx:88`（「从生成结果再创作」）。
`create-freeform/index.tsx:36-39` 早就在消费这个草稿，所以这次**一行下游代码都没改**。

### 两态为什么是「同一张卡片、两个分支」

```jsx
{reference
  ? <View className='composer-ref-thumb' onClick={handlePickReference}>   // 已选：可换
      <Image className='composer-ref-image' src={reference.path} />
      <View className='composer-ref-remove' onClick={handleRemoveReference}>×</View>
    </View>
  : <View className='composer-ref-add' onClick={handlePickReference}>     // 未选
      <Text className='composer-ref-plus'>+</Text>
      <Text className='composer-ref-label'>参考图</Text>
    </View>}
```

---

## 2. 三个「不报错」的坑（这次踩到的和绕开的）

### ① `×` 不 `stopPropagation` ⇒ 「删不掉，反而又让我选图」

`×` 在缩略图**内部**，缩略图自己就是「换一张」的点击区。
不拦冒泡的话，点 `×` 会紧接着弹出系统相册 —— 用户看到的是「删不掉」，
而且**不报错**。这条是照 `components/UploadSlot.tsx` 的既有教训抄的：

```tsx
const handleRemoveReference = (event: any) => {
  event?.stopPropagation?.()
  setReference(undefined)
}
```

### ② 首页原来**没有** `PrivacyGate`

`wx.chooseMedia` 是隐私接口。`ensurePrivacyAuthorized()` 在**没有订阅者**时
会直接放行（把弹窗让给微信自己），所以少挂 `PrivacyGate` 时：
用户点 `+` 号 → 系统静默拦下 → **看起来像「点了没反应」**。

`PrivacyGate` 必须与可点元素**同级**，不能嵌在里面 ——
嵌进去点「同意」会冒泡到外层，**再弹一次相册**。

### ③ 交棒少一步 ⇒ 图选了但没带过去

`setReferenceDraft` 放在 `openComposer` 里、`navigateTo` **之前**。
少这一步的话：图选了、缩略图也显示了、跳转也成功了，
只是下游拿不到参考图，**直接走文生图**，出图看起来完全正常。

---

## 3. 清掉的两条死类（顺带）

删掉「参考图留到下一步」那行提示和「生成 1 张」之后，
`.composer-card-tip` / `.composer-card-meta` 就没有任何 JSX 用户了。

⚠️ 这两条类名原来和 `.home-section-caption` **共用一条规则**：

```scss
.composer-card-meta,
.home-section-caption,
.composer-card-tip { … }
```

只删前两行选择器、**保留块体**（改成单选择器 `.home-section-caption {`）。
直接删整条块会把 `.home-section-caption` 的样式一起带走。

---

## 4. 门禁（10 条源码级 + 5 条产物级）

### 源码级（`scripts/test-creator-ui.mjs`）

| # | 判据 | 拦的是 |
|---|---|---|
| 1 | `home` 含 `composer-ref-add` | 入口整块被删 |
| 2 | `home` 含 `composer-ref-thumb` | 已选态被删（选了看不见） |
| 3 | `home` 含 `setReferenceDraft(reference)` | **静默丢图** |
| 4 | `home` 含 `<PrivacyGate />` | 隐私弹窗永不出现 |
| 5 | `handleRemoveReference` 后 400 字符内有 `stopPropagation` | 「删不掉反而又让我选图」 |
| 6 | `home` **不含** `composer-card-tip` | 废弃提示回来 |
| 7 | `home` **不含** `composer-card-meta` | 「生成 1 张」回来 |
| 8 | `<View className='composer-launch'…><Text>生成</Text>` | 按钮文案被改回去 |
| 9 | `home` **不含** `<Text>开始</Text>` | 同上（负向） |
| 10 | 共享规则 `.composer-ref-add,.composer-ref-thumb` 同时给 `width:42px` 和 `height:42px` | 点击区被缩到点不中 / 两态不等高导致卡片跳一下 |

**第 10 条刻意写在源码级**：产物里 42px 会变成 `80.15267rpx`（designWidth 换算），
锚死 rpx 会在改 Taro 配置时**假红**。源码里的 `42px` 才是写下来的设计意图。

### 产物级（`scripts/verify-dist.mjs`）

| # | 级别 | 判据 | 拦的是 |
|---|---|---|---|
| 1 | must | `.composer-ref-add` / `.composer-ref-thumb` 在 `app.wxss` 里**同尺寸且是方形** | 样式没进产物 ⇒ 塌成裸文字；或两态不等高 ⇒ 卡片跳 |
| 2 | must | `home/index.js` 里 `className:"composer-ref-add"` 与 `…thumb` **都在** | 三元被压成单分支 ⇒ 缩略图永远看不见 |
| 3 | must | `home/index.js` 里**不含**「可在下一步添加参考图」（原形与 `\uXXXX` 形都查） | 王明确要求删掉的文案回来 |
| 4 | should | 产物 CSS 与 JS 里都无 `composer-card-tip` / `composer-card-meta` | 死类卫生（不致命，所以是提醒） |
| 5 | must | 渲染序列里 BottomNav 之前是一个「同模块导出、**不接任何 props**」的组件 | `<PrivacyGate />` 被整行删掉 |

---

## 5. 第 5 条为什么写成「结构代理」

**先说结论：在 `home/index.js` 里 `includes('PrivacyGate')` 永远找不到它。**

实测：

| 字串 | `dist/pages/home/index.js` | `dist/common.js` |
|---|---|---|
| `privacy-mask` | 0 | 1 |
| `privacy` | 0 | 11 |
| `PrivacyGate` | 0 | 0（标识符被压缩器改掉） |

组件模板编译进 **`common.js`**，home bundle 只留一个被压缩的模块引用。
⇒ 直接判 `includes('PrivacyGate')` 是一条**永远红**的假门禁，
下一个人只会把门禁删掉。

改用**渲染序列的形状**。产物尾部实测：

```js
… (0,N.jsx)(u.CU,{}),(0,N.jsx)(u.lv,{active:"create"}) ]})
              ↑ PrivacyGate        ↑ BottomNav（同一个模块 u）
```

判据：

```js
/jsx\)\((\w+)\.\w+,\{\}\),\(0,\w+\.jsx\)\(\1\.\w+,\{active:"create"\}\)/
```

即「紧挨 BottomNav 的前一个元素，是同模块导出、且**不接 props**」。
删掉 `<PrivacyGate />` 这一行，这个形状立刻消失。

⚠️ **这是代理，不是证明**：它拦得住「整行被删」，拦不住「挂到别处去了」。
主判据仍是源码级第 4 条。

---

## 6. 刻意**没有**加的一条（假门禁）

产物级**没有**做「`home/index.js` 里不许出现『开始』」。

原因：首页还有 **3 处合法的「开始」** ——
「从一个想法开始」「按你的任务开始」「一句描述开始」。
裸判 `!includes(escapeUnicode('开始'))` 会**永远红**。

精确的那条在源码级（`assert.doesNotMatch(home, /<Text>开始<\/Text>/)`）。
这个教训写在 `verify-dist.mjs` 的注释里，别让下一个人「顺手补上」。

---

## 7. 对抗测试：10/10（含 3 个控制组）

脚本：`_diag/adversarial-home-ref.py`（Python 驱动子进程，不用 Node 的 `execFileSync`）

| # | 变异 | 期望 | 实测 |
|---|---|---|---|
| 控制组 | 不改动 | `57 通过 · 0 提醒 · 0 阻断` | ✅ |
| M1 | `className:"composer-ref-add"` → `…ADDX` | 56/0/1，命中第 2 条 | ✅ |
| M2 | 追加 `.composer-ref-thumb{width:40rpx}` | 56/0/1，命中第 1 条 | ✅ |
| M3 | 把「可在下一步添加参考图」塞回产物 JS | 56/0/1，命中第 3 条 | ✅ |
| M4 | 追加 `.composer-card-tip{color:red}` | **56/1/0**（should ⇒ 提醒，exit 0） | ✅ |
| M5 | 删掉 `(0,N.jsx)(u.CU,{}),` | 56/0/1，命中第 5 条 | ✅ |
| M6 | 源码 `.composer-ref-*` 的 `width: 42px` → `20px` | `test:creator-ui` 非 0 退出 | ✅ |
| 控制组 3 | 源码还原后跑 `test:creator-ui` | 绿 | ✅ |
| 控制组 2 | 产物还原后复跑 `verify:dist` | `57/0/0` | ✅ |
| — | 还原后 dist **逐字节**一致（SHA-256 比对 3 个文件） | 一致 | ✅ |

⚠️ **第一版第 1 条判据写错了**（写成 `/min-width/`）—— 源码里是
`width: 42px; height: 42px`，压缩后是 `width:80.15267rpx`，**根本没有 `min-*`**。
门禁自己把这条拦下来了（56/0/1），我按真实不变量（两态同尺寸且方形）重写。
**这就是「门禁要先证明自己会拦」的价值：写错的判据会当场红，不会静默放行。**

---

## 8. 逐命令验证（全前台，全部 exit 0）

`npm run release` 整链跑通，耗时里 `taro build` **9.31s**：

| 步骤 | 结果 |
|---|---|
| `typecheck` | exit 0 |
| `check:request-key` | 15 项全部通过 |
| `check:no-pixel` | 通过（3 必拦 / 6 必放行自测） |
| `check:prompt-mirror` | 35 个模板 · 16 个字段一致；14 个自测样本 |
| `check:asset-filters` | 通过（5 个筛选项都筛得出东西） |
| `test:creator-ui` | passed |
| `test:reference-images` | passed |
| `test:reference-recreate` | passed |
| `test:product-studio` | passed |
| `build:weapp` | Compiled successfully in **9.31s** |
| `verify:dist` | **57 项通过 · 0 项提醒 · 0 项阻断** |
| `check:poster-directions` | 通过（16 个方向） |

⚠️ `npm run release` **必须前台跑**。丢后台会卡在 `taro build`
（`dist/app.json` 根本不生成，只有根文件和空的 `pages/*`），
`grep | tail` 管道也会让它卡 —— 重定向到文件。

---

## 9. 包体

| | 字节 | 余量（上限 2 MB） |
|---|---|---|
| 改动前 | 1,830,976 B | 259.9 KB |
| **改动后** | **1,833,255 B** | **257.7 KB** |

净增 **+2,279 B**。本项目**没有分包配置** ⇒ `dist/` 整个就是主包。
超限时 `taro build` **不报错**，要到微信后台上传那刻才失败。

---

## 10. ⚠️ 撤回一条我自己记错的话

做这次改动时，我的工作笔记里挂着一条「要报给王的产品债务」：

> `editImages` 实际上让**最后**一张成为图一，所以用户上传的产品照会被挤出图一

**这句是错的，撤回。** 这次按代码逐段核了顺序链：

```
referenceImages[0]
  → editImages: Promise.all(images.map(uploadAsset))     // 保序
  → fileIds[0]
  → 后端 loadInputImages: fileIds.map(...)                // 保序
  → image.mjs:100  for (const image of inputImages) form.append('image', …)   // 保序
  ⇒ 数组第 0 项就是模型看到的「图一」
```

旁证：`src/services/reference-recreate.ts:151` 的注释写着
「交给 `editImages` 的素材顺序 —— **不可变约定**：`[产品, 参考]`」，
`product-studio.ts:243` 也写「提示词里的『图一』指的就是这个数组的第一项」。

⇒ **没有这条债务。** 首页选的参考图进「自由生图」后落在 index 0（图一），
而自由生图的提示词是用户自己写的自由文本，没有「图一 = 某个固定角色」的契约，
所以不会冲突。

**更正范围**：这条错误**没有落进任何文件**。已核：
`docs/handoffs/*.md` 与 `.workbuddy-ai/memory/2026-09-2*.md` 里
搜「图一 / 最后一张 / 挤出」均为 0 命中（除本节自身的撤回说明）。
所以**只需撤回，不需要改旧文档**。

（教训：「上一份文档里写过」不等于「验证过」；反过来，
「我在脑子里记过」也不等于「写下来了」—— 撤回时先把这两件事分开。）

---

## 11. 这次**没有**验证的

1. **没有真机/模拟器截图。** 没有跑微信开发者工具的截图比对 ——
   「两态在真机上长得对不对、42px 点不点得中」**只有断言，没有眼睛看**。
   （铁律：「看图不能替代断言，断言也不能替代看图」—— 这次只有前一半。）
2. **没有真实上传/出图。** 环境里没有 `LLM_API_KEY`，
   「选完图 → 生成 → 出图」这条端到端链路**一次都没跑过**。
3. **`wx.chooseMedia` 的隐私弹窗没有真机确认。** 结构断言能证明
   `<PrivacyGate />` 挂上了，不能证明微信那边一定弹。
4. **`reference-images.ts` 的草稿是模块级变量**，`takeReferenceDraft` 是一次性读走即清。
   这次沿用它，没有改。**未验证**的是：用户连续两次从首页带图时会不会串
   （第一次已被下游读走，理论上是干净的，但没有真机跑过两次）。
5. 设计真源 `work/visual-studio` **没有对应的快速创作卡片**（那边首页是 `hero-block`），
   所以**不需要镜像改动** —— 这是「确认过不需要」，不是「忘了改」。
