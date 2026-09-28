# `/media/` 封面收口 —— 上线记录（2026-09-23）

> 执行人：阿查｜授权：王（"继续推进项目"）｜服务器：`101.42.111.251`（腾讯云，hostname `VM-0-15-ubuntu`）
> **一句话结果：交接文件第 4 节的唯一阻塞项已解除。① ② ③ 全部完成并逐层验证。**

---

## 0. 这台机器的特殊性（动手前必须先知道）

`pixeltoy.cn` **不是本项目的独占域名** —— 同一台机器上还有 **Pixel Toys** 在服务。

| location | 转发到 | 归属 |
|---|---|---|
| `/api/` | `127.0.0.1:8787` | **forme-server** |
| `/api/auth/`、`/api/canvas/` | `127.0.0.1:4317` | Pixel Toys |
| `/`（改动前，含 `/media/`） | `127.0.0.1:4317` | **Pixel Toys** |

⇒ 所以**没有** `cp deploy/nginx.conf` 覆盖，**只往 `server_name pixeltoy.cn` 的块里追加了一个 location**。

### ✅ 顺带发现的隐患 —— **已于 2026-09-23 处理**

`/etc/nginx/nginx.conf` 第 60 行是 `include /etc/nginx/sites-enabled/*;`（**没有 `*.conf` 过滤**），
而 `sites-enabled/` 里躺着 **3 个 `.bak` 文件**：

```
pixel-toy.before-auth-api-fix-20260922
pixel-toy.before-canvas-api-fix-20260922
pixel-toy.campaign-engine.bak
```

**它们同样被 nginx 解析**，于是 `nginx -t` 刷出 **15 条** `conflicting server name ... ignored`
（改动前就存在，不是本次引入）。

**处理**：先只读证明这 3 个文件的 `location` 是主文件的**真子集**（主文件多出
`/api/auth/`、`/api/canvas/`、`/api/canvas/skills`、`/media/`；**没有一个 `.bak` 有独有路由**），
然后 `mv` 到 `/etc/nginx/backups/`（**移动，不是删除**）→ `nginx -t` 通过 → `reload`。

| 判据 | 处理前 | 处理后 |
|------|-------|-------|
| `sites-enabled/` 文件数 | 4 | **1**（只剩 `pixel-toy`） |
| `conflicting server name` | **15** | **0** |
| `/` | 200 Pixel Toys | **200 Pixel Toys** |
| `/api/__nope__` | 带 `code` 的错误体 | **带 `code` 的错误体** |
| `/media/<真实封面>` | 200 image/jpeg | **200 image/jpeg 218969 B，魔数 `ffd8 ffe0`** |
| `/media/<不存在>` | nginx 自己的 404 | **404 text/html** |
| `/api/canvas/__nope__` | 401 | **401**（Pixel Toys 仍接管） |

回滚：`sudo mv /etc/nginx/backups/pixel-toy.* /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx`

> `sites-available/` 里还有一批 `.bak`（`pixel-toy.bak.*` 等），但**那个目录不被 include**，无害，未动。

### 🔴 更危险的一条：`DEPLOY.md` §6 的安装步骤会**静默夺走域名**

同一次排查发现的**更高危**问题（不只是噪音，是会让线上坏掉）：

仓库里 `deploy/nginx.conf` 的 `location /` 是 **`proxy_pass http://127.0.0.1:8787`**（forme-server），
而 `DEPLOY.md` §6 的「裸机方案」让人：

```bash
sudo cp /opt/forme/deploy/nginx.conf /etc/nginx/sites-available/forme
sudo ln -sf /etc/nginx/sites-available/forme /etc/nginx/sites-enabled/
```

`include` 目录里多个文件声明同一 `server_name` 时，nginx **只用 glob 字典序的第一个** ——
而 **`forme` 排在 `pixel-toy` 前面**（`f` < `p`）。
⇒ 一旦执行这两行，`pixeltoy.cn/` 会从 **Pixel Toys(4317)** 变成 **forme-server(8787)**，
**首页直接坏掉，而且不报错**。

**对抗测试（真机，用临时目录模拟）**：

```
=== 判定逻辑（把 /etc/nginx/sites-enabled 换成 /tmp/tmp.xxx）===
  🔴 2 个文件都声明了 pixeltoy.cn —— 字典序第一个赢，其余被静默忽略：
       /tmp/tmp.xxx/forme
       /tmp/tmp.xxx/pixel-toy

=== 字典序验证：谁赢？ ===
   赢家 = forme          ← 隐患确认为真
```

**已做的修**：
1. `DEPLOY.md` §6 的代码块前加了 ⚠️ 警示，并新增 **§6.1「同一台机器上已经有别的站时」**
   说明两条 include 陷阱、给出「改现有文件、不要新增文件」的正确流程与回滚方式。
2. `deploy/diag-media.sh` 第 1 节从「罗列 server_name」升级为**会报警的判据**：
   统计有多少个文件声明了该域名，>1 就 🔴；并打印 `nginx -t` 的 `conflicting server name` 条数。
   （实测：清理后输出 `✅ 只有 1 个文件声明该域名` / `✅ conflicting server name 条数：0`）

---

## 1. 改动清单（最小化）

| 项 | 内容 |
|---|---|
| 备份 | `/home/ubuntu/nginx-pixel-toy.bak.20260923-171101`（4159 B） |
| 备份位置 | ⚠️ 特意放 `~` 而**不是** `sites-enabled/` —— 放那里会被 nginx 解析，又制造一组冲突 |
| 改动的文件 | `/etc/nginx/sites-enabled/pixel-toy`，**纯新增 13 行，零删除**（4159 → 4762 B） |
| 新增内容 | `location /media/ { alias /opt/forme/media/; default_type image/jpeg; autoindex off; expires 30d; add_header Cache-Control "public, max-age=2592000"; }` |
| 插入位置 | `location / {` 之前（该 server 块内） |
| 新建目录 | `/opt/forme/media/`（`ubuntu:ubuntu`，755） |
| 上传文件 | 21 个封面，`tar` 管道（本机无 `rsync`） |
| 回滚方式 | `sudo cp -a /home/ubuntu/nginx-pixel-toy.bak.20260923-171101 /etc/nginx/sites-enabled/pixel-toy && sudo nginx -t && sudo systemctl reload nginx` |

### 为什么 `default_type image/jpeg` 不能省

产出文件名**没有扩展名**（`photo-1549490349-8643362247b5`），nginx 无法从后缀推断类型。
不写这一行会发 `application/octet-stream` —— 表现同样是**封面空白**，而且不报错。

---

## 2. 验证阶梯（每一层能定位到「问题在哪一层」）

判据来自交接文件 §2.2：**forme-server 的错误体一定带 `code` 字段**。

| # | 检查 | 改动前 | 改动后 |
|---|---|---|---|
| 1 | `GET /media/<不存在的文件>` | `{"ok":false,"message":"not found"}`（**别家**的应用，无 `code`） | **nginx 自己的 HTML 404** ⇒ location 已生效 |
| 2 | `GET /media/photo-1549490349-8643362247b5` | 404 | **200**、`Content-Type: image/jpeg`、`Content-Length: 218969`（与本地一致）、字节 `ffd8 ffe0 … JFIF` |
| 3 | `npm run check:media` | **0/21** | **21/21 通过 · 0 问题** |
| 4 | `GET /api/__nope__` | 带 `code` 的 JSON | 带 `code` 的 JSON（未变 ⇒ `/api/` 没被影响） |
| 5 | `GET /`（Pixel Toys） | 200 `<title>Pixel Toys</title>` | 200 `<title>Pixel Toys</title>`（**未踩坏**） |

### 传输完整性

21 个文件 **sha256 逐一相同**（本地 ↔ 远程）。

> ⚠️ 坑：Git Bash 的 `sha256sum` 输出 `<hash> *<file>`，Linux 是 `<hash>  <file>`。
> 直接 `diff` 会**全部行不同** —— 那是假信号。要先把分隔符规范化再比。

### 第 ③ 步（填 env）之后的产物级验证

| 检查 | 结果 |
|---|---|
| `npm run release` | **exit 0** |
| `verify:dist` | **53 项通过 · 0 项提醒 · 0 项阻断**（改动前 52 通过 · **1 提醒** —— 那条提醒就是 `images.unsplash.com` 未收口） |
| 产物里编译后的 `mediaBase` | `"https://pixeltoy.cn/media"`，与 `.env.production` **同源且非空** |
| 运行时实际请求的封面 | **21 个**文件名全部拼成 `https://pixeltoy.cn/media/<file>` |
| `dist` 里还有 23 处 unsplash 字面量？ | 有，但它们是 `(0,r.$)("https://images.unsplash.com/…")` 的**实参**，`media()` 运行时只取文件名 ⇒ **永不被请求**（门禁注释里已说明这是刻意的） |
| 主包体积 | 1,813,934 B = 1.730 MB（与改动前 1,813,909 B 基本一致） |
| `find src -newer dist/app.json` | **0**（交接文件 §5 #6 的不变量） |

### 判据自检（防「恒真的装饰品」）

`verify:dist` 的「远程图片域名已收口」在配了 `mediaBase` 后**恒真**，所以另有「同源」判据兜底。
对这条判据做了假破坏自检：

| 破坏 | 判据 |
|---|---|
| 原始产物（假破坏：什么都不改） | ✅ 绿 |
| `mediaBase` 被清空（env 没被构建读到） | ✅ 红 |
| 键名敲错成 `mediaBse`（DefinePlugin 认不出） | ✅ 红 |
| 值被换成别的域名 | ✅ 红 |

---

## 3. 🔴 仍未完成（**别当成已验过**）

| 项 | 说明 |
|---|---|
| **`downloadFile` 合法域名** | `pixeltoy.cn` 必须加进小程序后台。**真机关调试模式**时未配白名单 ⇒ **封面依旧全空白**，而开发者工具勾着「不校验合法域名」照样正常 —— 很容易被当成样式 bug 查半天 |
| **真机从未验过** | 封面是否真的显示、胶囊让位、隐私授权弹窗 |
| 其余 §10 配置 | 4 个服务器域名 / 隐私指引 / 虚拟支付 + 4 个道具 / 消息推送 / 小程序简称 |
| 真机端到端 | 虚拟支付模拟器不支持，只能真机：付一笔 + 退一笔 |

---

## 4. 复现用的脚本

| 脚本 | 用途 |
|---|---|
| `forme-server/deploy/diag-media.sh` | **只读**诊断：该往哪个文件加、目录在不在（仓库原有） |
| `_stage/patch-nginx-media.py` | 带断言的补丁器：幂等护栏 + 锚点唯一性 + 长度增量断言 + 原子落盘；4 项对抗测试全拦住且**失败不产出文件** |
| `_stage/verify-media-base.mjs` | 独立验证产物 `mediaBase` 与 env 同源，并算出运行时真实请求地址 |
| `_stage/falsify-media-base.mjs` | 假破坏自检：证明那条判据不是恒真装饰品 |

---

## 3. 模特试穿预设图部署（2026-09-28 待执行）

> 背景：这台虚拟机直连服务器的 SSH 被出口代理掐了（22 端口能通，握手即被关），
> 且密钥不在本机 —— 09-23 那次是王的电脑传的。所以这次只能把文件摆好，
> 等下次服务端部署（¥15 道具上架那次）时一起传。
>
> 2026-09-28 15:00 更新：缩略图改成本地打包进小程序（`src/assets/tryon-models/`，
> 8 张共 57KB），不再走 CDN —— 远程 404 在深色主题下是黑块，已踩过坑。
> 所以**只需要传 8 张原图 PNG**。

| 文件 | 本地位置 | 服务器目标 | 用途 |
|---|---|---|---|
| `model-01.png` … `model-08.png` | `deploy/preset-models/` | 解包目录下的 `preset-models/`（与 `config.presetDir` 默认一致） | 服务端 `preset:model-0X` 本地直读 |

部署命令（在有 SSH 的机器上）：
```bash
# 预设原图 → 服务端解包目录（示例：/opt/forme/forme-server/preset-models/，以实际解包路径为准）
tar -czf preset-models.tar.gz -C deploy preset-models
scp preset-models.tar.gz ubuntu@pixeltoy.cn:/tmp/ && ssh ubuntu@pixeltoy.cn \
  "tar -xzf /tmp/preset-models.tar.gz -C /opt/forme/forme-server/"
```
