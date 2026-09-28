# Pixel Box 服务端部署手册

> **现网实例记录（2026-09-24）：** 当前服务器使用 PM2，工作目录为
> `/home/ubuntu/apps/forme-server`，进程名 `forme-server`，监听 `127.0.0.1:8787`。
> 本文件下面的 `/opt/forme` systemd 示例适用于新机器；维护现网时以该实例记录和
> `/home/ubuntu/forme-backups/` 下的备份为准。不要对 `pixel-toy` 或 `pixel-writer` 进程执行重启。

从一台空服务器到小程序可上线的完整步骤。

> 服务端是**零依赖**的（只用 Node 内置模块，没有 npm install），
> 所以部署非常简单：装 Node、传代码、配环境变量、起进程。

---

## 0. 开始之前

### 关键路径

上线时间线由**两件事**决定，都不在写代码上：

| 事项 | 谁做 | 耗时 | 备注 |
| --- | --- | --- | --- |
| 域名 ICP 备案 | 你 | 2–4 周 | 微信要求 request 合法域名必须已备案 |
| 虚拟支付开通 + 道具配置 | 你 | 1–3 天 | 需要 MP 后台人工配置 |

**如果这两项还没完成，先把它们启动起来**，否则后面所有工作都要等。

### 需要准备

- [ ] 一台服务器（1 核 1G 起，这个服务很轻）
- [ ] 一个已备案域名，例如 `api.example.com`
- [ ] Node.js **20 或更高**（推荐 22）
- [ ] 小程序 AppID：`wxf595b8865bcbf254`
- [ ] 小程序 AppSecret（MP 后台 → 开发管理 → 开发设置）
- [ ] 虚拟支付 OfferID + 现网 AppKey（MP 后台 → 虚拟支付 → 基本配置）
- [ ] 图片模型上游的 API Key 与接口地址

### 架构

```
小程序  ──HTTPS──▶  nginx(443)  ──HTTP──▶  forme-server(127.0.0.1:8787)
                      证书/限流/日志              业务/扣费/虚拟支付
                                                        │
                                                        ▼
                                                  data/state.json
                                                  data/uploads/
```

`data/` 里存着**全部用户、点数余额、订单与退款记录**。
必须挂持久卷 —— 丢了等于用户余额和已支付订单全部归零。

---

## 1. 装 Node

```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证（必须 >= 20）
node -v
```

CentOS / 阿里云 Linux 用 `dnf module install nodejs:22`。

---

## 2. 建用户与目录

```bash
# 专用非 root 账号。服务要解析用户上传的图片，
# 一旦被攻破，root 权限意味着整台机器失守。
sudo useradd -r -s /usr/sbin/nologin -d /opt/forme forme
sudo mkdir -p /opt/forme
sudo chown -R forme:forme /opt/forme
```

---

## 3. 上传代码

只需要 `forme-server` 这一个目录（小程序端不部署到服务器）。

```bash
# 在本地打包
cd /path/to/wo
tar --exclude='forme-server/data' --exclude='forme-server/.env.local' \
    -czf forme-server.tar.gz forme-server

# 传到服务器
scp forme-server.tar.gz user@你的服务器:/tmp/

# 在服务器上解包
sudo tar -xzf /tmp/forme-server.tar.gz -C /opt/forme --strip-components=1
sudo chown -R forme:forme /opt/forme
```

> **不要**把本地开发用的 `data/` 传上去。里面有测试账号和测试订单，
> 会把线上数据搞脏。上面的 `--exclude` 已经排除了。

---

## 4. 配置

```bash
cd /opt/forme
sudo -u forme cp deploy/.env.production.example .env.local
sudo -u forme chmod 600 .env.local     # 里面全是密钥
sudo -u forme nano .env.local
```

逐项填好，重点这几项：

| 变量 | 说明 |
| --- | --- |
| `HOST` | **保持 `127.0.0.1`**。绑 0.0.0.0 会让限流被伪造 IP 绕过（服务会拒绝启动） |
| `MOCK_WECHAT` / `MOCK_LLM` | 必须 `0`，否则服务拒绝启动 |
| `SECURITY_MODE` | 必须 `enforce`，否则服务拒绝启动 |
| `WECHAT_APP_SECRET` | MP 后台的开发设置里 |
| `WECHAT_OFFER_ID` / `WECHAT_APP_KEY` | 虚拟支付基本配置，用**现网** AppKey |
| `WECHAT_PAY_NOTIFY_URL` | `https://pixeltoy.cn/api/pay/notify`，**路径不能少 `/api`** |
| `WECHAT_MSG_TOKEN` | 与 MP 后台【开发管理 → 消息推送】里填的 Token 逐字一致。不一致时后台点保存会报「配置失败」 |
| `LLM_API_KEY` / `LLM_BASE_URL` | 图片上游。`baseUrl` 不带结尾斜杠 |
| `ALERT_WEBHOOK_URL` | 上线前必配；预检会阻断缺失配置，退款异常与缺口须有人接收 |
| `INITIAL_BALANCE` | 新用户初始点数，默认 `0`（不赠送）。调大等于给每个新账号多送产品，等于把上游出图账单敞口留给批量注册 |
| `IMAGE_COST` | 单张图消耗点数，默认 `0.4`。必须是 > 0 的有限数：填 `0` 出图免费，填非法值余额变 `NaN`。**可以是小数**，所以余额与流水都按两位小数记账。改这个值**不需要重新发版**，客户端以 `/api/catalog` 为准 |

`INITIAL_BALANCE` 与 `IMAGE_COST` 都可以在 `/api/health` 上看到当前生效值
（`initialBalance` / `imageCost`），部署完 `curl` 一下就能确认策略真的落地了。

---

## 5. 启动

### 方案 A：systemd（推荐）

零依赖的服务用 systemd 最简单，不需要 Docker。

```bash
sudo cp /opt/forme/deploy/forme-server.service /etc/systemd/system/

# ⚠️ 先按实际路径改这两处
sudo nano /etc/systemd/system/forme-server.service
#   WorkingDirectory=/opt/forme
#   ReadWritePaths=/opt/forme/data

sudo systemctl daemon-reload
sudo systemctl enable --now forme-server

# 看启动日志
journalctl -u forme-server -n 50 --no-pager
```

启动日志应该看到 `✅ 监听 http://127.0.0.1:8787`。
如果看到 `❌` 开头的问题列表，说明 `.env.local` 还没配好，服务会拒绝启动 —— 这是有意的。

### 方案 B：Docker

```bash
cd /opt/forme
sudo docker compose -f deploy/docker-compose.yml up -d --build
sudo docker compose -f deploy/docker-compose.yml logs -f app
```

**注意**：compose 里故意只写了 `expose` 没有写 `ports` —— 应用容器不对公网开放，
只有同一内网里的 nginx 能访问。**不要为了图省事加上 `ports: ["8787:8787"]`**，
那等于把「伪造 IP 绕过限流」的入口开到公网。

Docker 方案还需要把 `deploy/nginx.docker.conf` 挂给 nginx 容器
（compose 里已经配好，域名也已填成 `pixeltoy.cn`，不用改）。

---

## 6. nginx 与 HTTPS

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx

# ⚠️⚠️ 装之前**必须先读 6.1**：这台机器（101.42.111.251）上 pixeltoy.cn
#      已经由 /etc/nginx/sites-enabled/pixel-toy 在服务，而且它的 / 走的是
#      **Pixel Toys(4317)**。照抄下面两行会静默夺走这个域名、把 Pixel Toys 首页打掉。
# 只有「全新机器、这个域名没人用」才可以直接用下面两行：
sudo cp /opt/forme/deploy/nginx.conf /etc/nginx/sites-available/forme
sudo ln -sf /etc/nginx/sites-available/forme /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# 先申请证书（会自动改写 ssl_certificate 路径）
sudo certbot --nginx -d pixeltoy.cn

sudo nginx -t && sudo systemctl reload nginx
```

### 6.1 ⚠️ 同一台机器上已经有别的站时（**本机就是这种**）

`/etc/nginx/nginx.conf` 第 60 行是 `include /etc/nginx/sites-enabled/*;` —— **没有 `*.conf` 过滤**。
这条 include 带来两个静默陷阱：

1. **目录里每个文件都会被解析，包括 `.bak`**。
   `.bak` 里的 `server_name` 和真配置一样 ⇒ `nginx -t` 会刷出十几条
   `conflicting server name ... ignored`（2026-09-23 实测 **15 条**），
   噪音会淹没真问题；更糟的是**往 `.bak` 里加 location 会静默不生效**。
2. **多个文件声明同一个 `server_name` 时，nginx 只用 glob 字典序里的第一个。**
   `forme` 排在 `pixel-toy` **前面**（`f` < `p`）⇒ 一旦 `sites-enabled/forme` 出现，
   它就会**赢过** `pixel-toy`。而仓库那份 `nginx.conf` 的 `location /` 是
   `proxy_pass http://127.0.0.1:8787`（forme-server），
   ⇒ **`pixeltoy.cn/` 会从 Pixel Toys 变成 forme-server，首页直接坏掉，而且不报错。**

**正确做法（本机适用）：改现有文件，不要新增文件。**

```bash
# 1) 先看清单，确认只有一份生效配置
ls -la /etc/nginx/sites-enabled/
for f in /etc/nginx/sites-enabled/*; do echo "--- $f"; grep -ho 'server_name[^;]*' "$f"; done

# 2) 备份到 ~（⚠️ 不要备份进 sites-enabled/，那里会被解析，等于又造一组冲突）
sudo cp -a /etc/nginx/sites-enabled/pixel-toy ~/nginx-pixel-toy.bak.$(date +%Y%m%d-%H%M%S)

# 3) 就地改 /etc/nginx/sites-enabled/pixel-toy —— 只追加需要的 location，不要整份覆盖

# 4) 闸门
sudo nginx -t          # 必须没有 conflicting server name
sudo systemctl reload nginx

# 5) 回滚
sudo cp -a ~/nginx-pixel-toy.bak.<时间戳> /etc/nginx/sites-enabled/pixel-toy \
  && sudo nginx -t && sudo systemctl reload nginx
```

**判断有没有踩到冲突**：`sudo nginx -t 2>&1 | grep conflicting` —— 有输出就是踩到了。

> 2026-09-23 已把 3 个 `.bak` 从 `sites-enabled/` 移到 `/etc/nginx/backups/`，
> 冲突告警 15 → **0**。（`sites-available/` 里还有一批 `.bak`，但那个目录**不被 include**，无害。）

**nginx 配置里有两个点改动前必须想清楚**（文件里都有注释说明）：

1. `client_max_body_size 25m` —— 必须 ≥ 应用侧上限 20MB，否则大图会在 nginx 层被 413 掉，
   而应用日志里什么都看不到。
2. `X-Forwarded-For` 用 `$remote_addr` **覆盖**而不是 `$proxy_add_x_forwarded_for` 追加。
   用追加的话，攻击者自带一个 `X-Forwarded-For` 头就能绕过限流。

证书续期 certbot 会自动装好定时任务，验证一下：

```bash
sudo certbot renew --dry-run
```

---

## 7. 部署后验证

### 7.1 自检

```bash
cd /opt/forme
sudo -u forme NODE_ENV=production npm run preflight
```

这个脚本会检查 20 项左右，包括：密钥是否还是占位值、
回调路径是否正确、数据目录是否可写、`NODE_ENV` 是否为 production。
**有「阻断」项就不要上线。**

密钥那一组分两档，别把它们看成一回事：

| 档位 | 触发条件 | 为什么 |
| --- | --- | --- |
| ❌ 阻断 | 还是模板占位值（`verify_only_*`、`your_*`、`【待填】` 等） | 这一行根本没替换，服务起来也是坏的 |
| ❌ 阻断 | 值里含引号或空格 | 值会**原样**参与 HMAC 计算。多一个字符 → 签名不匹配 → 登录 40029 / 支付失败，而报错只说「签名错误」，查起来极痛苦 |
| ⚠️ 警告 | 形态不像（AppSecret 不是 32 位十六进制、OfferID 不是纯数字、key 明显截断） | 大概率粘错了字段（比如把 AppID 粘进了 AppSecret） |

形态规则**故意只警告不阻断**：规则万一过时（比如微信改了 AppSecret 长度），
阻断会让一个正确配置的服务器上不了线 —— 那种情况下运维只能去改脚本绕过门禁，
门禁就废了。警告足够让人多看一眼，且永远不会挡住正确的人。

规则实现在 `src/secret-shape.mjs`（纯函数），由冒烟测试用假值覆盖，
所以它本身不需要拿真实密钥来验证。

### 7.2 健康检查

```bash
curl https://pixeltoy.cn/api/health
```

期望 `"ok":true`。如果是 `false`，响应里的 `problems` 数组会直接告诉你哪里没配好。

同一个响应里还能顺眼确认三件上线策略有没有真的落地：

```json
{
  "imageCost": 0.4,          // 单张图 0.4 点（= ¥0.4）
  "initialBalance": 0,       // 不赠送点数
  "rateLimitEnabled": true   // 限流开着
}
```

这三个值不是机密，所以不鉴权 —— 部署完 `curl` 一下比去翻服务器上的 `.env` 快得多。
`initialBalance` 若是正数，说明新用户在**白拿点数**，请确认这是你要的运营策略。

### 7.3 回调连通性

```bash
cd /opt/forme
./deploy/verify-notify.sh https://pixeltoy.cn/api/pay/notify
```

期望看到「✅ 通过」。如果 404，就是路径漏了 `/api`。

### 7.4 确认 mock 接口不可达

生产环境这两条路由应该**根本不存在**：

```bash
curl -o /dev/null -w '%{http_code}\n' -X POST https://pixeltoy.cn/api/pay/mock-pay
# 期望 404
```

---

## 8. 真机端到端验证（最关键的一步）

前面都是「配置正确」的检查。**真正能不能收到钱、能不能发货，只有真机走一笔才能确认。**

在开发者工具里做不了：模拟器不支持虚拟支付。

步骤：

1. 小程序端用生产配置构建（见第 9 节），上传体验版
2. 用**体验版**在真机打开（必须是真实微信账号，不能是模拟器）
3. 进入充值页，选当前最小档位（目前轻量创作 30 元）。如需真实支付验收，使用下面的临时 1 元白名单商品流程。

#### 临时 1 元支付验收（默认关闭）

微信个人主体虚拟支付的官方接入页将正式环境 `env` 固定为 `0`，这里不伪造沙箱；
临时商品仍走正式支付链路，但只给指定 OpenID 展示。验收前：

1. 在 MP 后台道具管理创建并发布 `forme_test`，价格 **1 元**。
2. 在服务器 `.env.local` 临时填写 `TEST_PAYMENT_ENABLED=1` 和 `TEST_PAYMENT_OPENIDS=你的测试 OpenID`。
3. 重启服务并确认预检通过；白名单账号的充值目录会出现“支付验收（1 元）”。
4. 完成支付、推送、到账、订单查询、退款验收，并保存订单号。
5. 关闭 `TEST_PAYMENT_ENABLED`，重启服务；再从 MP 后台下架并删除测试道具，最后移除临时配置。

测试商品只给白名单账号创建订单；关闭开关后不能创建新测试订单，历史订单仍保留用于对账。
4. 完成支付
5. 确认三件事：
   - [ ] 点数**立即到账**（返回首页看点数胶囊）
   - [ ] 「点数明细」里有一笔充值流水
   - [ ] 服务端日志有 `[pay] 发货完成`

如果付了钱但没到账，按顺序查：

| 现象 | 检查点 |
| --- | --- |
| 后台点「保存」报配置失败 | `WECHAT_MSG_TOKEN` 与后台填的 Token 不一致，或服务端没配这一项。直接 `curl` 那个地址会看到 403 / 503 和原因 |
| 日志里报「消息推送配置有误」 | 后台的【数据格式】选成了 JSON，或【消息加解密方式】选成了安全模式 —— 改成 **XML + 明文模式** |
| 日志里完全没有推送记录 | `WECHAT_PAY_NOTIFY_URL` 配错，或域名没加进 MP 后台 |
| 有推送但报签名错误 | `WECHAT_APP_KEY` 用错了（沙箱 vs 现网） |
| 有推送但提示找不到订单 | `WECHAT_OFFER_ID` 不一致 |
| 提示道具不存在 | 4 个 productId 没在 MP 后台建好，或名称拼错 |

**验证退款**（同样重要，退款没有兜底）：

在 MP 后台对刚才那笔订单发起退款，确认点数被回收、
余额没有变成负数。如果点数已被花掉，应该收到告警且订单上记录缺口。
先记录付款到账证据，再单独跟踪退款通知与余额回收；iOS 退款申请可能无法当天完成。
当前服务端只支持全额退款，勿用部分退款作为首笔验收。

---

## 9. 小程序端配置

### 9.1 MP 后台加域名

开发管理 → 开发设置 → 服务器域名，四个都加上 `https://pixeltoy.cn`：

- [ ] request 合法域名
- [ ] uploadFile 合法域名
- [ ] downloadFile 合法域名
- [ ] socket 合法域名（如果不用 WebSocket 可跳过）

四条容易踩的规则（官方文档原文，别凭印象）：

- **只能 `https`**，不能填 IP 或 `localhost`
- **域名必须已 ICP 备案**（这也是为什么备案是关键路径）
- **填了不带端口的域名，请求里就绝不能带端口** —— 连默认的 `443` 都不行。
  填 `https://pixeltoy.cn` 却去请求 `https://pixeltoy.cn:443/api/...` 会直接失败。
  我们客户端用的是不带端口的写法，符合要求
- **不支持「配父域名覆盖子域名」** —— 配了 `pixeltoy.cn` 不代表
  `api.pixeltoy.cn` 能用。本项目全部用同一个主机名，不受影响
- `api.weixin.qq.com` 被禁止配置为服务器域名（所以 AppSecret 必须留在服务端）

配完**记得关掉开发者工具里的「不校验合法域名」**再测 —— 开着它，
白名单没配你也看不出来，真机上才会集体失败（见 9.4）。

### 9.2 封面图：不要用外部图床

小程序里的样式卡片封面原本指向 `images.unsplash.com`（产物里 23 处）。
**这在真机上会坏**：`<Image>` 加载远程图要求域名在「downloadFile 合法域名」白名单里，
没配就是空白 —— 而开发者工具勾着「不校验合法域名」照样正常显示，
很容易被当成样式 bug 查半天。

两条路，推荐第一条：

**① 收到自有域名下（推荐）**

⚠️ **顺序不能反：先让服务器能出图，再配 env。**
反过来的产物是「`verify:dist` 转绿、线上封面全白」——
`verify:dist` 是**静态**判断（只看 env 配没配），它看不见服务器上有没有那些文件。
那是绿色门禁掩盖坏状态，比门禁报红危险得多。

```bash
# 1. 下载（文件名规则与 media() 一致，别手敲）
cd forme-server
npm run fetch:covers

# 2. 确认 nginx 的 /media/ 已生效（见 §6）
#
#    ⭐ 推荐：跑只读诊断脚本，它把下面几条手工检查一次做完，
#       并且会回答「该往哪个文件里加」——多站点机器上这才是关键问题。
bash deploy/diag-media.sh

#    手工版（脚本不可用时）：
grep -rn 'location /media/' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/
ls -la /opt/forme/media/ 2>&1 | head      # alias 指向的目录存不存在
sudo nginx -t && sudo systemctl reload nginx

# 3. 传上去
rsync -av deploy/media/ root@pixeltoy.cn:/opt/forme/media/

# 4. 验 —— 这一步别跳，它才是「真的能出图」的证据
npm run check:media
```

> ⚠️ **多站点机器上的真实陷阱**（2026-09-23 实测）：`pixeltoy.cn` 的 `/` 由**另一个应用**在服务
> （返回 `{ "ok": false, "message": "not found" }`，**不带** `code` 字段），
> 而我们仓库里的 `deploy/nginx.conf` **并不是当前生效的那份**。
> ⇒ **不要**直接 `cp deploy/nginx.conf /etc/nginx/sites-available/forme` —— 那会把那个站整块覆盖掉。
> 正确做法是**只往服务该域名的 server 块里追加一条 `location /media/`**。
> 同一个 `server_name` 有多个 server 块时，nginx **只用第一个匹配的** ——
> 这正好能解释「`/api/` 通、`/media/` 不通」：两条 location 落在了不同的块里。
> `deploy/diag-media.sh` 的第 2 步就是专门把这件事查清楚的。

`check:media` 会 HEAD 每个文件，断言 **200 + `content-type: image/*`**
（后者对应漏写 `default_type` 的情形），并按「**是谁发的 404**」告诉你是哪一层的问题：

| 404 的响应体 | 谁发的 | 怎么修 |
| --- | --- | --- |
| HTML | nginx 静态 | `/media/` 已生效，只是**文件没传上去** → 重跑第 3 步 |
| JSON，**带** `code` 字段 | 落到 forme-server | nginx 没有 `/media/` 这条静态 location |
| JSON，**不带** `code` | 落到**别的应用** | 这台机器上还有别的站点占了 `location /` |

> 🔴 **如果这台机器上还有别的站点**（例如 `pixeltoy.cn` 上另有一个站），
> 加 `/media/` 时**只往对应的 server 块里追加一个 location，不要覆盖别人的配置**。
> 改前先 `sudo cp -a /etc/nginx/sites-enabled/<文件> ~/nginx.bak`。
> 配错了的表现是「封面全 404，但 `/api/` 一切正常」—— 因为 `/api/` 是另一条 location。

**第 5 步：确认能出图之后**，才在 `forme-taro/.env.production` 里填一行：

```
TARO_APP_MEDIA_BASE=https://pixeltoy.cn/media
```

然后重新 `npm run release`。`verify:dist` 的「远程图片域名已收口」会转绿，
再跑一次 `npm run check:media` 应该 21/21 通过。

推荐这条的理由：自有域名本来就要进四个白名单，等于白拿；
而且商业产品里少一个不受控的运行时依赖 —— 对方改地址、限流、删图，你都不会收到通知。

**② 继续用外部图床**

把域名加进后台的 downloadFile 合法域名，再填进
`forme-taro/scripts/verify-dist.mjs` 的 `ALLOWLISTED_MEDIA_HOSTS`。
**填进去就等于你为这件事负责了** —— 那个域名哪天失效，封面会集体空白。

> ⚠️ 两个容易踩的细节：
>
> 1. **文件名没有扩展名**。规则由 `media()` 决定：取原 URL 去掉查询串后的最后一段，
>    `.../photo-1549490349-8643362247b5?auto=format` → `photo-1549490349-8643362247b5`。
>    所以 nginx 那边必须给 `default_type image/jpeg`，否则会发
>    `application/octet-stream`，表现同样是「封面空白」，和域名没配白名单长得一模一样。
>    **别手敲文件名**，用 `npm run fetch:covers`。
> 2. 下载脚本会把 `auto=format` 去掉、显式要 jpg 并把宽度压到 750。
>    原样下载单张 335KB（23 张约 7.7MB），而这些只是卡片缩略图 ——
>    用户首次进入就要拉这么多，移动网络下很慢。要改规格用 `--w= --q=`。

### 9.3 切生产配置并构建

```bash
cd forme-taro
# 编辑 .env.production，把 apiBaseUrl 换成真实域名
#   TARO_APP_API_BASE=https://pixeltoy.cn

# 一条命令跑完「类型检查 → 构建 → 产物校验」
npm run release
```

`npm run release` = `typecheck && build:weapp && verify:dist`。
单独跑产物校验是 `npm run verify:dist`（需要先构建）。

**为什么不能只看「Compiled successfully」**：Taro 用 babel 转译，跳过类型与标识符
检查；配置类问题（域名、演示模式）也只在构建后才定形。`verify:dist` 把这些不变量
钉在产物上，分两类输出：

- **阻断项**（产物有问题，修了才能传）：演示模式没关、AIGC 导出标识链路缺环、
  资产页预览绕过了标识、产物里残留本机地址
- **提醒项**（还没做的事）：API 域名还是占位符

手工核对也可以，判据是这几条：

```bash
# 域名写对了（接口地址编译进 common.js，不在 app.js）
grep -o 'https://pixeltoy.cn' dist/common.js | head -1
# 不应出现 127.0.0.1
grep -c '127.0.0.1' dist/common.js
# 演示模式必须是关的。期望 useMockGeneration:!1
grep -o 'useMockGeneration:[^,}]*' dist/common.js
```

> 生产构建**强制关闭演示模式**：`src/config/index.ts` 里的判定是
> `NODE_ENV !== 'production' && TARO_APP_USE_MOCK !== '0'`，
> 所以生产包里写 `TARO_APP_USE_MOCK=1` 也不会生效。
> 这是刻意的——演示模式返回的是本地占位图，用户付了钱却拿到假结果，
> 而且导出时会给设计稿里的真实照片贴上「AI 生成」标签。
> 想本地看 UI 请用 `npm run dev:weapp`，不要动生产构建。

### 9.4 上传前：开发者工具的准备

这是上传前最后一道**必须人工做**的步骤，而且很容易卡住。

1. 下载**稳定版**开发者工具（Windows 64 位）并安装：
   `https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html`
2. 打开后用**小程序管理员本人的微信**扫码登录。

   > ⚠️ 用别的微信号登录会提示「没有 AppID `wxf595b8865bcbf254` 的权限」。
   > 这个提示**看起来像 AppID 配错了**，其实只是登录的号不对 ——
   > 别去改 `project.config.json`。

3. 「导入项目」→ 选 `forme-taro` 目录。
   `project.config.json` 里已经写好 AppID 与 `miniprogramRoot`，不用手填。

导入后，上传前再做两件事：

- **确认「不校验合法域名」是关的**（详情 → 本地设置）。
  开着它，域名白名单没配你也看不出来 —— 而真机上会全挂。
- 确认 `npm run release` 刚跑过。**上传的是 `dist`，不是源码**；
  改了源码没重新构建就上传，传上去的是旧版本。

### 9.5 上传

用微信开发者工具打开 `forme-taro` → 上传 → 填版本号 → 提交审核。

---

## 10. MP 后台配置清单

这部分只能人工在 mp.weixin.qq.com 操作，服务端代码已经全部就绪。

> ⚠️ **顺序很重要：先部署服务，再来配「消息推送」。**
> 点「保存」时微信会**立刻**发一个验证请求到那个 URL，服务器必须在跑、
> 证书必须生效、`WECHAT_MSG_TOKEN` 必须已填 —— 否则保存会失败，
> 而错误提示只有一句「配置失败」，看不出是这四项里的哪一项。
> 所以正确顺序是：**填 `.env.local` → 部署服务 + nginx + 证书 → 再回后台点保存**。

- [ ] 服务类目包含**「工具」**（虚拟支付开通的前提）
- [ ] 小程序已完成认证 + 备案
- [ ] 开通虚拟支付：拿到 **OfferID** 与**现网 AppKey**
- [ ] 创建 4 个道具，productId 必须**完全一致**：

| productId | 名称 | 价格 | 内容 |
| --- | --- | --- | --- |
| `forme_pass_30d_30pts` | 轻量创作 | 30 元 | 30 天权益 + 26 点 |
| `forme_pass_30d_100pts` | 专业创作 | 100 元 | 30 天权益 + 88 点 |
| `forme_points_100_once` | 88 点 | 100 元 | 88 点 |
| `forme_points_500_once` | 440 点 | 500 元 | 440 点 |

> 2026-09-24 点数调整后，productId 和价格保持原值。MP 后台商品名称及描述须同步为新点数。

- [ ] 🔴 配置**小程序简称** —— 这是「打开苹果支付」的**硬前置**，不配就直接报
      **「开通苹果支付提示异常，未设置小程序简称」**（2026-09-24 实际遇到）。
      ✅ **2026-09-24 已定：简称 = 「像素玩具」**（与全名一致）。
      若后台拒绝「简称与名称相同」，退一档依次试 `像素玩` → `像素`（都合法，各占一次机会）。
      规则（官方《小程序名称、简称设置规范》，kf.qq.com）：
      - **必须是从「小程序名称」里按顺序截取的连续子串** ⇒ 不能另起一个品牌名。
        本账号的**小程序名称是「像素玩具」**（4 个汉字 = **8 个字符**，
        从开发者工具本地缓存 `appName` 读到，不是后台截图 ⇒ 请你在后台核一眼）。
        于是合法简称只有这几个：
        | 简称 | 字符数 | 说明 |
        | --- | --- | --- |
        | `像素` | 4 | 下限 |
        | `素玩` | 4 | |
        | `玩具` | 4 | |
        | `像素玩` | 6 | |
        | `素玩具` | 6 | |
        | `像素玩具` | 8 | 与全名相同，最省事 |
      - **长度 4–10 个字符，一个中文字 = 2 个字符** ⇒ 中文简称只能 **2–5 个汉字**。
        所以 `Pixel Box` 这类品牌名**配不上去**（它也不是「像素玩具」的子串）。
      - **生效时间**：正常情况**设置后直接生效**；命中名称保护词需 **1–3 个工作日**。
      - **路径**：【设置】→【基本信息】→【小程序简称】→【修改】→ **管理员扫码确认**。
      - 🔴 **次数很紧**：**发布前只有 2 次修改机会**，发布后 2 次/年；
        **删除简称也占一次**。我们现在还没发布 ⇒ 别拿这 2 次做试验。
      - 另：**小程序名称修改期间，简称不可修改**。
- [ ] 🔴 **打开「苹果支付」开关** —— **这是第二个开关，和「开通虚拟支付」不是同一件事**。
      路径：MP 后台 → 虚拟支付 → **基础配置**。
      官方原文的前置条件是**两条同时满足**：「已开通小程序虚拟支付」**且**「已配置小程序简称」
      （简称是给 Apple 支付展示 display name 用的）。
      不开的后果：**安卓正常付，iOS 点充值直接报「当前商户未开启IOS支付」**
      （2026-09-24 真机实际遇到，报错来自微信收银台，不是我们代码）。
      ⚠️ **开启后约 10 分钟才生效**，刚开就测仍然会失败，别以为没开成功。
- [ ] iOS 专项（和安卓不一样，测之前必须知道）：
      - **iOS 上不存在「直接用微信支付买虚拟商品」这条路**。官方文档的**设备路由**是机制性的：
        调用 `wx.requestVirtualPayment` 后，平台按设备分发 ——
        **Android / 鸿蒙 / Windows → 微信支付；iOS → Apple 支付**。
        所以 iOS 只有 Apple 支付这一条合规通道，不是「禁止」而是**没有第二条**。
      - **iOS 不支持沙箱** ⇒ 只能走现网（`env: 0`）。服务端已把它固定成 0
        （`src/pay.mjs`：`env: config.wechat.env`，`WECHAT_ENV` 默认 `0`）——
        这正是 iOS 的要求，别为了调试把它改成 1。
      - 因此 **iOS 上的测试是真实扣款**，要用真实 Apple ID。
      - 4 个道具**必须「发布到现网」**，停在开发版本时 iOS 找不到
        （安卓可以先用沙箱环境调试，iOS 不行）。
      - **iOS 用户侧硬条件（官方原文）**：**iOS 15 及以上** + **微信 8.0.68 及以上**
        + **最低支付金额 1 元** + **仅支持中国大陆的 App Store 账户**。
        客户端已在下单**之前**校验微信版本
        （`forme-taro/src/services/account.ts` 的 `assertPayablePlatform`），
        校验失败不会留下垃圾订单。
      - **当前生效费率：Android 等主动支付 1%，iOS 12%（Apple 佣金）。**
        来源：[微信官方个人主体虚拟支付文档](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person)，2026-09-24 核验。
        套餐按 12% 预留并向下取整；后续费率变化需重新核算，以后台实际账单为准。
      - **结算：iOS 端由 Apple 结算，官方写明通常在自然月结束后 45～60 天内**
        扣佣后结给腾讯 ⇒ 到账比安卓慢得多，**别按「次月到账」做现金流安排**。
      - 2026-04-01 起微信要求**全终端**（iOS / 安卓 / Windows / 鸿蒙）都接入虚拟支付，
        只开安卓不合规；官方文档的适用范围也写的是「适用于 Android、iOS、鸿蒙、Windows
        等所有终端」。
      - ⚠️ 历史背景（为什么以前 iOS 上没有充值入口）：iOS 端虚拟支付自 **2018-05-08**
        起受限，当时**连价格标签、购买按钮、引导文案都不许留**。
        2026 年苹果推出「小程序合作伙伴计划」后解禁 —— 所以现在才有这条正路可走。
- [ ] **配置发货推送 URL** —— 位置是 **【开发与服务】→【开发管理】→【消息推送】**，
      **不在「虚拟支付」那一栏里**，在虚拟支付页面里找不到这个设置是正常的。
      点「配置」后填 4 项。其中 3 项选错都会让推送永远处理不了，而且**不会报错**：
      - **URL**：`https://pixeltoy.cn/api/pay/notify`。漏掉 `/api` 平台会一直收 404
        并无限重试，用户付了钱永远不到账。
      - **Token**：自己定一个字符串，**并把它逐字写进 `forme-server/.env.local`
        的 `WECHAT_MSG_TOKEN`**。两边不一致，点保存就会报「配置失败」。
      - **数据格式**：选 **XML**。选 JSON 服务端解析不出订单，只会一直重试。
      - **消息加解密方式**：选 **明文模式**。选安全模式服务端收到的是密文。
      - 点「保存」时微信会发一个验证请求到这个 URL，服务端验签后**原样返回
        `echostr`**（已实现，见 `src/router.mjs` 的 `handleNotifyVerify`）。
        保存成功才算真的配好了。
      - 配完用 `./deploy/verify-notify.sh https://pixeltoy.cn/api/pay/notify <Token>`
        验一遍 —— 它会把 GET 握手和 POST 推送两条路径**分别**验一次。
        POST 必须带有效签名；没传 Token 时脚本只能确认未签名请求被拒绝。
      - 配错的后果：平台推送永远到不了，用户付了钱永远不到账
        （表现和「回调路径漏了 /api」一模一样）
- [ ] 服务器域名白名单（见 9.1）
- [ ] **《用户隐私保护指引》已声明并审核通过**（见 13 节，缺这一步 `chooseMedia` 直接报 `errno 112`）
- [ ] 内容安全接口权限确认（`security.msgSecCheck` / `imgSecCheck`）

> 价格与时长以 `src/catalog.mjs` 为准，改了代码要同步改后台，两边必须一致。
> 后台价格（分）与代码里的 `priceFen` 对不上时，平台会直接拒绝支付 ——
> 是「付不了款」而不是「付错钱」，所以不会资损，但用户会看到莫名的支付失败。
> `npm run preflight` 会把四个道具的对照表打出来，照着核一遍。

---

## 11. 上线检查单

```
部署
[ ] Node >= 20
[ ] .env.local 权限 600，密钥非占位值
[ ] HOST=127.0.0.1（裸机）
[ ] MOCK_WECHAT=0 / MOCK_LLM=0 / SECURITY_MODE=enforce
[ ] data/ 挂在持久卷上；首次部署先运行 `npm run init:data`，已有数据绝不能重新初始化
[ ] npm run preflight 全绿
[ ] systemctl enable 已设置（重启后自动起）

网络
[ ] HTTPS 证书有效且能自动续期
[ ] curl /api/health 返回 ok:true
[ ] /api/health 里 imageCost=0.4、initialBalance=0、rateLimitEnabled=true
[ ] 用真实上游单价和后台实际结算账单核算过毛利；iOS 费率未确认前不写固定百分比
[ ] verify-notify.sh 通过
[ ] mock-pay 返回 404
[ ] 防火墙只开放 80/443，8787 不对公网开放
[ ] nginx `/media/` 已生效（用了自有域名封面时）：`npm run check:media` → **21/21 通过**
    它会逐个 HEAD 并断言 200 + `Content-Type: image/*`，比手工 curl 一个文件可靠得多。
    **类型不对也会白屏**，见 9.2 的说明
[ ] **`/media/` 是先验过的、`TARO_APP_MEDIA_BASE` 是后配的**（顺序反了会得到
    「`verify:dist` 转绿但线上封面全白」，见 9.2）

合规
[ ] AIGC_METADATA=1 且 AIGC_PROVIDER 非空（启动门禁会拦，仍建议确认一次）
[ ] 下载一张线上生成的图，确认文件里带 AIGC 隐式标识（见 13 节的自检命令）
[ ] 出图页与结果页都能看到「AI 生成」显式标识
[ ] 真机存一张图到相册，**从相册里**确认图上有「AI 生成」角标（合成失败会静默退回原图）
[ ] 真机在资产页预览图片，长按菜单保存出来的图也带角标
[ ] 《用户隐私保护指引》已声明 chooseMedia / saveImageToPhotosAlbum 并审核通过
[ ] 用户协议写明 AIGC 标识的方式与样式（《标识办法》第八条）

支付
[ ] 4 个 productId 在 MP 后台已创建，且与 `npm run preflight` 打印的对照表**完全一致**
[ ] 4 个道具在后台**已发布**（只创建不发布同样付不了款）
[ ] 小程序简称已配置（iOS 需要；只能是「像素玩具」的连续子串，发布前仅 2 次机会，见 10 节）
[ ] **发货推送 URL 已在【开发管理 → 消息推送】配置**（不在虚拟支付那一栏，见 10 节）
[ ] **消息推送的 Token 与 `.env.local` 的 `WECHAT_MSG_TOKEN` 逐字一致**，
    且【数据格式】= XML、【消息加解密方式】= 明文模式
[ ] `./deploy/verify-notify.sh https://pixeltoy.cn/api/pay/notify <Token>` 两条路径都通过
    （POST 推送到位 + GET 握手能保存配置）
[ ] 真机走通一笔真实支付，点数到账（当前最低档为 30 元）
[ ] 支付 → 推送 → 发货 → MP 后台【虚拟支付 → 交易订单】金额一致
[ ] 真机全额退款通知字段已与实际 XML 核对，点数被回收；iOS 可跨天跟踪
[ ] 已向用户说明退款规则、结算周期与费率（Android 1% 官方明确；iOS 以后台
    「虚拟支付 → 资金管理」实际账单为准，约 45–60 天结算）
[ ] 已知悉**个人主体月支付限额 10 万元**（触顶后当月无法继续收款）

小程序
[ ] 微信开发者工具已安装，且用**管理员本人微信**登录（否则报「没有 AppID 权限」，见 9.4）
[ ] 导入项目后「不校验合法域名」是**关**的
[ ] 上传前刚跑过 `npm run release`（上传的是 dist，不是源码）
[ ] .env.production 指向真实域名（不是 YOUR_API_DOMAIN 占位符）
[ ] 四个服务器域名已加入白名单
[ ] **npm run release 全绿**（= typecheck + build:weapp + verify:dist）
    verify:dist 会拦住：演示模式没关、AIGC 导出标识链路缺环、
    资产页预览绕过标识、产物里残留本机地址
[ ] dist 里没有 127.0.0.1 残留
[ ] 封面图已收口：配了 `TARO_APP_MEDIA_BASE`，或把外部图床域名加进了
    downloadFile 白名单并登记在 verify-dist.mjs 里（见 9.2）
[ ] **真机上样式卡片的封面都显示出来了**（不是灰块/空白）。
    这个问题在开发者工具里**看不出来**，必须真机看
[ ] 体验版在真机上全流程走通
[ ] 真机上首次点「选择图片」会弹隐私授权，同意后能正常进相册

运维
[ ] 配了 ALERT_WEBHOOK_URL，且发出测试告警后在目标平台收到
[ ] 配了 data/ 的定期备份，并验证归档与恢复
[ ] 知道怎么看日志：journalctl -u forme-server -f
[ ] npm run check 全绿（= check:aigc + check:holds + smoke）
[ ] 发布后扫一眼启动日志：出现「回收孤儿预扣」是正常的（上次发布砍掉了在飞请求），
    频繁出现才需要查部署方式
```

---

## 12. 回滚

```bash
# 停服
sudo systemctl stop forme-server

# 切回上一个版本（建议每次发布前打 tag 或留一份 tar 包）
cd /opt
sudo tar -xzf forme-server-previous.tar.gz -C /opt/forme --strip-components=1
sudo chown -R forme:forme /opt/forme

sudo systemctl start forme-server
journalctl -u forme-server -n 30 --no-pager
```

⚠️ **回滚代码不需要回滚 `data/`**。数据目录是向前兼容的，
用旧数据配新代码没问题；反过来用旧代码读新数据可能有字段缺失。
所以发布前**先备份 `data/`**：

```bash
sudo tar -czf ~/forme-data-$(date +%F-%H%M).tar.gz -C /opt/forme data
```

---

## 13. 合规：AIGC 标识与隐私授权

这两件事不是「最好有」，是**上线硬门槛**：一个违反《人工智能生成合成内容标识办法》，
一个会让核心功能直接报错。

### 13.1 AIGC 内容标识

依据《人工智能生成合成内容标识办法》（国信办通字〔2025〕2 号，**2025-09-01 施行**）。

**隐式标识（服务端已实现，第五条）。** 每张**生成**的图在落盘时写入文件元数据：

| 格式 | 承载方式 | 写入位置 |
| --- | --- | --- |
| PNG | `iTXt` 块 | 紧跟 IHDR 之后（文件头部） |
| JPEG | `COM` 段（`0xFFFE`） | 紧跟 SOI 之后 |

内容形如：

```
AIGC=1;Provider=Pixel Box;Service=forme-server;ContentId=f_xxx;GeneratedAt=2026-09-18T...
```

三要素齐全：生成合成内容属性（`AIGC=1`）、服务提供者名称（`Provider`）、内容编号（`ContentId`）。

- 用 `iTXt` 而不是 `tEXt`：`tEXt` 是 Latin-1，写中文的 `Provider` 会乱码。
- **只标识「生成的」图，不标识用户自己上传的素材** —— 上传件不是生成合成内容，标了反而是错的。
- 写入失败（不支持的格式、文件损坏）**不会中断出图**，而是打一条 warning 告警。
  这是刻意的：宁可出一张没标识的图并告警，也不要在用户已经付费的情况下整个请求失败。
  收到这条告警要人工介入。

部署后自检：

```bash
# 拉一张线上生成的图，看头部有没有 AIGC 标识
curl -s https://pixeltoy.cn/api/files/f_xxx -o /tmp/gen.png
strings /tmp/gen.png | head -3        # 期望能看到 AIGC=1;Provider=...
```

或者本地跑字节级校验（不启服务）：

```bash
npm run check:aigc     # 29 项断言：PNG/JPEG 结构、CRC、位置、UTF-8、异常输入
```

**显式标识（客户端已实现，第四条）。** 「AI 生成」的可见文案由 `/api/catalog` 的
`aigc.label` 下发，出图页与结果页都渲染。客户端**不要写死这几个字** ——
文案改动要能覆盖已装在用户手机上的旧版本。

第四条末段要求「下载、复制、导出」时文件中也带显式标识，所以**每一条能把图拿出去
的路径都要收口**，共三条：

| 路径 | 位置 | 处理 |
| --- | --- | --- |
| 保存到相册 | 结果页 | 保存前用离屏画布把文案合成进像素 |
| 图片预览 | 资产页 | 微信 `previewImage` 自带长按菜单「保存图片 / 发送给朋友」，**是一条我们控制不了的下载路径**，所以预览的是已合成标识的副本，而不是原图 |
| `onShareAppMessage` 的 `imageUrl` | — | 当前工程没有分享入口；将来要加必须用合成后的路径，不要直接塞原图 |

第二条最容易漏，因为它看起来只是「看一眼」。

实现见 `forme-taro/src/services/export-image.ts`（用 `createOffscreenCanvas`，
基础库 2.16.1+，不需要在页面里挂 `<Canvas>` 节点，任何页面都能调）。
导出格式跟随源文件，不做「一律转 JPEG 压体积」——生成结果是用户花钱买的成品，
无损重编码不会让它变差。

**核心设计：合成永不阻断。** 任何一步失败（拿不到尺寸、图片解码失败、导出空路径、
基础库过低）都**退回原图**，只记 `console.warn`，用户照常存图、照常预览。
理由：存图是用户的核心诉求，少一个角标远没有「存不了图」严重。
代价是失败时导出文件只有隐式标识，所以：

- 合成结果带 `labeled: false` 与原因，便于排查；
- **真机验收必须做**：存一张图到相册，再从相册里看图上有没有「AI 生成」角标。
  看不到就是合成失败了，去 `console.warn` 里找原因。

**用户协议（第八条）** 需写明标识的方式与样式（「图片元数据中写入隐式标识，
交互界面与生成结果上展示『AI 生成』，导出文件中合成可见标识」）。

### 13.2 隐私授权

`wx.chooseMedia` / `wx.saveImageToPhotosAlbum` 属于**隐私接口**。不处理会有两种后果：
后台没声明 → 接口被禁用，调用直接 `errno 112`；用户拒绝 → 抛英文原始错误。

**MP 后台（必须人工完成）。** 小程序后台 →「设置 → 服务内容声明 → 用户隐私保护指引」，
声明以下处理的信息类型：

| 接口 | 需声明的信息类型 |
| --- | --- |
| `wx.chooseMedia` | 相册（选择图片）、摄像头（拍摄） |
| `wx.saveImageToPhotosAlbum` | 相册（写入） |

声明后**要等审核通过**再提审版本，否则线上仍是 `112`。

**客户端（已实现）。** 流程是「先主动查、再弹自建弹窗、兜底走官方弹窗」：

- 用 `wx.getPrivacySetting` 主动查询，**没有**用 `wx.onNeedPrivacyAuthorization`。
  原因是后者**没有对应的取消订阅 API**：一旦注册就无法注销，如果弹窗组件没挂载、
  `resolve()` 永远不被调用，隐私接口会**永久 pending**，用户点什么都卡住。
- 同意按钮必须是原生 `<Button open-type="agreePrivacyAuthorization">`，
  **不能用 `<View>` 冒充** —— 基础库校验的是被点击按钮的 `id`，换掉就不认。
- 基础库要求 ≥ 2.32.3。

真机验证：全新用户首次点「选择图片」应弹出自建授权弹窗，同意后正常进相册；
拒绝后再点一次应能重新弹。若报 `errno 112`，就是 13.2 的 MP 后台声明没做完。

---

## 14. 运维

### 日志

```bash
journalctl -u forme-server -f              # 实时
journalctl -u forme-server --since "1 hour ago"
journalctl -u forme-server | grep '\[pay\]'    # 只看支付
journalctl -u forme-server | grep 'alert'      # 只看告警
```

### 告警验收

告警配置完成后，在服务端运行 `npm run test:alert -- --send` 发送一条带唯一编号的测试消息。
命令会核对 HTTP 状态以及企业微信/钉钉/飞书的业务返回码；命令成功后还需在目标群核对编号。
`npm run check:alert` 使用隔离的网络模拟验证发送逻辑，不会向外部发送消息。
Webhook 地址属于密钥，只写进未跟踪的 `.env.local`，不要贴进部署记录或命令输出。

### 备份

`data/state.json` 保存余额和订单，`data/uploads/` 保存上传文件；两者都需备份。
生产环境缺失或无法解析 `state.json` 时服务会拒绝启动。全新部署先在空数据目录执行
`npm run init:data`；已有账户的机器只能从备份恢复，不能重新初始化。

每天备份并检查归档内含 `data/state.json`：

```bash
# 加到 crontab：每天凌晨 3 点；确认 APP_DIR 是实际服务目录
0 3 * * * APP_DIR=/opt/forme/forme-server BACKUP_DIR=/backup/forme /usr/bin/node /opt/forme/forme-server/deploy/backup-data.mjs
```

每次备份后检查脚本退出码和归档清单；首次配置时把归档解压到隔离目录，确认
`state.json` 可解析且 `uploads/` 文件存在。状态变更现在同步落盘成功后才向请求返回成功。

### 发布与退出：为什么每次发布都会砍掉在飞的出图

出图的扣费是**预扣 → 上游调用 → 结算或回滚**。预扣一落盘，钱就已经从用户
余额扣掉了，磁盘上多出一条 `pending` 流水。

收到 SIGTERM 后应用会停收新连接、等已有请求结束，但**最多只等
`SHUTDOWN_GRACE_MS`（默认 5 秒）**。出图最长可以跑到 `LLM_TIMEOUT_MS`
（默认 180 秒），所以：

```
发布 → SIGTERM → 等 5 秒 → 落盘退出
                          ↑ 在飞的出图请求被砍在这里
```

被砍掉的请求不会跑到 `commitCharge` 或 `releaseCharge`，于是留下一个
**孤儿预扣**：用户余额被扣了、图没拿到、流水停在 `pending`。

**不会资损**：下次启动时 `reclaimOrphanHolds` 会把它们全部退还给用户并打告警
（`store.mjs` 里有为什么「启动时全部回收」是可以证明正确的）。

想让发布排空在飞请求，就把 `SHUTDOWN_GRACE_MS` 调大——但**必须同时调大**
`deploy/forme-server.service` 里的 `TimeoutStopSec`（默认 15 秒），
否则 systemd 会先 SIGKILL，这个值等于没生效。启动自检会在
`SHUTDOWN_GRACE_MS > 15000` 时提醒这一点。

### 常见故障

| 现象 | 原因 / 处理 |
| --- | --- |
| 服务起不来，日志一堆 `❌` | 配置自检没过。按提示改 `.env.local`。这是**有意的**保护 |
| `EADDRINUSE` | 8787 被占了。`ss -lntp \| grep 8787` 看是谁 |
| 所有请求 502 | 后端没起，或 `HOST` 没配成 `127.0.0.1` |
| 大图上传 413 | nginx `client_max_body_size` 太小 |
| 出图 504 但点数被扣了 | nginx `proxy_read_timeout` 小于 `LLM_TIMEOUT_MS`。点数会被回滚，但要调大 nginx 超时 |
| 用户付钱不到账 | 按第 8 节的排查表逐项查 |
| 自检报「还是模板里的占位值」 | 那一行没被真正替换。`cp deploy/.env.local.ready .env.local` 之后要**整行替换**，别只改一半 |
| 密钥明明填了，登录 40029 / 支付签名错误 | 值里混进了引号或空格（从网页复制很容易带上）。自检会拦；真被绕过了用 `cat -A .env.local` 看行尾 |
| 收到「退款缺口」告警 | 用户退款前已把点数花掉，收不回来。属真实亏损，人工决定是否追损 |
| 启动日志出现「回收孤儿预扣」 | 上一次进程在「预扣已落盘、上游还在等」的窗口里退出（发布 / OOM / `kill -9`）。钱已自动退还，**不是资损**；但频繁出现说明部署方式在强杀进程，要查 |
| 内存持续增长 | 限流计数桶会定期清理（5 分钟）。如果仍异常，检查是否有异常大的 `state.json` |

### 多实例部署

当前实现是**单进程**假设（`state.json` 全量读写 + 内存限流计数）。
要水平扩展需要改两处：

1. `src/store.mjs` —— 换成数据库（Postgres / MySQL）
2. `src/ratelimit.mjs` —— 计数换成 Redis

上层调用点不用动，接口是照着这个方向设计的。
