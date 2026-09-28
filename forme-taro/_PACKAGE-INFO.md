# 这个压缩包里是什么

`forme-taro/` —— **FORMÉ 微信小程序**（Taro 4.2.1 + React + TS + Sass），14 个页面。
打包时间：2026-09-27 14:00:37｜范围：**只要代码**（不含 node_modules / 证据截图 / 本地产物）

## 目录

| 路径 | 是什么 |
|---|---|
| `forme-taro/src/` | **源码**（页面、组件、服务、数据、样式） |
| `forme-taro/dist/` | **构建产物 —— 这个才是上传给微信的包**（74 个文件 / 1,737,314 B） |
| `forme-taro/docs/` | 交接文档与 UI 优化方案（`docs/handoffs/*.md` 是**主知识库**） |
| `forme-taro/scripts/` | 门禁脚本（`release` 链的 12 步都在这里） |
| `forme-taro/config/`、`types/` | 构建配置与类型声明 |
| `forme-taro/.env.development` / `.env.production` | 编译期注入的环境变量（**只有公开配置，无密钥**） |
| `forme-taro/project.config.json` | 开发者工具项目配置（`miniprogramRoot: "dist/"`） |

## 怎么跑起来

```bash
cd forme-taro
npm install                 # ← 包里没有 node_modules，必须先装（约 2.26 GB）
npm run dev:weapp           # 编译到 dist/ 并 watch
npm run release             # 完整发布链（12 步门禁 + 构建）
```

⚠️ **`npm run release` 必须前台跑，且重定向到文件**：
丢后台、或走 `| grep | tail` 管道，都会卡在 `taro build`（`dist/app.json` 根本不生成）。
正确写法：

```bash
npm run release > _diag/release.log 2>&1; echo "EXIT=$?"
```

⚠️ **沙箱 / 受限环境下 `taro build` 可能留下「假 dist」**：根文件和 `pages/*` 都在，
但**没有 `app.json` / `app.wxss` / `assets/`**。
⇒ **看 `dist` 的第一件事是确认 `app.json` 在不在**；重跑同一条命令即好。

⚠️ **用微信开发者工具打开时要选 `forme-taro` 源码目录，不是 `dist`**
（`project.config.json` 里 `miniprogramRoot: "dist/"`，工具自己会去读 dist）。

## 包里**没有**什么（有意不带）

| 没包含 | 体积 | 怎么补 / 要不要 |
|---|---|---|
| `node_modules/` | 2,255.7 MB / 270,374 文件 | `npm install` 重建 |
| `_diag/` | 15.4 MB | 证据截图与审计脚本（P1-1 的改前改后对比图在这里）。**要的话单独找** |
| `output/imagegen/` | 10.5 MB | 出图工具的历史图片，可弃 |
| `ui-preview/` | 1.9 MB | UI 改前改后截图，可弃 |
| `.swc/`、`.cache/` | — | 构建缓存 |

## 安全

**本包不含任何密钥。** `forme-taro` 里没有 `.env.local`；
两个 `.env.*` 只有 `TARO_APP_API_BASE` / `TARO_APP_USE_MOCK` /
`TARO_APP_MEDIA_BASE` / `TARO_APP_FONT_BASE` 四个公开配置项。

（真凭据在 `forme-server/.env.local` 与仓库根 `.env.local` —— **都不在这个包里**。）

## 拿到后怎么验证

```bash
cd forme-taro
npm install
npm run release            # 期望 EXIT=0，verify:dist 70 项通过 · 0 提醒 · 0 阻断
```

期望的包体：**74 个文件 / 1,737,314 B / 82.84% / 余量 351.4 KB**（微信主包上限 2 MB）。

想读现状与坑，先看仓库根的 `HANDOFF.md`（**不在本包内**）与
`forme-taro/docs/handoffs/*.md`（**在**）。
