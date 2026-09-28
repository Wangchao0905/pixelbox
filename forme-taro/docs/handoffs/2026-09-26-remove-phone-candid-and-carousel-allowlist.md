# 2026-09-26 · 撤掉首页 5 张无记录的轮播卡 + 从模板库删除「手机直出」

> 起因：王说「首页轮播图中有一个手机直出的模板，我没有要求设计这个模板」。
> 查下去发现问题**比这句话大** —— 轮播 18 张里只有 2 张有要求记录。
> 王的两条决定（原话）：
> - 「首页轮播里有 5 张海报卡查不到你的要求记录（纸域微景 / 浅景分离 / 俯拍平铺 / 手机直出 / 异变主体）。你想怎么处理？」→ **「撤掉这 5 张无记录的」**
> - 「你说「从模板库删掉」——这个只针对「手机直出」，还是那 5 个无记录的一起？」→ **「只删「手机直出」」**

---

## 0. 一句话结论

**首页轮播原来不是设计决定，是打包细节决定的。** 改成显式白名单后，新增海报方向**再也不可能自己冒到首页上**；同时「手机直出」（`phone-candid`）已从**四处镜像 + 产物**里整个删除，主包省下 **164,016 B**。

| | 改前 | 改后 |
|---|---|---|
| 首页轮播卡片数 | **18** | **13** |
| 海报方向数 | 16 | **15** |
| 轮播里的海报卡 | 6 张（本地封面那 6 个） | **1 张**（`food-type`「食感成字」，王 2026-09-25 要求置顶的） |
| 决定首页内容的东西 | 封面图**存在哪儿** | `CAROUSEL_POSTER_IDS` 这个数组 |
| 主包体积 | 1,833,255 B（余量 257.7 KB） | **1,717,239 B（余量 371.0 KB）** |

---

## 1. 查证过程（不是「谁偷偷加了」，是「写法本身就不该存在」）

### 1.1 轮播 18 张是怎么来的（复现出来的，不是眼睛数的）

脚本：`_diag/rebuild-home-carousel.py`（确定性复现，不依赖任何运行时）。

```
灵感复刻      1 张（LEAD_CARDS，独立页面 create-reference）
海报方向      6 张 ← 🔴 问题在这儿
产品模板      9 张
头像模板      2 张
────────────────
合计         18 张
```

### 1.2 为什么恰好是那 6 个海报方向

`home/index.tsx` 原来是这样：

```tsx
const posterCards: Card[] = posterDirections.map((t) => ({ … }))   // 全量并入
…
const CARDS = [ …LEAD_CARDS, …posterCards, …productCards, …avatarCards ]
  .filter((card) => !/^https?:/.test(card.cover))                  // 🔴 收口在这
```

- 那条 `.filter` 的**本意**：「远程封面别进轮播」（远程图真机要 `downloadFile` 白名单，没配就整片空白）。
- 它的**实际效果**：「**封面是本地文件的海报方向才进轮播**」。
- 16 个方向里，用脚本确定性渲染出本地封面的**恰好 6 个**（`paper-field` / `food-type` / `shallow-dof` / `overhead-flatlay` / `phone-candid` / `anomaly-subject`）。

⇒ **首页展示什么，被「封面图存在本地还是远程」决定了。** 把某张封面从远程换成本地（或反过来）会**静默改变首页内容**，不报错、不红、不提醒。

### 1.3 要求记录（查了交接文档 / 记忆 / 代码注释三处）

| # | 轮播卡 | 方向 id | 要求记录 |
|---|---|---|---|
| 1 | 灵感复刻 | —（独立页） | ✅ 王 2026-09-25 明确要求 |
| 2 | 食感成字 | `food-type` | ✅ 王 2026-09-25 要求升级 + 置顶 |
| 3 | 纸域微景 | `paper-field` | ⚠️ **有来源注释**（@MrLarus），但**没有「上首页」的要求** |
| 4 | 浅景分离 | `shallow-dof` | ❌ 查不到 |
| 5 | 俯拍平铺 | `overhead-flatlay` | ❌ 查不到 |
| 6 | 手机直出 | `phone-candid` | ❌ 查不到 ← 王点名的这张 |
| 7 | 异变主体 | `anomaly-subject` | ❌ 查不到 |

（16 个海报方向里只有 **2 个**带来源注释：`paper-field`「纸域微景」、`food-type`「食感成字」，都是 @MrLarus。其余 14 个连「这个方向哪来的」都没写。→ 已作为流程改进记入记忆：**新增方向必须带来源注释**。）

---

## 2. 改了什么（逐文件）

### 2.1 `forme-taro/src/pages/home/index.tsx`（LF）

**核心改动**：全量 map → 显式白名单。

```tsx
/**
 * 🔴 只有这里列出的海报方向才会上首页轮播 —— **显式白名单**（2026-09-26 王要求）。
 * …（一段长注释，写清了王原话、根因、为什么不能再改回 map）
 */
const CAROUSEL_POSTER_IDS = ['food-type']

const posterCards: Card[] = posterDirections
  .filter((t) => CAROUSEL_POSTER_IDS.includes(t.id))
  .map((t) => ({
    id: t.id,
    name: t.name,
    skill: t.skill,
    cover: t.cover,
    url: `/pages/create-poster/index?direction=${t.id}`
  }))
```

- 原来那段「2026-09-25 起把 posterDirections 并了进来…只有 6 个本地封面的会进来」的注释**整块替换**成新注释，把根因写死在代码里（下一个人读到这儿就知道为什么不能改回去）。
- `POSTER_PIN_ID = 'food-type'` 不变（`food-type` 仍是真方向，产物级判据继续有效）。
- 其余 4 张（纸域微景 / 浅景分离 / 俯拍平铺 / 异变主体）**仍然存在于模板库**，只是不再上首页。

### 2.2 `forme-taro/src/data/prompt-templates.ts`（**CRLF**，现在 470 行 / 469 CRLF）

三处删除（对应 import + 条目 + 封面）：

1. 删 `import posterPhoneCandid from '@/assets/poster-phone-candid.jpg'`
2. 删条目 `{ id: 'phone-candid', name: '手机直出', …, negative: posterNegative },`
3. 删封面文件 `src/assets/poster-phone-candid.jpg`（112.3 KB）

「镜头语言」注释从**三件套**改为**两件套**，并注明：生成脚本 `_tools/make-camera-posters.py` 还在，但它产出的手机直出那张**已无人 import**。

> ⚠️ **墓碑陷阱**：新注释里**故意**写了字面量 `phone-candid`。所以所有门禁必须锚**条目形态** `{ id: 'phone-candid'`，绝不能锚裸子串 `phone-candid` —— 否则会被自己的注释命中（假红，或者更糟：让判据因为错误的原因通过）。

### 2.3 `work/visual-studio/src/prompt-templates.ts`（LF，设计真源镜像）

删掉 `{ id: "phone-candid", … cover: "/assets/poster-phone-candid.png", … }` 那一行。

> ⚠️ **HOLD（未处理）**：`work/visual-studio/public/assets/poster-phone-candid.png` 现在**没人引用**了（1,138,932 B）。它是设计真源的素材，**不在小程序包里**，删不删都不影响包体 —— 所以我没有动它，等王定。

### 2.4 `forme-server/scripts/jev-probe.mjs`（LF）

- 头部注释 `30 个真实模板 = 14 产品替换 + 16 海报方向` → `29 个真实模板 = 14 产品替换 + 15 海报方向`
- 漂移历史示例里的 `phone-candid` 去掉
- 删掉 `'phone-candid': '手机高感质感，排版笔直作对照',` 这条 id→description 映射

### 2.5 `forme-taro/scripts/check-poster-directions.mjs`（LF）

- `POSTER_IDS`：16 → **15**（去掉 `'phone-candid'`）
- `LOCAL_COVERS`：去掉 `'phone-candid'` 键
- 墓碑注释里「`food-type` 本来就是 16 个…」→「15 个…」
- **新增 1 条判据**：读 `home/index.tsx` 的 `CAROUSEL_POSTER_IDS`，逐个比对 `POSTER_IDS`（见 §3.2）

---

## 3. 门禁（每条都能证明自己会拦 + 都有控制组）

### 3.1 源码级 · `scripts/test-creator-ui.mjs`

> ⚠️ 判据跑在 `stripComments(home)` 上（变量名 `homeCode`），**不是裸 `home`** ——
> 新注释里故意写了 `posterDirections.map(...)` 和 `.filter(`，拿裸源码判会被自己的注释命中。

| 判据 | 守什么 |
|---|---|
| `assert.match(homeCode, /CAROUSEL_POSTER_IDS/)` | 白名单必须存在 |
| `assert.doesNotMatch(homeCode, /const posterCards: Card\[\] = posterDirections\.map\(/)` | 不许退回全量并入（**王发现的那个 bug 本身**） |
| `assert.match(homeCode, /posterDirections[\s\S]{0,200}?\.filter\([\s\S]{0,120}?CAROUSEL_POSTER_IDS/)` | 必须「经白名单过滤后才 map」 |
| `UNREQUESTED_POSTER_IDS` 逐个 `assert.ok(!allowlistIds.includes(id))` | 王点名的 5 张不许再进白名单 |
| `assert.deepEqual(allowlistIds, ['food-type'], …)` | 白名单内容钉死 |
| `assert.doesNotMatch(tps, /\{\s*id:\s*'phone-candid'/)` | 模板表里不许有该条目（锚**条目形态**，不是裸子串） |
| `assert.doesNotMatch(tps, /import\s+\w+\s+from\s+'@\/assets\/poster-phone-candid/)` | import 不许加回来（import 在，图就会被 emit） |

> 🔴 **一个刻意的顺序**：`UNREQUESTED_POSTER_IDS` 那组循环**放在 `deepEqual` 之前**。
> 两条都会拦「白名单里多了 `phone-candid`」，但 `deepEqual` 只打印一个数组 diff，
> 而那组循环会直接说「这 5 张是王指出没要求设计的那批」——
> 下一个人看到哪条，决定他是「去改判据」还是「知道自己加错了」。

### 3.2 产物级 · `scripts/check-poster-directions.mjs`（新增 1 条）

```
✓ 首页轮播白名单里的 1 个 id 都是真方向
```

为什么必须有这条：白名单里**拼错一个字母同样是静默失败** ——
`.filter((t) => IDS.includes(t.id))` 匹配不到任何方向 ⇒ 那张卡**静默消失**，首页看着完全正常、别的门禁全绿。和已有的 `POSTER_PIN_ID` 那条是同一类坑。

### 3.3 产物级 · `scripts/verify-dist.mjs`（新增 3 条 → 共 **60** 项）

**① 白名单结构（must）** —— 锚**编译后的形状**，不锚标识符：

```
dist/pages/home/index.js 实测（minify 后）：
  g=["food-type"],k=p.W1.filter(function(e){return g.includes(e.id)}).map(function(e){…})
                   ↑ 白名单数组              ↑ 经 includes 过滤后才 map
```

```js
const carouselAllowlistFilter = /\.filter\(function\(\w+\)\{return \w+\.includes\(\w+\.id\)\}\)\.map\(/.test(homeCode)
const carouselAllowlistLiteral = /\[["']food-type["']\]/.test(homeCode)
must('首页轮播的海报卡经「白名单过滤」而非「全量并入」', carouselAllowlistFilter && carouselAllowlistLiteral, …)
```

> ⚠️ 别锚 `p.W1` / `g` / `k` —— 压缩器产物，改个版本就变。锚「先 `filter(includes(id))` 再 `map`」这个**结构**。

**② 「手机直出」已从整个产物里清除（must）** —— 扫**全 `dist`**（`collectDist`，`\.(js|wxss|json|wxml)$`），
断言 `phone-candid` 与 `\u624b\u673a\u76f4\u51fa` 两种形态**一处都没有**。

> 为什么扫全 `dist` 而不是只扫首页 bundle：这个方向是从**模板表**里删的，而模板表编译进 **`common.js`**（不是 `pages/home/index.js`）。只扫首页会**漏**。

**③ 封面不再打包（must）** —— `emittedAssets.filter(f => /^poster-phone-candid\b/.test(f))` 必须为空。

> 为什么单独一条：**只要 `import` 在，图就会被 emit，哪怕没人用。** 只删条目不删 import = 白删，白占 112.3 KB。

---

## 4. 对抗测试：14/14 通过

脚本：`_diag/adversarial-carousel-allowlist.py`（Python 驱动，因为本环境 Node 的 `execFileSync` 会 **EBUSY**，会把「起不来」误判成「拦下了」）。

**3 个控制组**（不改任何东西 → 必须**全绿**）：
源码级 `test-creator-ui`、产物级 `verify-dist`、`check-poster-directions`。

**6 个源码级变异**（改源码 → 必须变红，且**必须指出是哪条判据拦的**）：

| 用例 | 期望红 | 实际 |
|---|---|---|
| S1 白名单清空为 `[]` | ✓ | ✓ 源码级 |
| S2 删掉白名单过滤（退回全量 `map`） | ✓ | ✓ 源码级 + 产物级 |
| S3 白名单塞回 `phone-candid` | ✓ | ✓ 源码级（指名道姓那条） |
| S4 白名单写错成不存在的方向 | ✓ | ✓ 源码级 **+ `check:poster-directions`**（这条正是为此而加） |
| S5 把 `phone-candid` 条目加回模板表 | ✓ | ✓ 源码级 + 产物级 |
| S6 把 `phone-candid` 的 import 加回来 | ✓ | ✓ 源码级 + 产物级（封面又被打包） |

**4 个产物级变异**（只改 `dist/`，不改源码 → 必须变红）：

| 用例 | 期望红 | 实际 |
|---|---|---|
| A1 把产物里的白名单字面量改成别的方向 | ✓ | ✓ |
| A2 把产物里的白名单过滤删掉（退回全量） | ✓ | ✓ |
| A3 把 `phone-candid` 塞回 `common.js` | ✓ | ✓ |
| A4 把 `poster-phone-candid.jpg` 塞回 `dist/assets` | ✓ | ✓ |

**恢复**：4 个文件按 **SHA-256 逐字节**比对恢复，恢复后重跑得 `(60, 0, 0)`。

### 4.1 写这个脚本时踩的两个自伤坑（已记入记忆）

1. **`restore()` 方向写反了**：`shutil.copy2(p, BAK[p])` 把**变异后的文件**写进了备份
   ⇒ 每个用例都在覆盖自己的备份，最后源码被留在「白名单 = `[]` + filter 行已删」的**坏状态**。
   正确方向是 `copy2(BAK[p], p)`。已加 `try/finally` 兜底：**无论成败都恢复，并删掉 `.advbak`**。
   （两个 `.advbak` 落在 `dist/` 里，不删会**混进包体**。）
2. **`git show` 从子目录取 blob 要加 `./`**：仓库根在 `wo/`，不是 `forme-taro/`
   ⇒ `git show HEAD:src/assets/x.jpg` 失败（exit 128，stdout 有 234 字节错误、**文件 0 字节**），
   必须写 `git show HEAD:./src/assets/x.jpg`。

---

## 5. 完整发布链结果（前台跑，`_diag/release.log`，EXIT=0）

| 步骤 | 结果 |
|---|---|
| `typecheck` | exit 0 |
| `check:request-key` | **15 项全部通过** |
| `check:no-pixel` | 通过（判据自测 3 拦 6 放） |
| `check:prompt-mirror` | **34 个模板** · 16 字段一致 · 判据自测 14 样本 |
| `check:asset-filters` | 通过 · 命中数 `自由生图=2 海报=15 产品=14 头像=2 灵感复刻=3` |
| `test:creator-ui` | `creator UI behavior checks passed` |
| `test:reference-images` | passed |
| `test:reference-recreate` | passed |
| `test:product-studio` | passed |
| `build:weapp` | `Compiled successfully in 10.47s` |
| `verify:dist` | **60 项通过 · 0 项提醒 · 0 项阻断** |
| `check:poster-directions` | 通过 · **全部 15 个方向** · 白名单 1 个 id 都是真方向 |

> ⚠️ 跑 `npm run release` **必须放前台**。丢后台会卡在 `taro build`（`dist/app.json` 根本不生成）。
> 另有一次沙箱 `taro build` 死于 `[safe-delete][SAFE_DELETE_BULK_GUARD_ERROR] approve failed: state lock timeout`
> （exit 1 / SIGTERM），留下一个**骗人的 `dist/`**：根文件 + `pages/*` 都在，但**没有 `app.json` / `app.wxss` / `assets/`**。
> 重跑同一条命令即成功。**看 `dist` 一定要看 `app.json` 在不在。**

---

## 6. 包体

| | 改前 | 改后 | 变化 |
|---|---|---|---|
| `dist` 文件数 | — | 74 | — |
| `dist` 总字节 | 1,833,255 | **1,717,239** | **−164,016 B** |
| 2 MB 上限余量 | 257.7 KB | **371.0 KB** | +113.3 KB |
| 占比 | — | 81.88% | — |

> 省下 164 KB **多于**封面本身的 112.3 KB —— 因为删掉的不只是封面，还有编译进 `common.js` 的条目 JS 等。跟王口头报的 112.3 KB 是「只算封面」的估计。

> ⚠️ **但「撤掉 4 张轮播卡」本身不省包体**：那 4 张的封面（纸域微景 33.0 KB / 浅景分离 51.2 KB / 俯拍平铺 114.5 KB / 异变主体 40.0 KB）**仍然被打包**，因为 `create-poster` 页拿它们当预览图和下拉来源。**撤卡 ≠ 省字节。**

---

## 7. 未验证（每次都要说清楚）

- 🔴 **没有 `LLM_API_KEY`** ⇒ 真出图一次都没跑过。本次改动**不涉及出图链路**，但整条链路的「真能出图」依然**未验证**。
- 🔴 **没有真机 / 模拟器截图** ⇒ 首页轮播现在长什么样（13 张卡、顺序、白字对比度）**只有断言，没有眼睛看过**。
  - 已知并已修：轮播卡白字对比度（`18/18 全部过 AA`）。
- 「撤掉 5 张」的**视觉后果**（轮播变短、滑到底更快）没人看过。

---

## 8. 遗留 / 等王定

1. **设计真源里那张 1.09 MB PNG**：`work/visual-studio/public/assets/poster-phone-candid.png` 已无人引用。不在小程序包里，删不删不影响包体 —— **没动，等王定**。
2. **`jev-probe.mjs` 的 `PAGES.gallery`** 还写着「从 **24** 个预设模板里挑一个套用」，而产品工作室渲染的是 **14** 个 —— 指代不明，等王定。
3. **`create-product` 的 `AppHeader` 标题**目前是「产品替换」，是否要改 —— 等王定。
4. **小程序页与设计原型的默认页面文案**没有门禁守一致性（刻意的重复）。
5. **剩下 4 张无记录的海报方向仍然可选**：它们在「海报」页里，点「选择方式 → 海报」一步就能看到。本次只是**撤了首页轮播**，**没删模板库**（王说「只删「手机直出」」）。

---

## 9. 撤回（Retraction）

**本次无撤回。** 上一份交接（`2026-09-26-home-composer-reference.md` §10）里撤回的
「`editImages` 让最后一张成为图一」那条，与本次无关，此处只作索引。

> 记一条本次**新确认**的事：基线提交 `3d98804 Baseline FORME workspace with payment and data safety fixes` 是仓库里**唯一**的提交
> ⇒ **git 回答不了「这个方向是谁、什么时候加的」**。这就是为什么「查来源」只能靠交接文档 / 记忆 / 代码注释三处人工比对。

---

## 10. 下一步

- [ ] 王决定设计真源那张 1.09 MB PNG 的去留（§8.1）
- [ ] 真机跑一次首页，**看一眼** 13 张轮播卡（补上 §7 的「没眼睛看过」）
- [ ] 上一条链路的遗留项：`LLM_API_KEY`（真出图）、4 个 MP 后台域名白名单、《用户隐私保护指引》、4 个道具发布、消息推送、苹果支付开关、体验版、真机支付/退款、提审 → 发布
