# P1-1 · 灵感复刻改成三层卡结构（先只做这一页）

日期：2026-09-27
范围：`src/pages/create-reference/index.tsx` + `src/styles/forme.scss` 的 4 条新规则
前一份：`2026-09-27-p1-asset-skeleton.md`（P1-2）
**未提交**：工作区里这次改动**没有 commit**（仓库只有一次 baseline `3d98804`）。

---

## 1. 先说结论

王定的三件事（本轮 `AskUserQuestion` 的回答）全部按选择实现：

| 问题 | 王的选择 | 结果 |
| --- | --- | --- |
| 两个上传槽怎么排 | **并排** | `.upload-grid`（`1fr 1fr`），每个 173×123 |
| 「保留什么？」放哪层 | **留在第一张卡** | 卡内区块，保留 17px 标题 + 44px 胶囊的强样式 |
| 页头要不要缩略图 | **加，并精简文案** | 96×96 封面缩略图（复用首页那张，**0 额外字节**）+ 去掉两行说明 |

**实测收益**（模拟器 390×844，rpx = 1.0px）：

| | 改前 | 改后 | Δ |
| --- | --- | --- | --- |
| 页头 | 117 → 279.6（**162.6px**） | 117 → 250（**133px**） | −29.6 |
| 上传槽 | 150px × 2，**上下排** | 123px × 2，**并排** | −177 |
| `recreate-rights` 顶边 | **1412.8** | **1034.5** | −378.3 |
| 内容总高（页顶 → 权利块底） | **1432.7px** | **1054.3px** | **−378.4（−26.4%）** |
| 屏数（÷844） | 约 **1.9 屏** | 约 **1.25 屏** | — |

**首屏从「只有两个空上传框」变成「两张图 + 复刻重点」全都在**：

| 区块 | 改后 top → bottom | 首屏（生成条顶边 719）可见？ |
| --- | --- | --- |
| `composer-page-head` | 117 → 250 | ✅ 全部 |
| `upload-grid`（两个槽） | 310 → 433 | ✅ 全部（改前第二个槽下沿 801，被盖住一截） |
| 合并说明 + `composer-choice`（保留什么？） | 490 → 612.5 | ✅ 全部 |
| `composer-section-title`（补充说明） | ~634 → ~652 | ✅ |
| `PromptField` | ~652 → ~800 | ⚠️ 下沿被生成条盖住 ~80px（可滚动） |

改前「保留什么？」在 **815.4**，**整块在生成条后面**；法务勾选在 **1412.8**，要滚 1.7 屏。

对比图：`_diag/shots/p1-1-before-after.png`（改前首屏 / 改后首屏 / 改后下半屏）。

---

## 2. 改了什么

### 2.1 页头：纯文字 → 96×96 缩略图 + 标题

```tsx
import coverInspirationRecreate from '@/assets/cover-inspiration-recreate.jpg'
...
<View className='composer-page-head is-thumbed'>
  <View className='composer-page-thumb'>
    <Image className='composer-page-thumb-img' src={coverInspirationRecreate} mode='aspectFill' />
  </View>
  <View className='composer-page-heading'>
    <Text className='composer-overline'>REFERENCE RECREATE</Text>
    <Text className='composer-page-title'>把喜欢的画面，变成你的产品视觉</Text>
  </View>
</View>
```

**为什么这张图是免费的**：`cover-inspiration-recreate.jpg`（640×960 = 2:3）**已经被
`pages/home/index.tsx` 的 `REFERENCE_CARD` import**，本来就在包里。主包余量只有
351.4 KB，随便加一张图都是真实成本 —— 这张**不增加任何字节**。

**为什么去掉那两行说明**：原文是「选一张你有权使用的画面，再上传你的产品。只借鉴你
勾选的那一项，其余重新组织。」—— **下半句和「保留什么？」的说明一字不差**，上半句由
两个槽的 label + hint 说清了。缩略图那一支文字列只有 246px 宽，留着它页头会**反而
高 24px**（说明从 2 行变 3 行）。

### 2.2 正文：3 个平铺块 + 2 张选择卡 → `input-card` + `settings-card`

```
composer-scroll
  input-card composer-surface        ← 创作输入
    composer-section-title  素材 / 两张图都必需 / 0/2
    upload-grid             产品图片 ▣  |  视觉参考 ◫      ← 并排
    composer-block-note     合并后的一段说明
    composer-choice         保留什么？ + 44px 胶囊（✓ 构图）
    composer-section-title  补充说明 / 可选
    PromptField
  settings-card                      ← 可调项
    settings-header composer-toolbar  输出设置 / 2:3
    composer-settings-panel           画面比例 + settings-note
  recreate-rights                    ← 法务声明，**不在任何卡里**
GenerateDock
```

`recreate-rights` 刻意留在两张卡之外 —— 它是**法务声明**，塞进卡片会被读成可选项。
这条已加门禁（见 §3）。

### 2.3 新增的 4 条 CSS（`forme.scss`，CRLF 按行数组插）

```scss
.input-card .composer-choice { margin-top: 20px; padding: 0; border: 0; background: transparent; }
.input-card .upload-grid { margin-top: 0; }
.input-card.composer-surface .reference-note.prompt-field { padding: 0; }
.settings-note { display: block; margin-top: 10px; color: var(--muted); font-size: 11px; line-height: 1.5; }
```

外加两条间距规则（第二轮补的）：

```scss
.input-card .composer-section-title { margin-top: 22px; }
.input-card .composer-section-title:first-child { margin-top: 0; }
```

以及一处全局微调：`.upload-slot .slot-hint { max-width: 82% → 92% }`。

- `.input-card .composer-choice` 去掉「卡中卡」的边框底色，**但不动**
  `.composer-choice .option-pills .pill`（后代选择器，44px 强样式原样生效）。
- `.reference-note.prompt-field` 抵消 `.composer-surface .prompt-field` 的 14px 内缩 ——
  不然补充说明的左边线比上面的上传槽多缩进 14px，对不齐。
- `.upload-grid` 原来**只在 SCSS 里定义、没有任何页面用它**（死类），现在两个槽用它。

---

## 3. 门禁（+11 源码级、+4 产物级）

### 源码级 `scripts/test-creator-ui.mjs`（新增一节，含例外表自检）

| 判据 | 拦什么 |
| --- | --- |
| 灵感复刻与自由生图同构（`SHELL_CLASSES` − 例外 + `REFERENCE_REQUIRED_CLASSES`） | 退回旧平铺结构 |
| 旧平铺结构的类一个都不许留（`composer-block` / `form-heading` / `section-heading`） | 旧标题系统回来 |
| 例外表 ① 不许有 `SHELL_CLASSES` 里不存在的名字 | 拼错的例外 = 静默无效 |
| 例外表 ② 例外项必须**真的不在页面上** | 例外变成多余/页面没改 |
| **权利确认必须在两张卡之外**（`<View>` 开闭配对） | 塞进卡里 / 挪出 `composer-scroll` |
| 合并说明两句话的事实都在 | 合并时顺手删事实 |
| 「素材 n/2」只看两张图、不许从 `blocker` 反推 | 勾完权利计数凭空跳 2/2 |
| 页头缩略图必须 import 并真的用那张封面（且首页也 import 同一张） | 换图 → 真的加字节 |
| 4 个新选择器在 SCSS 里都有定义 + 关键声明 | TSX 用了但没样式（静默失败） |
| 页面里不许再出现 `composer-blocker` | 同一句话同屏印两遍 |
| 卡片内分区标题：非首个有上边距、首个清零 | 「补充说明」贴着上面的胶囊 |

### 产物级 `scripts/verify-dist.mjs`（66 → **70 项**）

1. 页头缩略图进了产物（类名 + 指向封面模块）
2. 旧平铺块结构已从产物消失
3. 三层结构在产物里都在（`input-card` / `settings-card` / `upload-grid` / `settings-note` / `recreate-rights`）
4. 法务声明与勾选控件都在产物里（类名 + `app.wxss` 样式）

---

## 4. 🔴 顺手修好了一条「因为我的改动而变成假红」的旧门禁

改完之后 `verify:dist` 报：

```
❌ 首页真的引用了轮播封面
   dist/pages/home/index.js 里没有 assets/cover-inspiration-recreate.jpg 的引用
```

**这不是我的改动坏了首页，而是这条判据的前提被我的改动推翻了。**

- 图片落在哪个 chunk，取决于**有几个页面 import 它**。原来只有首页 import ⇒ 模块在
  `pages/home/index.js` 里，路径字符串也在那儿 ⇒ `homeCode.includes('assets/…')` 成立。
- 灵感复刻的页头也用同一张图之后，模块被提到**共享 chunk**（`dist/common.js`），
  首页分块里只剩 `m=a(2888)` 这个**模块 id 引用**，路径字符串整个消失。

**修法（比原来更强）**：新增 `assetModuleId(file)` —— 在全部 `dist/**.js` 里找
`<id>:function(e,n,t){e.exports=t.p+"assets/<file>"}`，取出模块 id，然后要求
`dist/pages/home/index.js` 里有 `a(<id>)` 这个 require。

- ❌ 没有退化成「扫全部 dist 的 .js」（同文件 `anyJsMentions` 的既有做法）：那样只要
  **别的页面**用了这张图它就绿，首页封面被删也不红 —— **永远为真的假门禁**。
- ✅ 模块 id 路线既不受分块影响，又只有「首页真的 require 了它」才绿。
- 边界写在门禁注释里：「REFERENCE_CARD 的 cover 指向它」由源码级门禁守，两条合起来才完整。

### 另一条：产物级判据的**子串陷阱**（我第一版就踩了）

第一版写的是 `referencePage.includes('composer-block')` —— 结果**假红**，因为这一页
同时存在 `composer-block-note` 与 `composer-blocker`，**两者都包含** `composer-block`。

修法：新增 `hasClassLiteral(text, cls)`，要求类名前后落在引号 / 空白 / 反引号上。
对抗测试里的 **C0b 控制组**直接证明了这件事：

```
C0b 门禁自检（裸子串 vs 锚定字面量）: {"naive":true,"anchored":false}
   ⇒ ✅ 裸子串确实会假红，锚定判据把它挡掉了
```

---

## 5. 我自己写了一条**恒真**的门禁，被对抗测试抓出来

例外表最初的自检是：

```js
assert.deepStrictEqual(
  SHELL_CLASSES.filter((c) => !REFERENCE_SHELL_CLASSES.includes(c)),
  REFERENCE_SHELL_EXCEPTIONS
)
```

拿「从例外表算出来的结果」去比「例外表自己」—— **恒真**。
对抗测试 **M6**（把 `'settings-card'` 加进例外表）实测：**门禁照样绿**。

改成逐项核对页面：

```js
const staleExceptions = REFERENCE_SHELL_EXCEPTIONS.filter((c) => classes.includes(c))
assert.deepStrictEqual(staleExceptions, [], '例外表里的 X 其实在页面上是有的')
```

M6 现在会红。**「留一条永远为真的断言比没有更坏」** —— 这条正好是那个形状。

### 还有一个：`cssBlock` 只取第一条规则

新加的间距门禁用 `cssBlock('.input-card .composer-section-title')` 读 `margin-top`，
读到 `null` 而报「没有上边距」—— 其实有。因为**这个选择器有两条规则**：
「间距收口」那条（`margin-bottom: 12px`）在前，新增的 `margin-top` 在后。

产物侧早就为同一个坑写过 `declsFor`（遍历所有匹配规则）。源码侧补了 `cssAll()`。
**同一个坑在两个载体上各踩一次** —— 值得记。

---

## 6. 对抗测试 `_diag/adversarial-reference-a-structure.py` **17/17**

```
C0  源码级控制组（不改）              ✅ 绿
C0  产物级控制组（不改）              ✅ 绿
C0b 裸子串假红控制组                  ✅ naive=true / anchored=false
M1  权利确认塞进 settings-card        ✅ 拦下
M2  权利确认挪出 composer-scroll      ✅ 拦下
M3a 计数丢掉两张素材                  ✅ 拦下
M3b 计数把权利确认也算进去            ✅ 拦下
M4  合并说明里删掉一句事实            ✅ 拦下
M5  页头说明文案加回来（例外失效）    ✅ 拦下
M6  例外表多剔一个类（自检失效）      ✅ 拦下
M7  缩略图不用那张封面                ✅ 拦下
M8  去掉「保留什么？」的卡内去边框    ✅ 拦下
M9  上传槽退回平铺块（旧结构）        ✅ 拦下
M10 字段级提示加回来（同屏两遍）      ✅ 拦下
M11 去掉卡片内分区标题的上边距        ✅ 拦下
D1  上传槽退回平铺块（产物级，需 build）✅ 拦下
D2  首页改 import 另一张图（模块 id）  ✅ 拦下
```

脚本自身守铁律 #17：`restore()` 方向正确（`copy2(BAK, p)`）、`try/finally`、
兜底清掉任何残留 `.advbak`（**并排除了 `dist/`** —— 落在那里会混进包体）。
跑完核过：无 `.advbak` 残留，四个被变异的文件都回到预期内容。

---

## 7. 「看图」那一半

| 图 | 内容 |
| --- | --- |
| `_diag/shots/p1-1-before-after.png` | 改前首屏 / 改后首屏 / 改后下半屏 三张并排 |
| `_diag/shots/ref-before-2.png` | 改前首屏（旧结构） |
| `_diag/shots/ref-before-s420.png` / `-s900.png` | 改前下半屏（「保留什么？」「画面比例」「补充说明」「权利确认」） |
| `_diag/shots/p1-1-top.png` / `-bottom.png` | 改后首屏 / 下半屏 |
| `_diag/shots/ref-final-thumb-zoom.png` | 页头缩略图放大（2:3 图塞进 96×96 方框，`aspectFill` 裁掉上下） |
| `_diag/shots/ref-v5-slots-zoom.png` | 两个上传槽放大（两行 hint 都收成一行） |

### 看图才发现的三个问题（断言全都不会报）

1. **「添加产品图片后继续」同屏出现两遍**（卡片里 + 生成条 hint 上方）。
   `GenerateDock.hint` 用的是**同一个** `RECREATE_BLOCKER_HINT`，而生成条是
   `position: fixed` ⇒ 永远在视野里。**已删掉卡片里那一条**（M10 守着）。
2. **「补充说明」贴着「保留什么？」的胶囊**（只差 13px）。`.composer-section-title`
   只有 `margin-bottom`、没有上边距。**已补**（M11 守着）。
3. **hint 折行出寡行**：并排后每个槽只有 173px 宽，「正面、清晰、背景干净的产品照」
   要 154px 而 `.slot-hint` 只给到 82% = 142px ⇒ 断成「…干净的产」/「品照」。
   提到 92% 后左槽一行放下；右槽 17 字仍要 187px ⇒ 断成「…只借它的一/部分」，
   **于是把右槽的 hint 从 17 字缩到 12 字**（见 §8）。

---

## 8. 两处**改了文案**的地方（请王确认）

1. **合并了两段槽说明**（并排后塞不进半宽）：
   - 原：「这张图是画面里唯一的产品主体，包装比例与上面的文字会被保留。」
   - 原：「参考图里的人物、Logo、文字与商标都不会进入结果。」
   - 现：「产品图是画面里唯一的产品主体，包装比例与上面的文字会被保留；参考图里的人物、Logo、文字与商标都不会进入结果。」
   - **两句话的事实一字未减**，顺序仍对应左 = 产品、右 = 参考。门禁逐句守这两条承诺。
2. **右槽 hint 17 字 → 12 字**：「一张你喜欢的画面，只借它的一部分」→「你喜欢的画面，只借一部分」。
   原因见 §7 第 3 条（寡行）。**只改本页** —— 产品工作室没有参考槽，不受影响。
3. **页头两行说明删掉**（王已确认「精简文案」）。
4. **删掉卡片里的 `composer-blocker`**（§7 第 1 条，消除同屏重复）。

以上 4 条都可一条命令回退；如果要保留某条，请说哪条。

---

## 9. 未验证 / 需真机

- **没有真机**：所有数字来自微信开发者工具模拟器（390×844）。真机安全区、
  键盘弹起后 `GenerateDock` 与 `PromptField` 的关系**没有验证**。
- **缩略图的裁切只看过一眼**：`aspectFill` 把 2:3 裁成 1:1，`ref-final-thumb-zoom.png`
  里构图还认得出，但**没有**像首页封面那样做过「包围盒是否被切掉」的像素级核对。
  首页封面那条有专门的 `_tools/measure-ref-photo.py` 证据，这一处**没有**。
- **没有真机点击**：两个上传槽并排后命中区是 173×123，比原来 356×150 小；
  `wx.chooseMedia` 的触发、`slot-remove`（「移除产品图」/「换掉参考图」）在半宽槽里
  会不会挤到预览图上，**只看了静态截图**。
- **`0/2` 计数器的运行时行为没测**：选一张图后应显示 `1/2`。断言只锁了它的**推导**
  （只看 `draft.product` / `draft.reference`），没锁渲染结果。
- **P1-1 只做了这一页**：`create-marketplace` / `create-product-shot`（共用
  `components/ProductStudioComposer.tsx`）**还是旧的平铺块结构**，等王看完这一页再定。

---

## 10. 文件清单

| 文件 | 改动 |
| --- | --- |
| `src/pages/create-reference/index.tsx` | 重写布局（**261 → 336 行 / 10,229 → 15,449 B**，基线 `git show HEAD:./src/pages/create-reference/index.tsx` 实测）；新增缩略图 import、`settingsExpanded`；删 `SectionHeading` import |
| `src/styles/forme.scss` | +4 条规则（三层卡结构）、+2 条间距规则、`.slot-hint` max-width 82%→92%（CRLF 保持） |
| `scripts/test-creator-ui.mjs` | +11 条源码级判据；新增 `cssAll()` 助手（`cssBlock` 只取第一条规则） |
| `scripts/verify-dist.mjs` | +4 条产物级判据（66 → 70）；新增 `allJsFiles()` / `assetModuleId()` / `hasClassLiteral()`；重写「首页真的引用了轮播封面」；`anyJsMentions` 改用 `allJsFiles()` |
| `_diag/apply-reference-a-structure.py` | 插 4 条 CSS（5 项自检） |
| `_diag/apply-reference-a-structure-2.py` | 插 2 条间距规则（5 项自检） |
| `_diag/adversarial-reference-a-structure.py` | 对抗测试 17 项（含 2 个需 build 的产物级变异） |
| `_diag/shots/p1-1-*.png`、`ref-*.png` | 截图 |

发布链：`npm run release` → **EXIT=0**，`verify:dist` **70 项通过 · 0 项提醒 · 0 项阻断**。
包体：**74 文件 · 1,737,314 B · 82.84% · 余量 351.4 KB**（改前 1,736,674 B，+640 B）。

---

## 11. 下一步

1. **请王看 `_diag/shots/p1-1-before-after.png`** —— 这一页是否照这个方向推广到
   `create-marketplace` / `create-product-shot`（它们共用 `ProductStudioComposer.tsx`）。
2. 确认 §8 的 4 处文案改动。
3. 若通过：P1-3 第 2/3 步（14 处旧调色板硬编码 → 令牌）、P1-4（按钮触感统一）、
   P1-5（轮播视觉差异化，需先出设计）。

---

## 12. 复看截图时**顺手发现的一个既有缺陷**（不是 P1-1 引入的，未修，等王定）

### 12.1 现象

生成条的提示 / 报错文字（`.generate-hint` / `.generate-error`）**与它下面的页面内容叠印**，
两层文字同时可见、互相干扰，**都读不清**。

`_diag/shots/_zoom-hint-overlap.png`（4 倍放大）：
「**添加产品图片后继续**」和「补充说明」输入框的占位文字
「**例如：换成清晨的窗边光线，整体更安静一些**」叠在同一行上。

### 12.2 实测几何（模拟器，逻辑视口 390×844，scroll-top = 0）

| 元素 | top | height | 区间 |
|---|---|---|---|
| `.generate-dock` | **719** | 125 | 719 – 844 |
| `.generate-hint` | **701.5** | **18.5** | 701.5 – 720 |
| `.reference-note`（PromptField） | **681.5** | 150 | 681.5 – 831.5 |

⇒ 提示文字**整条**（18.5px 高 × 360px 宽）落在输入框区间内 —— 重叠 **18.5px**。

### 12.3 成因（源码级，两处同因）

```scss
.generate-hint  { position: absolute; right: 16px; bottom: 100%; left: 16px; padding-bottom: 6px; … }
.generate-error { position: absolute; right: 16px; bottom: 100%; left: 16px; padding-bottom: 6px; … }
```

`bottom: 100%` 让它**浮在生成条盒子的上沿之外**（这是有意的：不占用生成条的高度），
但它**自己没有任何背景** ⇒ 下面滚过来的内容**直接透上来**。
生成条本体有 `background: var(--dock-bg)`（`rgba(5,5,5,0.94)`）**盖得住**内容，
**只有提示这一条 18.5px 的带子盖不住**。

### 12.4 这不是 P1-1 引入的（已核）

`_diag/shots/_zoom-before-bottom.png`（改前那屏的同一位置）：
同样叠印，只是当时叠的是「视觉参考」槽的 hint
（「一张你喜欢的画面，只借它的一部分」）。**改前改后同样严重，只是叠的对象换了。**

### 12.5 影响范围（按源码判定，非逐页截图）

| 页面 | hint（未就绪提示） | error（生成失败） |
|---|---|---|
| `create-reference` 灵感复刻 | ✅ **首屏就有**（`blocker='product'`） | ✅ |
| `create-marketplace` 电商主图 | ✅ **首屏就有**（`ProductStudioComposer` 的 blocker） | ✅ |
| `create-product-shot` 产品拍摄 | ✅ **首屏就有**（同上） | ✅ |
| `create-avatar` / `create-poster` / `create-product` | ❌ 不传 `hint` | ✅ |
| `create-freeform` 自由生图 | ❌ 不传 `hint`（实测该页 `.generate-hint` **不存在**） | ✅ |

⇒ **3 个页面每次首屏都会看到**；**全部 7 个页面在生成失败时**都会看到
（而「为什么不能点 / 为什么失败」恰恰是最需要读清的一句话）。

⚠️ **未验证**：`.generate-error` 这条路径**没有真的渲染过**（没有 `LLM_API_KEY`，
触发不了生成失败）。上表 error 列是**按 CSS 相同声明 + `error={error}` 逐页存在**推出来的，
**不是看到的**。

### 12.6 有没有门禁守着它？—— **没有**

```
grep -rn "generate-hint" scripts/   ⇒ 0 命中
grep -rn "bottom: 100%" scripts/    ⇒ 0 命中
```

⇒ 不是「刻意决策 + 有门禁保护」，是**没人守的缺陷**（按铁律「报缺陷前先 grep」核过了）。

### 12.7 三种修法（**观感与布局影响不同 ⇒ 请王定，我没有自己选**）

| 方案 | 做法 | 代价 |
|---|---|---|
| **A. 给提示加不透明底** | `.generate-hint` / `.generate-error` 加 `background: var(--dock-bg)` | 最小改动、**不动任何布局**；生成条上方多一条**硬边**色带 |
| **B. 把提示收进生成条内部** | 加高 `--dock-h`，提示变成生成条里的一行 | 视觉最干净（苹果风：状态文案在栏内）；**7 页首屏预算各少 ~25px**，本文 §2.3 量到的数字要全部重测 |
| **C. 生成条上方加渐变遮罩** | 加一条 `linear-gradient(to top, var(--dock-bg), transparent)` 的 scrim | 内容自然淡出、观感好；**引入新视觉元素**，且遮罩会盖住它上方的内容 |

**我的建议是 B**（状态文案本来就属于这条栏，而不是浮在栏外），但它会改动全部 7 页的
首屏高度 ⇒ 按「不要猜，先问我」，**等王定**。

