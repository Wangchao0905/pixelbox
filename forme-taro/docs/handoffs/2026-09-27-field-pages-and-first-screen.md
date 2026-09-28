# 2026-09-27 · 首页首屏呼吸空间 + 三个字段式生成页同构

> 承接 `2026-09-27-ui-live-acceptance.md`（真机模拟器验收）。
> 那一轮的 §10.5 留了一个「等王定」的残留；王 2026-09-27 答复：**① 要 ② 要，完成后继续 P1**。
> 本文记录 ① 与 ② 的实施与验证。P1 方案见 `docs/ui-improvement-p1.md`。

---

## 0. 一句话结论

① 首页 composer 卡的底边从 **839.36 → 804.36**（视口 844、底部安全区从 810 起），
不再压在 home indicator 上；② 三个字段式生成页从**两套旧结构**改成与自由生图**同构的三层卡**，
同时清掉浅色主题遗留的橄榄绿配色。
发布链 `EXIT=0`、`verify:dist` **64 项通过 · 0 提醒 · 0 阻断**；
主包 **74 文件 · 1,736,184 B · 82.79% · 余量 352.5 KB**（比改动前**小**了 1.4 KB）。

---

## 1. ① 首页首屏呼吸空间

### 1.1 症状与实测

| 元素 | 改前（视口 390×844） |
|---|---|
| `.hd-topline` | top 47，高 46（safe-t = 47） |
| `.hd-stage` | top 112，高 396（`margin-top: 20px`） |
| `.hd-swiper` | top 112，高 353 |
| `.hd-caption` | top 482，高 10（`margin-top: 18px`） |
| `.hd-progress` | top 507，高 1–2（`margin-top: 16px`） |
| `.home-intro` | top 508，高 132.36（`padding: 36px 20px 16px`） |
| `.home-composer-card` | top **640.36**，高 ~199.4 ⇒ 底边 **839.36** |
| `.home-workflows` | top 869.36（`margin-top: 30px`） |

视口 844；**底部安全区从 810 起**；home indicator 条约 831–836。
⇒ 卡底 839.36 **压在指示条上**，观感像被切掉。

### 1.2 一个必须一起处理的约束

`.home-workflows` 在卡下面 30px。如果只把卡往上推 ~34px（卡底 → 805），
「更多工具」标题（约 22px 行高）会落在 **835–857** —— 屏幕底会露出**半行被切掉的标题**。
所以「把卡往上推」必须**同时把下一节也推下去**。

### 1.3 改动（只压间距，不动任何组件尺寸）

| 项 | 改前 | 改后 | 省 |
|---|---|---|---|
| `.hd-stage` `margin-top` | 20px | 14px | 6 |
| `.hd-caption` `margin-top` | 18px | 12px | 6 |
| `.hd-progress` `margin-top` | 16px | 10px | 6 |
| `.home-dark .home-intro` `padding` | `36px 20px 16px` | `24px 20px 10px` | 18 |
| `.home-workflows` `margin-top` | 30px | **46px** | −16（推下去） |

轮播卡仍是 236×354、输入区仍是 84px、卡片内边距仍是 15px —— **一个组件尺寸都没动**。

⚠️ `.home-workflows, .home-recent-section { margin-top: 30px; }` 原本是**逗号组**，
按铁律 #12 拆成两条单选择器（保留块体），没有整块删。
（顺带发现 `.home-recent-section` 是**死类**：全项目只有这一处提到它。）

### 1.4 改后实测

| 元素 | 改后 | 差 |
|---|---|---|
| `.hd-stage` top | 106 | −6 |
| `.hd-caption` top | 470 | −12 |
| `.hd-progress` top | 489 | −18 |
| `.home-intro` top / 高 | 490 / 114.36 | |
| `.home-composer-card` top | **604.36** | **−36** |
| ⇒ 卡底 | **804.36** | **−35** |
| `.composer-card-footer` 底 | 789.36 | 在安全区（810）之上 |
| `.home-workflows` top | **849.36** | > 844 ⇒ 首屏不外露 |

**像素级复核**（截图 363×785，k = 844/785；截图里不渲染系统 home indicator，
所以只扫亮元素）：

| | 改前 | 改后 |
|---|---|---|
| 「生成」按钮底边（视口） | 822.5 | **787.0** |
| 最下方亮元素 | y=765 行 | y=732 行 |

⇒ 卡底 804.36 落在安全区之上，屏幕底部留出 39.6px。

### 1.5 门禁（`scripts/test-creator-ui.mjs`，+3 条）

判据是**预算**而不是直接算卡底，因为卡底 = **可变间距**（源码里读得到）
+ **固定部分**（顶栏 93 / 技能行 10 / 进度条 2 / 说明区内容 80.36 / 卡片 199.4，
**只能实测**）。

```js
const HOME_FIRST_SCREEN_BASE = 377.36   // 实测卡底 839.36 − 改前间距之和 462
const HOME_FIRST_SCREEN_LIMIT = 810     // 844 − 底部安全区 34
```

三条断言：
1. **假设守卫**：`.home-composer-input` min-height 84 / `.composer-launch` min-height 42 /
   `.home-composer-card` padding 15 / `.composer-card-footer` margin-top 12 /
   `.home-composer-input` margin-top 14 —— **任一变了就红**，并提示「重新量卡底、更新常量」。
   （没有这条，常量一变就**静默失效**，那正是「留一条永远为真的断言」。）
2. 卡底 ≤ 810
3. 卡底 + `.home-workflows` margin-top > 844

⚠️ 视口前提写进注释了：**390×844（iPhone 12/13），状态栏 47、底部安全区 34**。
换机型要重新量 —— 首屏是「视口相关」的概念。

### 1.6 对抗测试（`_diag/adversarial-first-screen.py`，5/5 符合预期）

| 变异 | 结果 |
|---|---|
| 控制组（不改） | EXIT=0 ✅ |
| A 首屏间距整体还原成改前 | EXIT=1，红的是「卡底 839.36 > 810」✅ |
| B `.home-workflows` margin-top 还原成 30 | EXIT=1，红的是「标题顶边 833.36 ≤ 844」✅ |
| C `.home-composer-input` min-height 84→100 | EXIT=1，红的是「固定部分变了」✅ |
| 恢复后 | EXIT=0 ✅ |

**⚠️ 第一版对抗脚本自己有 bug**：期望命中的关键词我写成「首屏预算」「露头」，
而断言里实际写的是「composer 卡的底边会落在」「露出一截被切掉的」。
于是三条门禁**其实都拦住了**，脚本却报 FAIL。
⇒ 又一次铁律 #18：**验收脚本自己也会说谎**。判据要对齐**断言里真实出现的字串**。

---

## 2. ② 三个字段式生成页改成与自由生图同构

### 2.1 为什么改：三条硬证据

1. **`.preview-panel` 是 `aspect-ratio: 0.92`** ⇒ 实测约 **352×383**，
   一张图占掉首屏近一半，用户要滚过它才看得到输入项。**这是「界面杂乱」的主因。**
2. **两套标题系统**：字段式页用 `structured-intro` + `.h1`（31px），
   自由生图用 `composer-page-head` + `composer-page-title`（27px）。
3. **32 处硬编码色，14 处是令牌的「近似值」**：同一个「次要灰」写了 6 个不同值
   （`#8d958f` / `#909891` / `#8f9690` / `#8b928c` / `#8b938c` / `#858a87`，
   而 `--muted` 是 `#8b8b85`），还残留**浅色主题的橄榄绿**
   （`.select-field` 边框 `#4a5844` / 底 `#1a2119` / 字 `#edf4e8`；
   ✦ 锁图标 `#8b9f29` / `#9bad34`）。

### 2.2 王定的三件事

| 问题 | 王的选择 |
|---|---|
| 352×383 的模板预览图怎么放 | **缩成 96×96 小方图并入页头** |
| 假的 `♡` 收藏按钮（只弹 Toast，不存数据） | **删掉** |
| 产品/头像页没有可调项，要不要也留「输出设置」卡 | **都保留，无项时不可展开** |

### 2.3 改后的结构（三页 + 自由生图四页一致）

```
app-screen create-content page-pad has-dock page-enter
├── AppHeader
├── composer-page-head is-thumbed          ← 96×96 缩略图 + overline/标题/说明
├── composer-scroll
│   ├── input-card composer-surface        ← 唯一的创作输入
│   │   └── （海报：方向 + 主题 + 标题 + 锁定行）
│   │       （产品/头像：上传槽 / IP 主体 + 提示 + 模板信息）
│   ├── settings-card                      ← 可调项（海报可展开；另两页静态）
│   │   ├── settings-header [composer-toolbar]  + settings-badge（当前配置摘要）
│   │   └── composer-settings-panel [is-expanded]  ← 只有海报有
│   └── back-home-link
└── GenerateDock
```

「输出设置」卡的徽标走**同一个映射点** `optionLabel(QUALITY_OPTIONS, …)` /
`optionLabel(MODEL_OPTIONS, …)`，与自由生图一致 —— 不会再印出 `gpt-image-2.5-sunburst`。

⚠️ 产品页与头像页的 `config = defaultConfigForRatio(template.ratio)` **同时喂给徽标和真正的请求**，
不各算一次（「界面写 A、发出去 B」这种错不报错，只是出图不对）。

### 2.4 顺带做的：颜色令牌化

12 条规则 1:1 改成令牌引用（**不发明新色**）：

| 选择器 | 改前 | 改后 |
|---|---|---|
| `.select-field` | `#4a5844` / `#1a2119` / `#edf4e8` | `var(--line)` / `var(--surface-2)` / `var(--ink)` |
| `.select-field.is-compact` | `#eaf2d6` | `var(--ink)` |
| `.structured-field` | `#909891` | `var(--muted)` |
| `.structured-field .field-input` | `#353c39` / `#181d1c` / `#e9ede6` | `var(--line)` / `var(--surface-2)` / `var(--ink)` |
| `.structured-lock` / `.lock-icon` | `#68716a` / `#8b9f29` | `var(--muted)` / `var(--accent)` |
| `.replace-tip` | `#737d75` | `var(--muted)` |
| `.replace-lock` / `.lock-icon` | `#778179` / `#9bad34` | `var(--muted)` / `var(--accent)` |
| `.back-home-link` | `#707772` | `var(--muted)` |
| `.option-row` | `#8f9690` | `var(--muted)` |
| `.option-pills .pill` | `#343a38` / `#8b928c` | `var(--line)` / `var(--muted)` |

### 2.5 死 CSS：删了 20 条规则 / 2,231 B

`_diag/audit-dead-classes.py` 找出「没有任何 TSX 引用」的类，
`_diag/remove-dead-css.py` 只删**每一段选择器都含死类**的规则。

删掉：`.preview-panel` / `.preview-img` / `.preview-scrim` / `.preview-topline` /
`.preview-bottom` / `.preview-label` / `.preview-action` / `.structured-intro`(+2) /
`.structured-section`(+1) / `.compact-settings`(+1) / `.replace-upload-section`(+1) /
`.freeform-intro`(+2，P0 之后就没用了)。

⚠️ 判据踩过一个坑：**第一版把「后代选择器」误判成「逗号组」**。
`.structured-intro .h1` 里 `.h1` 是活的，判据写成「所有类 ⊆ 死类集合」就判不出来，
被误报成「一半死一半活」。
**正解**：后代选择器只要**祖先死了**整条就死 ⇒ 判据是「**每一段**选择器都**含至少一个**死类」。

### 2.6 门禁（`scripts/test-creator-ui.mjs`，+6 条）

1. **三页同构**：每页 JSX 的 `className` 字面量必须包含 14 个 shell 类
   （`composer-page-head` / `is-thumbed` / `composer-page-thumb` / `input-card` /
   `settings-card` / `settings-badge` …）。
2. **旧结构的类一个都不许留**：`preview-panel` / `structured-intro` / `structured-section` /
   `compact-settings` / `replace-upload-section`。
3. **设置卡形态**：海报必须有 `composer-settings-panel`（可展开）；
   产品/头像必须**没有**（静态）。
4. **假收藏按钮不许回来**：三页源码（去注释）不许出现 `♡` 或 `已收藏到灵感夹`。
5. **缩略图页头**：`.composer-page-head.is-thumbed` 是 flex + gap 14px；
   `.composer-page-thumb` 是 96×96 且 `flex: 0 0 96px`；
   `.composer-page-heading` 必须有 `min-width: 0`（**没有它，长文案会把列撑开、缩略图被挤扁**，
   这是 flex 里最经典的静默布局失败）。
6. **配色必须走令牌**：12 个选择器的规则块里**一个硬编码色都不许有**
   （判据是「一个都不许有」，不是「不许出现某几个色值」—— 后者只拦已知的）。

⚠️ **判据为什么打在 `className` 字面量上，不打裸子串**：
这三页的 TSX 注释里**故意写着** `preview-panel + structured-intro + structured-section`
说明历史。裸子串会被自己的墓碑注释命中（铁律 #11④）。

### 2.7 对抗测试（`_diag/adversarial-field-pages.py`，8/8 符合预期）

| 变异 | 结果 |
|---|---|
| 控制组（不改） | EXIT=0 ✅ |
| A 海报页塞回旧类 `preview-panel` | EXIT=1，红的是「还有旧结构的类」✅ |
| B 产品页去掉 `is-thumbed` | EXIT=1，红的是「没有和自由生图同构」✅ |
| C 产品页装上可展开设置面板 | EXIT=1，红的是「应当是**静态**的」✅ |
| D 头像页塞回假收藏按钮 `♡` | EXIT=1，红的是「♡ 收藏按钮」✅ |
| E 缩略图宽度 96→120 | EXIT=1，红的是「模板缩略图宽度要 96px」✅ |
| F 下拉框塞回橄榄绿 `#4a5844` | EXIT=1，红的是「硬编码颜色」✅ |
| 恢复后 | EXIT=0 ✅ |

---

## 3. 顺带修好的两处「工具在说谎」

### 3.1 `scripts/measure-page.mjs` 的自检**归因错误**

它原本写的是：
```js
if (findMissingClasses([...literalClasses, 'this-class-does-not-exist'], …).length !== 1)
  → 报「判据瞎了」
```
探针和真类混在一个数组里数「缺失数」。于是 mock 一漂、缺失数变成 N+1≠1，
**本该报「mock 漂开了」，却报成「判据瞎了」**。
2026-09-27 改海报页布局时我就是被这条误导了一次。

**已修**：探针单独喂 ⇒ 现在报的是真话
（实测「mock 和真实页面漂开了，缺这些 class：page-enter、composer-page-head、…」共 20 个）。

### 3.2 `measure-page.mjs` 的 `create-poster` mock 已过期

它手搭的 DOM 镜像的是**旧布局**。已重写成新结构（含漂移自检要求的所有 31 个类），
并把 `lockSuffix` 的 before/after 两态（2026-09-21 的 A/B 遗留）合成一个 state。
视口高度 1400 → 1000（这一页从 **~1245px 缩到 914.7px**，短了 330px）。

---

## 4. 未验证 / 需要真机

- **只有模拟器，没有真机** ⇒ ① 的几何量（804.36 / 810 / 844）需要在真机上复测。
- 环境里**没有 `LLM_API_KEY`** ⇒ 真出图一次没跑过；② 改的提交路径只做了静态验证。
- `create-avatar` 的 `text` 形态走的是 `simulator_open_page --query 'id=soft-ip-mascot'`
  （⚠️ 参数要写 `--query`，**不能**写进 `--page` —— 写进去会被丢掉，`query` 回显是空串）。
- ② 没有跑 `prefers-reduced-motion` 下的截图。
- 三个字段式页的**按下反馈**只在模拟器里看过，没逐个点过。

---

## 5. 本次新增/修改的文件

| 文件 | 改动 |
|---|---|
| `src/styles/forme.scss` | ① 5 处间距；② 新增缩略图页头 + 卡片内间距收口；12 条令牌化；删 20 条死规则；加墓碑注释。84,147 → 84,385 B（净 +238 B，但产物因删死规则**小了**） |
| `src/pages/create-poster/index.tsx` | 重写渲染（同构 + 删 ♡ + 缩略图页头） |
| `src/pages/create-product/index.tsx` | 同上；`config` 提到 useMemo 供徽标与请求共用 |
| `src/pages/create-avatar/index.tsx` | 同上 |
| `scripts/test-creator-ui.mjs` | +3 条首屏预算 +6 条同构/令牌门禁 |
| `scripts/measure-page.mjs` | 修自检归因；重写 `create-poster` mock |
| `docs/ui-improvement-p1.md` | **新建**：P1 方案 |
| `_diag/*` | 9 个新脚本（见下表） |

`_diag/` 新增脚本（全部可复跑）：

| 脚本 | 作用 |
|---|---|
| `wxq.sh` | 同 `wx.sh`，自动注入 `--project` |
| `measure.sh` | 并行批量量元素 offset/size |
| `scan-bottom-band.py` | 底部区域逐行扫亮像素的横向范围（区分卡片边框与指示条） |
| `apply-home-breathing.py` | ① 的间距改动 |
| `apply-field-pages-css.py` | ② 的 CSS（含行尾断言） |
| `audit-field-page-colors.py` | 字段式页的颜色漂移取证 |
| `audit-dead-classes.py` | 死类审计（SCSS 定义 vs TSX 引用） |
| `remove-dead-css.py` | 删死规则（先干跑，只删「每段都含死类」的） |
| `adversarial-first-screen.py` / `adversarial-field-pages.py` | 对抗测试 |
| `audit-p1-evidence.py` | P1 取证 |

---

## 6. 下一步

P1 方案已出：`docs/ui-improvement-p1.md`。
里面有**四件事等王定**（P1-1 要不要做、轮播 A/B、P1-3 第 2 步允不允许改观感、`skeleton-pulse` 留不留）。
