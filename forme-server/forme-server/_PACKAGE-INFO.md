# 这个压缩包里是什么

`forme-server/` —— **FORMÉ 微信小程序后端**（零依赖 Node，Node >= 20），监听 `127.0.0.1:8787`。
打包时间：2026-09-27（第二版，替代 `forme-server-2026-09-27-no-gift.tar.gz`）

## 本次变更（2026-09-27）

1. **取消「注册送 1 点」**：`INITIAL_BALANCE` 默认值从 `1` 改回 `0`。
新用户注册后余额为 0，无点数时出图返回 402。冒烟测试第 25 节已反转断言
（278 项全绿）。`.env.example` / `deploy/.env.production.example` /
`API.md` / `DEPLOY.md` 已同步；`README.md` 本来就是 0，无需改。
2. **新增 ¥15 充值档位**：`points-15`，1500 分 / 13 点 / 一次性到账。
点数按既有换算比例设计：10000 分档给 88 点（113.6 分/点，预留 12% 渠道费后
向下取整），1500 × 0.88 = 1320 → 13 点。服务端目录与冒烟断言已同步
（上架 2 个有效期道具 + 3 个点数档，278 项全绿）。

## ✅ 本包不含任何真实凭据

- 包里**没有**根目录 `.env.local`（真实的那个留在了打包机上，没有打进来）。
- 包里唯一的 env 模板是 `deploy/.env.local.ready`（凭据项全空）。
- ⇒ 这个包可以放心存档 / 传给协作者，**不含密钥**。
- ⚠️ 部署到服务器时：**不要覆盖服务器上现有的真实 `.env.local`**，
直接保留它；包里没有带，你也不需要从包里找。

⚠️ **微信小程序后台还有一步要做**：新档位 `points-15` 需要在
里新建一个道具，
`productId` = `forme_points_15_once`，`goodsPrice` = `1500`（分），
必须与服务端 `src/catalog.mjs` 里的一字不差，否则支付会失败。
建好之前，先不要在前端上架这一档（目前前端 mock 和服务端都已包含该档位）。

## 目录

| 路径 | 是什么 |
|---|---|
| `src/` | **服务源码**：路由 / 支付 / 图片 / 存储 / 限流 / 微信 / 告警 |
| `scripts/` | 门禁与自检：`preflight`（部署前 24 项）、`smoke`、`check:*` 七项 |
| `deploy/` | **部署配置**：Dockerfile、docker-compose、nginx.conf、systemd unit、备份与诊断脚本 |
| `deploy/media/` | 21 张封面图（nginx 从 `/opt/forme/media/` 提供 `/media/`） |
| `API.md` / `DEPLOY.md` / `README.md` | 接口文档 / 部署文档 / 说明 |
| `package.json` | **零依赖** —— 没有 `dependencies`，不用 `npm install` |

## 怎么跑起来

```bash
cd forme-server
node -v # 需要 >= 20
npm run init:data # ← 必须第一步：包里**没有** data/，这条会建一个空库
npm start # 监听 127.0.0.1:8787
curl http://127.0.0.1:8787/api/health
```

⚠️ **`npm run init:data` 的语义**：它**拒绝在非空数据目录上运行**（防覆盖已有账户）。
所以它是「首次初始化」，不是「重置」。想重置得先手动清空 `data/`。

⚠️ **不需要 `npm install`** —— 本项目零依赖（`package.json` 里没有 `dependencies` / `devDependencies`）。

## 包里**没有**什么（有意不带）

| 没包含 | 怎么补 |
|---|---|
| `.env.local`（真实凭据） | **保留服务器上现有的**，不要从包里找 |
| `data/` | 王选「排除」—— 里面有真实用户数据。用 `npm run init:data` 建空库 |
| `node_modules/` | 零依赖，不需要 |
| `_diag/` | 打包用的校验脚本，不属于工程 |

⚠️ 排除 `data/` 意味着：**解压后是一个「没有账户、没有余额、没有订单」的空后端**。
这正是想要的（拿到代码而不是拿到别人的数据）。要连真库，从线上服务器 rsync `data/`。

## 部署

`deploy/DEPLOY.md` 与 `deploy/` 下的配置齐全（Dockerfile / nginx / systemd / 备份 / 诊断）。
线上现状：`pixeltoy.cn`（`101.42.111.251`，ubuntu），nginx 反代 8787。

⚠️ 部署前先跑门禁，期望 **24 通过 · 2 警告 · 0 阻断**：

```bash
cd forme-server
npm run preflight
```

## 拿到后怎么验证

```bash
cd forme-server
npm run preflight # 期望 24 通过 · 2 警告 · 0 阻断
npm run check # 七项 check + smoke（278 项）
curl http://127.0.0.1:8787/api/health # 应看到 initialBalance:0
curl http://127.0.0.1:8787/api/catalog # 应看到 5 个档位（含 points-15）
```

## 现状与坑

- 后端**没有版本控制历史**可用（仓库根 `wo/` 只有一次 baseline 提交，且工作区有大量未提交改动）
⇒ 想知道「这个文件为什么长这样」，看 `DEPLOY.md` 与 `deploy/*.md`，不要指望 `git log`。
- **环境里没有 `LLM_API_KEY` 就真出图不了** —— 本包不带任何凭据，
部署时确认服务器 `.env.local` 里 `LLM_API_KEY` 还在。
