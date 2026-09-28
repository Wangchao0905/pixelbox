# FORMÉ: 删掉首页「新功能」三个模板，只把「灵感复刻」放到轮播最上方

日期：2026-09-25
载体：`forme-taro`（小程序）。**没动** `forme-server`，也**没动** `work/visual-studio`
（浏览器设计真源里从来没有这条轨道 —— 已 grep 确认，不是漏改）。

---

## 目标

王的原话：

> 删除页面下方的新功能三个模板，只把灵感复刻放在首页最上方里

两个追问的答案（AskUserQuestion）：

| 问题 | 王的答案 |
| --- | --- |
| 「首页最上方」指哪里 | **顶部轮播的第一张** |
| 灵感复刻的轮播封面用哪张 | **左对齐裁一张 2:3 新封面** |
| 删掉后产品拍摄/电商主图只剩两跳入口，确认？ | **确认，就这样** |

第三条同时**反转了 2026-09-23 的一条规矩**。那条原文是
「所有新加入的功能都应该放在首页的集中展示里，不是单独成为一个模块」——
现在作废。两处墓碑注释（`home/index.tsx` 与 `forme.scss`）都写明了这件事，
免得后来人照着旧规矩把这块加回来。

---

## 🔴 最重要的一件事：删一块 UI，连带要删 ~300 行门禁

这次真正花时间的不是删 JSX（那是 30 秒的事），而是**找出门禁在守什么**。

「新功能」那块有三条门禁在守它，删掉 UI 之后它们**必然全红**：

| 门禁 | 位置 | 守什么 |
| --- | --- | --- |
| 三张展示图 | `scripts/verify-dist.mjs`（164 行） | 图真的进包、三张同尺寸、卡片纵横比 = 图纵横比 |
| 下沿遮罩够黑 | `scripts/verify-dist.mjs`（128 行） | `.home-feature-veil` 在文字上沿处 ≥ 0.50 黑 |
| 共用一条轨道 | `scripts/test-creator-ui.mjs`（~48 行） | 三个功能不许各开一块模块、入口从意图表读 |

处理原则：**能反过来守的就反过来守，守不了的才删**。

- 「三张展示图」→ **改造成「首页轮播封面」**（单张 + 比例门禁）。
  这是**同一类静默失败**（aspectFill 裁切），值得留，见下一节。
- 「下沿遮罩够黑」→ **删了，但把结论写进墓碑注释**。
  它是像素级判据，`verify-dist.mjs` 是零依赖 node 脚本、解不了 JPEG 像素，
  所以它本来就只能靠 `_diag/*.py` 复算。墓碑里留了实测数字（见「发现但没修」）。
- 「共用一条轨道」→ **整体反成负向断言**：
  首页不许再有 `.home-features` / `.home-feature-*` / `productStudioIntentMeta(`，
  且必须 import 新封面。

另外把两个**对抗测试脚本**归档了（`_diag/retired-2026-09-25/`，含说明）：
`_tools/adversarial-feature-card.mjs` 与 `adversarial-feature-rail.mjs`。
被守的对象不存在了 ⇒ 它们必然报错，而且报错信息会误导人去「重新 build」。

---

## 封面为什么必须重做（有数据，不是感觉）

轮播卡 `.hd-card` 是 **236×354（2:3）**，而原来那张展示图是 **530×662（4:5）**。
`<Image>` 用 `aspectFill` ⇒ **比例不一致时不报错，只是裁掉**。

算出来：`min(0.6667 / 0.8006, 1) = 0.833` ⇒ **左右各裁 8.36%**。

而「参考照片」（左上那张被阳光照亮的倾斜矩形）的包围盒是
**x 0.5%..55.1% / y 10.9%..71.3%**（`_tools/measure-ref-photo.py` 实测）——
它**从 0.5% 就开始了**，所以左边缘会被切掉 **42px = 照片宽度的 14.5%**。
那个矩形边界是「借一张参考图重做」这个概念**唯一的视觉锚点**。

已出图确认（`_diag/crop-inspiration-card-size.png`，按 236×354 真实尺寸、三种裁法对比）：
① 整图 aspectFill 与 ③ 纯 2:3 居中裁里，照片的左边界都出框；
② 左对齐裁里边界完整。

**采用 ②**：从源 PNG（1122×1402）左对齐裁 `box=(0,0,935,1402)`
⇒ 保留横向 0.0%..83.3%，照片左右边界各留 6px / 317px 余量，右侧裁掉的 16.7% 不含主体。

生成脚本 `_tools/make-cover-inspiration.py` **自带两条断言**：
① 包围盒必须完整落在裁切窗口内；② 产物比例必须等于 `.hd-card` 的比例（容差 0.2%）。
⇒ 以后换源图或改锚点，它会先失败，而不是悄悄把锚点裁掉。

产物：`forme-taro/src/assets/cover-inspiration-recreate.jpg`，**640×960，118,450 B**。

---

## 改动清单

### `src/pages/home/index.tsx`

- 删 3 个 `feature-*.jpg` import、删 `productStudioIntentMeta` import
- 加 `cover-inspiration-recreate.jpg` import
- 新增 `REFERENCE_CARD`（灵感复刻，`url: '/pages/create-reference/index'`，**不带 query**）
- `PINNED_CARD_ID` → 改名 `POSTER_PIN_ID`；新增 `LEAD_CARDS = [REFERENCE_CARD, ...food-type]`
- `CARDS` 以 `...LEAD_CARDS` 开头，后面按 **id 去重**（不按位置 —— 改 pin id 时不会漏一张重复卡）
- 删 `FEATURES` / `productShotMeta` / `marketplaceMeta` 及其注释，留墓碑注释
- 删整块 `.home-features` JSX（含那段「不给 Image 加 lazyLoad」的注释）

### `src/styles/forme.scss`

- 删 94 行（`.home-features` → `.home-feature-arrow`）+ 1 行（`.home-dark .home-features`），
  换 7 行墓碑注释
- **只摘掉**共享选择器组里的 `.home-feature-kicker` 那一行
  （`.workflow-label, .workflow-hint, .inspiration-tag, .composer-section-note` 都还在用，
  整组删会连带删掉它们）

### 门禁

- `scripts/verify-dist.mjs`：删 292 行（两段），加「首页轮播封面」5 条 + 1 条 `should`
- `scripts/test-creator-ui.mjs`：把「守轨道」那组换成「守删除 + 守首张」那组
- `scripts/check-poster-directions.mjs`：见下

### 顺手修掉的一条「永远为真」的断言

`check-poster-directions.mjs` 里 2026-09-25 早先加过一条
「首页产物里有置顶卡 id（food-type）」。**它是永远为真的**：
`home/index.tsx` 从 `posterDirections` 生成卡片，而 `food-type` 本来就是 16 个方向之一
⇒ 这个字面量**无论如何**都在首页 bundle 里，跟有没有置顶毫无关系。
原注释里那句「它只会因为 `PINNED_CARD_ID` 而出现」是错的。

⇒ 删掉，换成一条**真的会红**的：
「首页置顶的 id 是一个真实的海报方向」（读源码里的 `POSTER_PIN_ID`，比对 `POSTER_IDS`）。
它守的是一个真实的静默失败：**id 拼错一个字母 ⇒ `LEAD_CARDS` 的 filter 匹配不到任何卡
⇒ 轮播静默少一张（22 → 21），首页看起来完全正常。**

---

## 验证（实测，非推断）

| 项 | 结果 |
| --- | --- |
| `npm run release` | **退出 0**（含 typecheck / check:request-key / check:no-pixel / check:prompt-mirror / check:asset-filters / test:creator-ui / test:reference-images / test:reference-recreate / test:product-studio / build:weapp / verify:dist / check:poster-directions） |
| `verify:dist` | **47 项通过 · 0 项提醒 · 0 项阻断**（改造前 54 项；净 −12 旧 +5 新） |
| `check:poster-directions` | 通过（含新增那条） |
| `_diag/class-coverage.py` | `OK：所有页面用到的 class 都能在 forme.scss 里找到定义` |
| 主包体积 | **1,729,038 B = 1.649 MB，余量 359.5 KB**（改造前 1,802,678 B / 287.6 KB ⇒ **缩小 71.9 KB**） |
| 封面进包 | `dist/assets/cover-inspiration-recreate.jpg` 118,450 B，首页 bundle 有 1 处引用 |
| 三张旧图 | `dist/assets/` 里**没有** `feature-*`（不再被 import ⇒ 不进包） |
| 产物 CSS 的卡片比例 | `.hd-card{width:450.38168rpx;height:675.57252rpx}` ⇒ ar=0.66667 = 2:3 |

### 门禁「真的会拦」——手工破坏验证（本机跑不了 `_tools` 的对抗脚本）

`_tools/` 那批对抗测试**在本环境跑不起来**：本环境禁止 node spawn 子进程
（`execFileSync` 返回 `EBUSY`，`status === null`）。所以改成**手工破坏产物**验证：

| 用例 | 改坏什么 | 结果 |
| --- | --- | --- |
| 对照 | 不改 | `47 通过 · 0 提醒 · 0 阻断`，退出 0 |
| 1 | 把封面换成 640×800（4:5） | ❌ `轮播封面纵横比 = 轮播卡纵横比`，退出 **1** |
| 2 | 把首页 bundle 里那 1 处封面引用改名（图仍在包里） | ❌ `首页真的引用了轮播封面`，退出 **1** |
| 3 | 往产物 CSS 末尾加一条 `.home-features` | ⚠️ `首页「新功能」块保持删除`，**1 项提醒、0 阻断**，退出 0（按设计不阻断） |
| 4 | 把 `POSTER_PIN_ID` 改成 `food-typ` | ❌ `首页置顶的 id 是一个真实的海报方向`，退出 **1** |

每个用例之后都还原，并核对 **sha256 逐字节一致**（`_diag/corrupt-backup/`）。

---

## 发现但**没修**的问题：轮播卡的白字名字，4/7 张封面读不出来

删掉「下沿遮罩」那条门禁时顺手复算了一下，发现**同一个问题在轮播卡上是活的**。

`.hd-card-veil` 是**两点渐变**（`rgba(0,0,0,0.62)` → 0，高 96px），
`.hd-card-name` 是白字 15px / bottom 12px ⇒ 文字块上沿距底 30px，t = 30/96
⇒ 该处 alpha ≈ **0.424**，低于当年定的 0.50 判据。

`_diag/contrast-carousel-cards.py` 实测（按真实 CSS 逐像素复算）：

| 封面 | 最低对比度 | 低于 AA 4.5:1 的面积 |
| --- | --- | --- |
| `cover-inspiration-recreate`（新） | 2.35:1 | 4.6% |
| `poster-food-type` | 3.58:1 | 1.1% |
| `poster-shallow-dof` | 4.27:1 | 0.2% |
| `poster-anomaly-subject` | 2.83:1 | **35.0%** 🔴 |
| `poster-paper-field` | 2.54:1 | **71.8%** 🔴 |
| `poster-phone-candid` | 2.45:1 | **80.0%** 🔴 |
| `poster-overhead-flatlay` | 2.37:1 | **80.9%** 🔴 |

⇒ 「俯拍平铺」「纸域微景」「手机直出」「异变主体」这四张卡滑到轮播中间时，
白字名字基本读不出来。

**这是既有问题**，不是本次改动引入的（新封面反而是较好的一档）。
**没修**，因为修它要动共享的 `.hd-card-veil`，会改到全部 22 张卡的外观 ⇒ 属设计决定。
结论写进了 `verify-dist.mjs` 的墓碑注释，等王拍板。

---

## 本次新增 / 改动的文件（全路径）

⚠️ 仓库里有**两个 `_diag/`**，别混：`wo/_diag/` 放**相对仓库根**的诊断脚本
（老的 `class-coverage.py` / `contrast-feature-cards.py` 都在那儿），
`forme-taro/_diag/` 放**相对 forme-taro/** 的东西（dist 快照、构建产物工具）。

| 文件 | 动作 |
| --- | --- |
| `forme-taro/src/pages/home/index.tsx` | 改（删块 + 首卡 + 墓碑注释） |
| `forme-taro/src/styles/forme.scss` | 改（删 95 行 + 摘 1 行 + 墓碑） |
| `forme-taro/src/assets/cover-inspiration-recreate.jpg` | **新增** 640×960 / 118,450 B |
| `forme-taro/scripts/verify-dist.mjs` | 改（删 292 行，加「首页轮播封面」5 条 + 1 条 `should`） |
| `forme-taro/scripts/test-creator-ui.mjs` | 改（守轨道的断言 → 守删除 + 守首张） |
| `forme-taro/scripts/check-poster-directions.mjs` | 改（删 1 条永远为真的，加 1 条真的会红的） |
| `wo/_tools/make-cover-inspiration.py` | **新增**（封面生成 + 2 条断言） |
| `wo/_diag/contrast-carousel-cards.py` | **新增**（轮播卡白字对比度复算） |
| `wo/_diag/cover-inspiration-preview.py` | **新增**（按卡片真实尺寸出图） |
| `wo/_diag/crop-inspiration-2x3.py`、`crop-inspiration-card-size.py` | **新增**（裁切证据图） |
| `forme-taro/_diag/corrupt-dist.py` | **新增**（手工破坏/还原，替代跑不了的对抗脚本） |
| `forme-taro/_diag/count-home-cards.py` | **新增**（数轮播卡数量） |
| `wo/_diag/retired-2026-09-25/` | **新增**（归档 2 个失效的对抗脚本 + 说明） |
| `forme-taro/src/assets/feature-*.jpg`（3 张） | **保留但不再 import**（不进包；是那三套 4:5 构图唯一的存档） |

**未动**：`forme-server/`（后端无关）、`work/visual-studio/`（浏览器设计真源里从来没有这条轨道，
已 grep 确认不是漏改）、`src/data/prompt-templates.ts`（本次不涉及模板数据）。

---

## 未验证
- **运行时轮播的第一张确实是「灵感复刻」**。只能断言到**源码结构**
  （`LEAD_CARDS` 首项是 `REFERENCE_CARD`、`CARDS` 以 `...LEAD_CARDS` 开头）。
  顺序是 JS 运行时算出来的，产物里只有展开、看不出先后。
  唯一能看运行时 DOM 的是 `_diag/measure-page.mjs`，但它是**手写 mock**，
  拿它当判据等于造第二个真源。⇒ **要确认只能上真机/开发者工具看。**
- 真机上的观感（封面裁切后好不好看）。已出静态证据图
  （`_diag/cover-inspiration-preview.png`，按 236×354 真实尺寸叠了 veil 与白字），
  但那不是真机渲染。
- 「产品拍摄 / 电商主图 退成两跳」之后的实际可用性 —— 只验证了
  `product-gallery` 把两个意图都做成了 tab（读 `PRODUCT_STUDIO_INTENTS`），
  没走一遍真机点击。

---

## 明确禁止的回归

1. **不许**把 `.home-features` / `.home-feature-*` 这块加回首页 ——
   2026-09-23 那条「集中展示」规矩**已作废**。真要加回来，先问王，
   再同步改 `verify-dist.mjs` 的 `should` 与 `test-creator-ui.mjs` 那组负向断言。
2. **不许**让「灵感复刻」的卡片用 4:5 的图 —— 那会重新切掉参考照片的左边缘。
   改图走 `_tools/make-cover-inspiration.py`（它自带两条断言）。
3. **不许**给 `create-reference` 的卡片 url 加 query —— 它不读任何路由参数，
   加了不报错、只会被静默忽略，但下次照抄就会抄成 `?id=`。
4. **不许**把 `.home-feature-kicker` 从共享选择器组里「顺手删整组」——
   同一组里的 `.workflow-label` / `.workflow-hint` / `.inspiration-tag` /
   `.composer-section-note` 都还在用。
5. **不许**把 `POSTER_PIN_ID` 改成不存在的 id —— 轮播会静默少一张卡。
   门禁会拦（`check:poster-directions`），别绕过它。
