# 交接：新增「收据拼贴」模板 + 修首页轮播卡白字对比度

日期：2026-09-26
触发：王给了 `image#1:HTDdOihaoAAfQMc.jpg` + 一段 12 段的中文提示词规格，
要求「查看这个模板，并添加在小程序的首页轮播中」。

---

## 0. 一句话结论

「收据拼贴」已作为**产品替换模板**上线到首页轮播**第 8 张（产品组第一张）**，
替换掉原「石材工作室」（产品精选场景**仍是 14 个**）；
顺带修掉一条既有的**静默可读性缺陷**（18 张轮播卡里 7 张的白字名字过不了 AA 4.5:1）。
`npm run release` 退出码 0，产物门禁 **52 项通过 · 0 项提醒 · 0 项阻断**。

---

## 1. 王定的 5 件事（AskUserQuestion）

| 问题 | 王的选择 |
|---|---|
| 落地方式 | **走「产品图」上传链** |
| 模板封面 | **用 AI 生成一张同形式的封面** |
| 场景数量 | **替换掉一个现有场景**（保持 14 个） |
| 替换哪一个 | **`stone-studio`「石材工作室」** |
| 轮播位置 | **产品组第一张（第 8 张）** |
| 卡片命名 | **「收据拼贴」** |

### 为什么不能做成「海报方向」
海报方向是**纯文生图**：`compilePrompt` 只暴露 主题/标题，`create-poster` 调
`generateImages`。而这个模板的**定义性特征**是「先分析图像 A，再从它的主题、场景、
氛围、颜色和情感基调生成所有文案」——必须吃一张上传图。
唯一能「锁定提示词 + 1 张上传图」的宿主是产品链
（`productReplacementTemplates` → `pages/create-product`）。

---

## 2. ⚠️ 最重要的一条：我改写过王给的提示词原文（4 处），已修

上一轮摘要把王的消息记成了「full English prompt text」。**原文其实是中文**
（12 段，描述的是 EB Garamond / Whisper 这些英文字体）。
我从会话 jsonl 里把原话挖出来逐字比对，发现我暂存的那份被自己改了 4 处：

| # | 王的原文 | 我改成了 |
|---|---|---|
| 1 | 使用**提供的图像**作为图像 A | 使用**用户上传的图片**作为图像 A |
| 2 | 格式为**“@ 单词”或“@ 短语”** | 格式为**「@ 单词」或「@ 短语」** |
| 3 | 使用 Google 字体**“Whisper”** | 使用 Google 字体 **Whisper** |
| 4 | 随后是**“Vol. 01。”** | 随后是**「Vol. 01。」** |

改写理由显然是「怕弯引号出事」——**这个理由是错的**：弯引号是 U+201C/U+201D，
**非 ASCII**，塞进 JS 反引号/单引号字面量里本来就没有转义问题。
实测原文：反引号 0、ASCII 引号 0、花括号 0、反斜杠 0，11 个换行。

**现已改用王的原文，并加判据守住**（见 §5）。
`avatarTemplates` 里 `capsule-eye-avatar` 那条注释早就写着「王给的底层提示词原文，
逐字照搬」——我没照做。**这是本次最该记住的教训。**

### 找回「用户原话」的标准路径
`grep -rl "thermal paper"` 全库零命中 → 原话**不在仓库里**，在
`~/.workbuddy-ai/projects/<project>/<sessionId>.jsonl`（本次 16.8 MB）。
定位法：逐行 `JSON.parse` → 找 `content[0].text` 含特征词的记录。
⚠️ `~/.workbuddy-ai/logs/**` 是**运行时日志，不存对话内容**，别在那里找。

---

## 3. 改动清单

| 文件 | 改动 |
|---|---|
| `forme-taro/src/data/prompt-templates.ts` | 删 `stone-studio` 整行；数组**第一项**插入 `receipt-collage`；加 `productReceiptCollage` import |
| `forme-taro/src/assets/product-receipt-collage-reference.jpg` | **新增**，640×960（正好 2:3），92,557 B |
| `forme-taro/src/styles/forme.scss` | `.hd-card-veil` 渐变由两点改为三点（见 §4） |
| `work/visual-studio/src/prompt-templates.ts` | 同源镜像（LF / 双引号 / cover 用字符串路径） |
| `work/visual-studio/public/assets/product-receipt-collage-reference.png` | **新增**，560,530 B |
| `forme-server/scripts/jev-probe.mjs` | 手抄表 24 → **30 条**（补 6 个缺失海报方向）；加漂移自检 |
| `forme-taro/scripts/test-product-studio.mjs` | +47 行：产品组第一张 + prompt 逐字 |
| `forme-taro/scripts/verify-dist.mjs` | +86 行：新封面 4 条产物判据；+98 行：veil 判据；更正一段过时注释 |
| `_diag/retired-2026-09-26/stone-studio-entry.txt` | **stone-studio 那一行的逐字备份**，可原样贴回 |

### 为什么封面用 2:3 而不是兄弟模板的 3:4
兄弟产品封面是 640×853（3:4），塞进 2:3 的 `.hd-card` 会**裁掉约 11%**。
这张源图本来就是 2:3（1024×1536，零裁切），压到 640×960 仍是零裁切。
`cover-inspiration-recreate.jpg` 是同例。**这是设计决定，已写成判据守住。**

---

## 4. 顺带修掉：首页轮播卡白字对比度

### 问题
`.hd-card-veil` 原来是**两点渐变** `rgba(0,0,0,0.62) → 0`（高 96px）。
卡片名字是白字 15px / bottom 12px ⇒ 墨迹上沿距底 27px ⇒ t = 27/96 = 0.28125，
该处 alpha 只有 **0.426**。

纯白底上要过 AA 4.5:1 需要 **alpha ≥ 0.533**（推导：合成灰度 ≤119
⇒ 255×(1−alpha) ≤ 119）。实测 **18 张轮播卡里 7 张过不了**：

| 封面 | 低于 AA 的墨迹面积 |
|---|---|
| poster-overhead-flatlay | 36.3% |
| poster-phone-candid | 28.7% |
| avatar-capsule-eye | 18.4% |
| **product-receipt-collage（本次新增）** | **16.3%** |
| poster-paper-field | 14.8% |
| product-tennis-bag | 6.9% |
| avatar-soft-ip-mascot | 5.2% |

### 修法（王 2026-09-26 批准）
```scss
/* 旧 */ background: linear-gradient(to top, rgba(0, 0, 0, 0.62), rgba(0, 0, 0, 0));
/* 新 */ background: linear-gradient(to top, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0.55) 30%, rgba(0, 0, 0, 0));
```
文字墨迹上沿处 alpha = **0.5606 ≥ 0.533** ⇒ **18/18 张全部过 AA**，最低 5.38:1。

### ⚠️ 更正一条旧结论（2026-09-25 记错了）
旧记录是「7 张本地封面里 4 张不达 AA」。**那条结论有两处错**：
1. **量错了对象**：脚本的文字框是 `354-30-lh .. 354-12`（距底 12..48px、高 36px），
   那是**行高盒**不是字形。15px 的字墨迹只占 12..27px，上方 20 多 px 是空的，
   而空的那段正好是渐变最淡处 ⇒ **数字被系统性夸大**
   （同一张新封面：行高盒口径 65.6%，墨迹口径 16.3%）。
2. **漏了 11 张卡**：正则只匹配 `^(cover|poster)-`，**不含 `product-` / `avatar-`**，
   而它们本来就在轮播里。

两个坑都已在脚本里注明并修好。**覆盖面不全的测量比没有测量更坏：
它给出一个看起来很确定的数字。**

### 复算工具
- `_diag/name-ink-contrast.py` —— **按真实墨迹像素**，这是权威口径
- `_diag/contrast-carousel-cards.py` —— 已补全匹配面，但口径是行高盒（偏保守/偏大）
- `_diag/receipt-card-preview.py` → `_diag/receipt-card-preview.png` —— 修前/修后对照图

---

## 5. 判据：加了 11 条，逐条证明会拦

### 源码级（`test-product-studio.mjs`）
1. `templateIds[0] === 'receipt-collage'` —— 产品组第一张（王指定）。
   首页轮播的产品卡顺序 = 本数组顺序，所以「挪一下位置」会真的改变用户看到的
   第一张产品卡，而编译和别的判据全绿。
2. prompt **逐字**断言：含「使用提供的图像作为图像 A」、不含「用户上传的图片」、
   含 3 处中文弯引号。**这条直接由 §2 那个错误长出来。**

### 产物级（`verify-dist.mjs`）
3. 新封面已 emit 且是真实图片
4. 新封面真的被代码引用
5. 新封面体积 < 400KB
6. 新封面纵横比 = 轮播卡纵横比
7. **veil 在文字上沿处 alpha ≥ 0.533**

### 对抗测试结果（全部拦住）

| 变异 | 退出码 | 拦它的断言 |
|---|---|---|
| 把 receipt-collage 挪出第一位 | 1 | 产品组第一张应该是 receipt-collage，实际是 gelato-overhead |
| 「提供的图像」→「用户上传的图片」 | 1 | prompt 被改写了 |
| 弯引号 →「Whisper」 | 1 | prompt 的中文弯引号被改掉了 |
| 整条删掉 | 1 | 精选场景应保留 14 个，实际 13 |
| 产物封面换成 3:4 | 1 | 封面纵横比 = 轮播卡纵横比 |
| 产物封面移走 | 1 | 4 项阻断 |
| 产物 JS 里引用改名 | 1 | 封面真的被代码引用 |
| 产物渐变改回两点 | 1 | alpha = 0.4456 < 0.533 |
| jev-probe 表删一条 | 1 | 条数对不上：29 / 30 |
| jev-probe 表改一条描述 | 1 | 「receipt-collage」的描述不同 |
| jev-probe 表对调两条顺序 | 1 | 第 25 条 id 不同：food-type / paper-field |

还原后 sha256 逐字节一致，复跑退出码 0。

### ⚠️ 一个关键设计判断：判据要扫**全部** dist 的 .js
灵感复刻那条判据查的是 `dist/pages/home/index.js`。**这张封面不在那里** ——
它在 `dist/common.js`（`prompt-templates` 被 home 与 product-gallery 共用，
Taro 放进共享 chunk）。**照抄那条写法会得到一条假红。**
假红比没有判据更坏：它会让人把判据删掉。

---

## 6. 第三个模板镜像：`forme-server/scripts/jev-probe.mjs`

全库搜 `stone-studio` 时发现的。它有一张**手抄**的 id → description 表，
自带注释「与 `forme-taro/src/data/prompt-templates.ts` 逐字一致，别手改」。

**它早就不是逐字一致了**（这个漂移**先于**本次改动）：

| | 上游 | jev-probe（改前） |
|---|---|---|
| 产品模板 | 14 | 14 |
| 海报方向 | **16** | **10** |
| 合计 | **30** | **24** |

缺的 6 个正是前几次会话新加的海报方向：`paper-field`、`food-type`、`shallow-dof`、
`overhead-flatlay`、`phone-candid`、`anomaly-subject`。

**后果**：`TEMPLATES` 是喂给模型的 `criteria`（候选标签表）。
少 6 个方向，探针只能在 10/16 里选 ⇒ 它测出来的「模板推荐准确率」是**偏的**，
而且**不报错**。拿一个偏掉的数字去决定「要不要接 Jev」，比没有数字更坏。

**已按王批准补齐到 30 条（逐字 + 同序），并加 `checkTemplateMirror()` 自检。**
自检的态度照抄 `check-prompt-mirror.mjs`：
上游不在 → 明说「这次没运行」，不让别人的机器变红；上游在但对不上 → **报错退出**。

⚠️ **遗留**：`PAGES.gallery` 那句写的是「产品模板：从 **24** 个预设模板里挑一个套用」，
但产品工作室的「精选场景」tab 渲染的是 **14** 个。这个数字我没动
（它的指代不明：可能指 14 产品，也可能指 14+16=30 的整个库），**等王定**。

---

## 7. 验证结果

| 项 | 结果 |
|---|---|
| `npm run release` | **退出码 0** |
| `verify:dist` | **52 项通过 · 0 项提醒 · 0 项阻断**（原 47，+5） |
| `check:prompt-mirror` | **35 个模板两边完全一致** |
| `check:poster-directions` | 通过（16 个方向） |
| `test:product-studio` | 通过（产品替换 **14 条**，数量未变） |
| `check:asset-filters` | 通过（产品 14 条） |
| 轮播复算 | **18 张**（原 17）；「收据拼贴」第 **8** 张 = 产品组第一张；`stone-studio` 已消失 |
| 白字对比度 | **18/18 过 AA 4.5:1**（最低 5.38:1） |
| 设计真源 `tsc --noEmit` | 退出码 0 |
| 主包 | 1,729,038 → **1,828,723 B（+99,685 B）**；余量 359.5 KB → **262.1 KB** |

---

## 8. 未验证 / 待办

1. **`PAGES.gallery` 的「24 个预设模板」要不要改成 14** —— 指代不明，等王定。
2. **设计真源只跑了 `tsc --noEmit`，没起 Vite 构建**，也没在浏览器里看过新封面。
3. **真机没测** —— 这台机器上起不了小程序模拟器。
4. **主包余量 262.1 KB** —— 再塞两张 100 KB 级封面就要重新考虑分包。
5. jev-probe 的**历史测量结论需要重测**：改前它用的是 24 条候选集
   （产品推荐那部分不受影响，**模板推荐那部分偏了**）。

---

## 9. 追加（同日晚些）：negative 与页面文案按模板切

### 起因：王问「收据拼贴不是使用原图吗」

对，是。它的 prompt 第一句就是「使用提供的图像作为图像 A」——**用户上传的那张图
就是主角**，被全出血印成照片、用回形针夹在热敏收据上。这暴露出两处**继承来的错**：

| 位置 | 继承来的东西 | 为什么错 |
|---|---|---|
| 模板表 | `negative: productNegative` | 那套把输入预设成**带包装的商品**（「保持用户上传**产品**的外观…**包装文字与品牌标识**准确」「不得…改变**产品结构**」「无关人物」）。它会**暗示模型编造**照片里根本没有的包装文字/品牌标识；而「无关人物」与「照片里本来就有个人」直接冲突 |
| 页面 | 「模板会自动保留场景、光线和构图，只替换画面中的产品主体」 | 这条模板**不替换产品**，它把照片印出来夹在收据上 |

两处都**不会**让编译 / typecheck / 其它门禁变红 —— 只会让出图跑偏、
页面说的和做的不一样。

王定：**「单独写 negative + 页面文案按模板切（推荐）」**。

### 改法

**① negative**：新增 `receiptCollageNegative`（两个文件各一份，裸标识符，靠镜像门禁比对）。
只兜住这条模板**真的会**踩的失败模式：图像 A 被换掉、背景不是纯白 #FFFFFF、
照片被加白边/宝丽来边、两张纸不等宽、回形针只夹住照片、照片反客为主。

**② 页面文案**：`ProductReplacementTemplate` 加一组**扁平可选字符串**
（`ProductPageCopyOverride`，8 个字段），目前**只有 receipt-collage 填**。
`create-product/index.tsx` 用 `DEFAULT_COPY`（**= 改造前的原文，逐字保留**）
+ 逐字段 `??` 解析；另外 13 个模板看到的一个字都没变。
顶栏 `产品替换` **按王的要求保留**（它是入口名），所以 `verify-dist.mjs` 的
`HEADER_PAGES` 判据**不需要改** —— 原来的判断（「要改顶栏判据」）是错的。

### ⚠️ 为什么必须是**扁平字符串**，不能是嵌套对象

镜像门禁的解析器是
`/\{\s*id:\s*["']([^"']+)["']([\s\S]*?)\n?\s*\}/g` —— **lazy，会停在第一个 `}`**。
嵌套对象的内层 `}` 会把 `body` 截断，排在它**后面**的字段（例如 `negative`）
会被**静默**读成 `undefined`；两边都 undefined 就「一致」了 ⇒ **判据静默失效**。
`check-prompt-mirror.mjs` 里为此加了一条**特征测试**钉住这个边界
（`嵌套对象会让后面的字段静默丢失（已知边界，修了 OBJ 就改这条）`）。

### 第三个镜像：设计真源的原型页

`work/visual-studio/src/Prototype.tsx` 的 `ProductReplaceScreen` **也硬编码了同一页文案**。
已同步成同一套逐字段 `??` 解析 + `PRODUCT_PAGE_COPY_DEFAULTS`。
（两边是**刻意的重复** —— 两个工程没法共享模块。）

⚠️ 顺带发现一处**隐藏耦合**：那个原型的 `UploadSlot` 用 **`label` 文本**决定上传槽
索引（`label.includes("商品") || label.includes("参考") ? 0 : 1`）。
「上传产品」和「上传照片」都落到 1，行为不变 —— 但以后改 `label` 文案时要想到它。

### 判据：新增 8 条，逐条证明会拦

**镜像门禁**（`FIELDS` 从 8 → 16 个字段；自测 10 → 14 个样本）
1. 8 个文案字段两边逐字一致（配「抽得到 / 不同要报 / 相同不报」三条自测）
2. 特征测试：嵌套对象会让后面的字段静默丢失

**`test-product-studio.mjs`**
3. receipt-collage 的 `negative` 必须是 `receiptCollageNegative`，且不再是 `productNegative`
4. 8 个文案字段的值逐条对
5. 8 个文案字段**只准 receipt-collage 填**（减速带：加第二个时会响）
6. 页面 `DEFAULT_COPY` 的 8 条默认文案必须还是改造前的原文（改它 = 改 13 个模板）
7. 页面必须真的**读**模板上的每个覆盖字段（`template.X ??`）—— 少读一个 = 填了不生效
8. 代码里、`DEFAULT_COPY` **之外**不准再出现这些字面量 —— 少这条的表现是
   「字段读了、也解析了，但 JSX 里渲染的还是写死的字面量」

另外 `receiptEnd` 的定位从
`endsWith('negative: productNegative },')` 改成「本条目的第一行以 `},` 收尾」，
并加了**块边界自检**（既不能少收尾部，也不能把下一个条目吞进来）。
旧判据在 negative 换名后会一条都匹配不到 —— 它是**变更探测器**，不是坏判据。

### 对抗测试（15/15，含 2 个控制组）

| 变异 | 拦它的断言 |
|---|---|
| 设计真源改 pageCopy 一个字 | 镜像门禁：`receipt-collage · pageCopy` |
| 小程序侧改 pageHeadline | 镜像门禁：`receipt-collage · pageHeadline` |
| 任一侧改 `receiptCollageNegative` | 镜像门禁：`receipt-collage · negative` |
| 只给一边加 pageHeadline | 镜像门禁：`gelato-overhead · pageHeadline` |
| negative 换回 `productNegative` | 应该用自己的 receiptCollageNegative |
| 条目尾部少一个逗号 | 收尾判据会吞掉下一条（块边界自检） |
| 改 pageCopy / 删 uploadError | 页面文案字段 X 应该是 … |
| 给第二个模板也填 | 只有 receipt-collage 该填页面文案覆盖 |
| 页面不再读 `template.uploadHint ??` | 没有读模板的 uploadHint |
| 改 DEFAULT_COPY 一条 | 默认文案 pageCopy 被改了 |
| JSX 里写死回字面量 | 在 DEFAULT_COPY 之外还出现了 |

### ⚠️ 第 8 条判据被对抗测试**当场证伪过两次**（值得记下来）

**第一次（假门禁）**：第一版写的是
`createProductSource.split("'" + value + "'").length - 1 === 1` —— **带引号地数**。
把 JSX 改回 `<Text>上传产品，</Text>`（**没有引号**）时它数出来还是 1，**exit=0**。
⇒ 假门禁，`npm run release` 会全绿。

**第二次（误报）**：改成「不带引号地数」之后，**控制组**又把它抓了 ——
文件顶部的注释里有一句「**上传产品**图，所以页面刻意不提供提示词输入框」，
里面**含**默认文案 `上传产品`，于是它在 `DEFAULT_COPY` 之外「出现 1 次」。

**最终版**：先剥掉注释，再断言「代码里、`DEFAULT_COPY` 之外出现 0 次」。

两次都是**对抗测试自己**把它抓出来的。这就是为什么每条判据都要配控制组 ——
只测「改坏了会红」是不够的，「没改时是绿的」同样要证明。

### 本轮验证结果

⚠️ **诚实记法**：`npm run release` 这一条**没有**作为单条命令跑完 —— 见下面第 5 条。
下表是**逐条**跑的退出码，覆盖面与 `release` 相同（typecheck + 6 个 check/test +
build:weapp + verify:dist + check:poster-directions）。

| 项 | 结果 |
|---|---|
| `typecheck` | 退出码 **0** |
| `check:request-key` / `check:no-pixel` / `check:asset-filters` | 退出码 **0** |
| `test:creator-ui` / `test:reference-images` / `test:reference-recreate` | 退出码 **0** |
| `check:prompt-mirror` | **35 个模板 · 16 个字段两边完全一致**（自测 **14** 个样本，原 10） |
| `test:product-studio` | 通过（产品替换仍 **14 条**） |
| `build:weapp` | Compiled successfully（**10.61s**） |
| `verify:dist` | **52 项通过 · 0 项提醒 · 0 项阻断** |
| `check:poster-directions` | 通过（16 个方向） |
| 设计真源 `tsc --noEmit` | 退出码 **0** |
| 设计真源 `vite build` | 退出码 **0**（512 modules，1.63s；只有一条既有的 chunk >500kB 提醒） |
| 对抗测试 | **15/15**（含 2 个控制组），还原后逐字节一致 |
| 主包 | 1,828,723 → **1,830,976 B（+2,253 B）**；余量 262.1 → **259.9 KB** |

### ⚠️ 环境坑：后台跑 `npm run release` 会卡在 `taro build` 里（今天新踩）

第一次把 `npm run release` 丢到后台（输出重定向到文件）跑，**11 分钟没结束**：
日志停在 `taro build --type weapp` 的 deprecation warning 之后，
`dist/` 只写出了根文件（`runtime.js` / `taro.js` / `vendors.js` / `utils.wxs` /
`project.config.json`）和几个**空的** `pages/*` 目录，**`dist/app.json` 根本没生成**。

前台重跑同一条 `npm run build:weapp`：**10.61s 编译成功**。

⇒ 卡的是**环境**（后台 + 沙箱/安全删除守卫），不是代码，也不是包体。
**结论：这台机器上跑 `npm run release` 要放前台**，别丢后台。
（另有一条同源记录：`grep | tail` 管道会让它卡 7m40s，重定向到文件就好。）

### 本轮仍未验证

1. **`receiptCollageNegative` 的实际出图效果没测过** —— 没有 API key，跑不了真生成。
   这条 negative 的质量判断**只有静态推理**（prompt 第一句「使用提供的图像作为
   图像 A」本身已自足，negative 只是兜底）。
2. 设计真源**这轮补跑了 `vite build`（退出码 0）**，但**没在浏览器里看过**原型页 ——
   也就是说「`ProductReplaceScreen` 在 receipt-collage 下真的显示新文案」这件事
   只由 `tsc` + 构建通过来背书，**没有肉眼确认**（本环境起不了浏览器）。
   同理，小程序页面也没在模拟器/真机上看过。
3. 真机没测。
4. **两处默认文案（小程序页 vs 设计原型）没有门禁守着一致性** ——
   它们是刻意的重复，改了任一边不会报警。属于已知缺口。
   实测：共有的 **7 个字段目前逐字一致**；第 8 个 `uploadError` 只有小程序有
   （原型没有「没传图就点生成」的报错路径，所以它只定义了 7 条）。
