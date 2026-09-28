# 门禁与文档审计（2026-09-23）

> 执行人：阿查｜起因：接手 FORMÉ 后，交接文件 §2.3 与 §5 反复强调「**源码写了 ≠ 打进包了**」
> 和「**真门禁没挂链，UI 回退一路没人拦**」。这一轮就是把这两句话变成可核对的数字。
>
> **一句话结果：15 个对抗测试全部通过、全部还原干净 —— release 链上的门禁被证明「改坏了真的会响」。
> 另外修掉 README 里 3 处过时声明 + 1 处会误导上线判断的表述。**

---

## 1. 对抗测试：15/15 通过（含前置条件说明）

对抗测试 = 「把东西改坏 → 断言门禁真的拦下 → 还原」。**通过了才说明门禁不是装饰品。**

| 对抗测试 | 目标门禁 | 结果 |
|---|---|---|
| `_tools/adversarial-package-size.mjs` | `verify:dist` 主包体积两档阈值（1.90 提醒 / 1.95 阻断） | ✅ 5/5 |
| `_tools/adversarial-poster-dirs.mjs` | `check:poster-directions` | ✅ |
| `_tools/adversarial-prompt-mirror.mjs` | `check:prompt-mirror` | ✅ |
| `_tools/adversarial-product-studio.mjs` | `test:product-studio` | ✅ |
| `_tools/adversarial-reference-recreate.mjs` | `test:reference-recreate` | ✅ |
| `_tools/adversarial-feature-card.mjs` | `verify:dist` 展示卡判据 | ✅ 12 通过 |
| `_tools/adversarial-feature-rail.mjs` | `verify:dist` 展示轨道 / 返回入口 | ✅ 18 通过 |
| `_tools/adversarial-capsule.mjs` | 顶栏胶囊让位 / 令牌 | ✅ 11/11 |
| `_tools/adversarial-theme.mjs` | 深色无条件默认 / 注释陷阱 | ✅ 8 条样本 |
| `_tools/adversarial-ip-logo-cover.py` | IP 形象封面版式判据 | ✅ 8/8 |
| `_diag/adversarial-asset-filters.py` | `check:asset-filters` | ✅ |
| `_diag/adversarial-avatar-headers.py` | 头像页头部门禁 | ✅ 三场景 |
| `_diag/adversarial-mirror.py` | 镜像一致性 | ✅ |
| `_diag/adversarial-cta-parser.py` | 主按钮对比度解析（剥注释 + 源码/产物交叉校验） | ✅ 12/12 |
| `_diag/adversarial-top-strip.mjs` | 顶部条带上色 / 状态栏对比度 | ✅ 全项 |

**还原验证**：每跑完一个都比对全树 sha256 —— 142 个受监控文件**逐字节一致**，一个都没留下改动。

### ⚠️ 三个前置条件（不满足时表现为「失败」，但那不是产品问题）

| 测试 | 前置 | 不满足时的症状 |
|---|---|---|
| `_diag/adversarial-top-strip.mjs` | **先起 `work/visual-studio` 的 dev server**（`npm run dev`，Playwright 从该工程借） | 对照组就红（`check-mature-sample.mjs` 连不上 `localhost:5173`）→ 后面 9 项全部误报 |
| `_diag/adversarial-cta-parser.py` | **Python 需装 `pillow`** | `render-primary-cta.py` 在 `import PIL` 处崩 → 对照组红 |
| `_tools/adversarial-ip-logo-cover.py` | **Python 需装 `numpy`** | 直接 `ModuleNotFoundError` |

> 本机（Windows）裸 `python` 两个包都没有。已装进**隔离的托管 venv**
> （`~/.workbuddy-ai/binaries/python/envs/default`），并用它的解释器重跑通过。
> **注意 `cta-parser` 用 `PY = sys.executable` 调子脚本** ⇒ 必须用同一个解释器启动父脚本，
> 只改 `PATH` 不一定生效。

---

## 2. 一次「判据本身出错」的实录（值得记）

第一轮跑完，有三个测试报「**源码树被改动 284 行差异**」—— 而它们自己都说「改动均已还原」。
两句话不可能同时为真。查下去发现**是我的比对工具错了**：

- 第一次快照：**按目录分段** + 加了 `sed 's|^|  |'` 缩进
- 跑测器里的快照：**全局一次 `find` 再排序** + 无缩进

⇒ 每一行都因**前导空格 + 排序口径**不同，142 行全部「不同」，报出 142+142 = 284 行假差异。
**差点把「对抗测试不还原」这个严重结论报出去。**

修复方式：快照与比对**共用同一个实现**（`_stage/snapshot-tree.sh`），并先做「假破坏自检」
（什么都不改，两次快照必须逐字节相同）再投入使用。

> 还有一个次级坑：`sha256sum` 输出是 `<hash> *<file>`，**直接 `sort` 会按哈希排而不是按文件名**。
> 比对前必须先归一化成「文件名 + 哈希」再排。

**教训（与项目铁律 #2 同源）：判据本身要先自检。一个错的判据比没有判据更危险 —— 它会让你自信地报错。**

---

## 3. README 的 4 处修正（文档说的 ≠ 实际做的）

| # | 位置 | 原文 | 实际 | 处理 |
|---|---|---|---|---|
| 1 | 页面清单 | 列了 **8** 个页面 | `app.config.ts` 有 **14** 个 | 补全 6 行（create-reference / create-product-shot / create-marketplace / avatar-gallery / create-avatar / profile） |
| 2 | home 行 | 「**10** 种海报方向」 | `posterDirections` 实际 **16** 种 | 改成 16（数字从唯一真源现算） |
| 3 | 底部导航 | 「「灵感」「我的」两个入口目前是 Toast 占位——原型里也没有对应页面」 | 小程序里**只有 `创作` / `资产` 两项**；原型 `Prototype.tsx` 里**有**四项，其中「灵感」「我的」是**没有 `onClick` 的死按钮**；且 `pages/profile/index` 已实现 | 整段重写 |
| 4 | 还没做的部分 #5 | 「`SECURITY_MODE` …目前是 `log`，上线前要改成 `enforce`」 | 线上实测 `securityMode: "enforce"`，**已经是 enforce** | 加警告说明（详见下） |

### 第 4 条为什么危险

这句话**作为「代码默认值」是对的**（`src/config.mjs` 的 `read('SECURITY_MODE','log')` 与 `.env.example` 确实都是 `log`），
**错在它暗示的部署状态**：`deploy/.env.local.ready` 与 `.env.production.example` 都写着 `enforce`，
`DEPLOY.md` 明说生产环境 `SECURITY_MODE=log` **服务直接拒绝启动**，而线上实测就是 `enforce`。
⇒ 照着这句话去「上线前改一下」，会白跑一趟，还可能把已正确的生产配置改坏。

### 顺带更正一处措辞

「还没做的部分 #2 远程封面域名」原本结尾是「**这一步只改 `TARO_APP_MEDIA_BASE`**」——
已改为记录真实状态：服务器与构建侧**已完成**（`check:media` 21/21），
**剩下的是把 `pixeltoy.cn` 加进 `downloadFile` 合法域名**。

### 一条防呆说明

产物 `dist/common.js` 里**仍有 23 处 `images.unsplash.com` 字面量**，那是 `media()` 的**实参**、
运行时不会被请求（`verify-dist.mjs` 有注释说明这是刻意的，第一版按字面量判断是假阳性）。
已在 README 里写明，**免得下次有人看到它又当成「没收口」去返工**。

---

## 4. 复核结论（本机实测）

| 项 | 值 |
|---|---|
| `npm run release` | **exit 0** |
| `verify:dist` | **53 项通过 · 0 项提醒 · 0 项阻断** |
| `dist` 字节数 | **1,813,934**（对抗测试跑完仍逐字节一致） |
| `dist` 文件数 | 76 |
| 受监控源码文件 | 142 个，跑完 15 个对抗测试后**哈希全同** |

---

## 5. 仍未做 / 建议

- **建议把上面 3 个前置条件写进各测试的头部注释**（目前只有 `check-mature-sample.mjs` 写了「先 npm run dev」，
  而调用它的 `adversarial-top-strip.mjs` 没写）—— 否则下一个人会重新踩一遍「对照组就红」。
- **`_tools/` 是交接文件里标注的「非交付物」目录**，而 release 链上的门禁测试有一半住在那里。
  本轮**没有**把它们移进 `forme-taro/scripts/`，也**没有**改 `release` 链 —— 这是待定项，等王定。
  （对抗测试跑一轮约 70 秒 + dev server 依赖，**不适合**放进 `release`；加一个 `check:adversarial` 之类的独立入口更合适。）
- `forme-server/scripts/jev-probe.mjs` 没挂在任何 npm script 上（同批里唯一一个）。
