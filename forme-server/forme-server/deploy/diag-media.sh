#!/usr/bin/env bash
# /media/ 封面收口 —— 服务器端**只读**诊断
# ==================================================================
# 用法（在服务器上）：
#   bash deploy/diag-media.sh
#
# 它**不改任何东西** —— 只打印事实。为什么先诊断再动手：
#
#   2026-09-23 从本机探到的线上事实（三条都是实测，不是推断）：
#     · GET /api/catalog        → 200，是我们 forme-server 的目录 JSON   ✅
#     · GET /                   → 200 text/html，标题 "Pixel Toys"
#     · GET /media/<file>       → 404  {"ok":false,"message":"not found"}
#     · GET /api/<不存在的路由> → 404  {"ok":false,"code":"not_found","message":"接口不存在：…"}
#
#   关键在那两个 404 的**形状不同**：
#     · forme-server 的错误体一定带 `code` 字段（src/router.mjs 的 sendError）
#     · /media/ 的 404 **没有** `code`、message 是英文、冒号后还有空格
#   ⇒ **/media/ 的请求落到了另一个应用**，不是我们的 forme-server。
#
#   ⇒ 所以**不能**直接 `cp deploy/nginx.conf /etc/nginx/sites-available/forme` ——
#     那样会把正在服务 `/` 的那个站（Pixel Toys 落地页）整块覆盖掉。
#     正确做法是**只往那个 server 块里追加一条 location /media/**。
#
#   本脚本就是用来回答「那个 server 块到底是哪个文件」的。
# ==================================================================

set -u

DOMAIN="${1:-pixeltoy.cn}"
SITE_DIR="/opt/forme/media"

line() { printf '%s\n' "────────────────────────────────────────────────────────────"; }
hdr()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

hdr "0. 基本信息"
echo "  域名        $DOMAIN"
echo "  时间        $(date '+%F %T')"
echo "  nginx       $(nginx -v 2>&1)"
echo "  nginx 进程  $(pgrep -c nginx 2>/dev/null || echo '?') 个"

hdr "1. 哪些配置文件提到了 $DOMAIN"
line
# 只看 sites-enabled / conf.d —— 这两个是 Ubuntu 的常规入口
grep -rn "server_name" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null \
  | grep -F "$DOMAIN" || echo "  （没找到 —— 域名可能配在别处，见第 2 步的 nginx -T）"

# ---- 冲突判定（2026-09-23 补）----
# 为什么必须判定、不能只罗列给人看：
#   include /etc/nginx/sites-enabled/*  **没有** `*.conf` 过滤 ⇒ 目录里每个文件都被解析
#   （`.bak` 也算）；而多个文件声明同一个 server_name 时，nginx 只用 glob 字典序里的
#   **第一个**。于是「新加一个文件」会**静默夺走**域名 —— 2026-09-23 实测：仓库那份
#   nginx.conf 的 `location /` 是 `proxy_pass 127.0.0.1:8787`，而 `sites-enabled/forme`
#   排在 `pixel-toy` 前面（f < p）⇒ 照抄 DEPLOY.md §6 会把 Pixel Toys 首页打掉、不报错。
HIT_FILES=$(for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*; do
              [ -f "$f" ] || continue
              grep -q "server_name" "$f" 2>/dev/null || continue
              grep -qF "$DOMAIN" "$f" 2>/dev/null && printf '%s\n' "$f"
            done)
N_HIT=$(printf '%s\n' "$HIT_FILES" | grep -c .)
echo
if [ "$N_HIT" -gt 1 ]; then
  echo "  🔴 $N_HIT 个文件都声明了 $DOMAIN —— 字典序第一个赢，其余被静默忽略："
  printf '%s\n' "$HIT_FILES" | LC_ALL=C sort | sed 's/^/       /'
  echo "     处理：把多余的移出 sites-enabled/（如 /etc/nginx/backups/）→ nginx -t → reload"
else
  echo "  ✅ 只有 $N_HIT 个文件声明该域名，没有「多文件抢同一域名」的问题"
fi
CONFLICTS=$(nginx -t 2>&1 | grep -c "conflicting server name")
if [ "$CONFLICTS" -eq 0 ]; then
  echo "  ✅ nginx -t 里 conflicting server name 条数：0"
else
  echo "  🔴 nginx -t 里有 $CONFLICTS 条 conflicting server name ⇒ include 目录里有重复的 server_name"
fi

hdr "2. 生效的到底是哪些 server 块（nginx -T = 展开 include 后的真实配置）"
line
# -T 会把 include 全部展开，这是唯一能确认「真正生效的是什么」的办法。
# 多站点机器上最典型的坑：配置写进了别人的 server 块，或者根本没被 include。
nginx -T 2>/dev/null | awk '
  /^# configuration file/ { file = $0; sub(/^# configuration file /, "", file) }
  /^[[:space:]]*server[[:space:]]*\{/ { inblk = 1; depth = 0; start = NR; buf = "" }
  inblk {
    # 数括号前先剥掉注释：注释里的 `{` 或 `}` 会把块切错。
    # （本仓库的 nginx.conf 里就有一段被注释掉的 location，括号恰好是配平的 ——
    #   配平是巧合，不配平就会把后面的配置吞进上一个块或提前截断。）
    plain = $0
    sub(/#.*$/, "", plain)
    buf = buf $0 "\n"
    depth += gsub(/\{/, "{", plain) - gsub(/\}/, "}", plain)
    if (depth <= 0) {
      if (buf ~ /server_name/ ) { printf "  ── 文件: %s  (配置第 %d 行起)\n", file, start; printf "%s", buf }
      inblk = 0
    }
  }
' | grep -E "^  ── 文件|server_name|listen|root |proxy_pass|location" | sed 's/^/  /'

hdr "3. /media/ 这条 location 在不在"
line
grep -rn "location /media/" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null \
  || echo "  ❌ 没找到 location /media/ —— 这就是 404 的直接原因"

hdr "4. alias 指向的目录存不存在、里面有多少文件"
line
if [ -d "$SITE_DIR" ]; then
  echo "  ✅ 目录存在：$SITE_DIR"
  echo "  文件数：$(find "$SITE_DIR" -maxdepth 1 -type f | wc -l)"
  echo "  体积：  $(du -sh "$SITE_DIR" 2>/dev/null | cut -f1)"
  ls -la "$SITE_DIR" 2>/dev/null | head -6 | sed 's/^/  /'
else
  echo "  ❌ 目录不存在：$SITE_DIR"
  echo "     ⇒ 即使补上 location，也还得先 rsync 传文件"
fi

hdr "5. 我们的 nginx.conf 有没有被装上去（对比仓库里的那份）"
line
for f in /etc/nginx/sites-enabled/forme /etc/nginx/sites-available/forme; do
  if [ -e "$f" ]; then
    echo "  ✅ $f 存在"
    grep -n "location /media/\|location /api/\|location / " "$f" 2>/dev/null | sed 's/^/     /'
  else
    echo "  ⬜ $f 不存在"
  fi
done
echo "  （如果两个都不存在，但 /api/ 却能通 —— 说明是**别的**配置把 /api/ 代理到 8787 的）"

hdr "6. 谁在监听 8787（我们的 forme-server）"
line
(ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep -E "8787|:80 |:443 " | sed 's/^/  /' \
  || echo "  （拿不到监听表；ss/netstat 可能都要 root）"

hdr "7. 生效配置是不是比 nginx 进程更新（= 改了但没 reload）"
line
NEWEST_CONF=$(find /etc/nginx -name '*.conf' -newer /run/nginx.pid 2>/dev/null | head -5)
if [ -n "$NEWEST_CONF" ]; then
  echo "  ⚠️ 下面这些配置文件比 nginx 主进程新 —— 可能改了没 reload："
  printf '%s\n' "$NEWEST_CONF" | sed 's/^/     /'
else
  echo "  ✅ 没发现「改了没 reload」的迹象（或 /run/nginx.pid 读不到）"
fi

hdr "8. 直接问本机的 nginx：/media/ 会走到哪"
line
# 走本机回环，绕开公网/证书，只测 nginx 的路由决策
echo "  --- HEAD /media/<一个真实文件名> ---"
FIRST=$(find "$SITE_DIR" -maxdepth 1 -type f 2>/dev/null | head -1)
if [ -n "$FIRST" ]; then
  curl -sSI -k "https://127.0.0.1/media/$(basename "$FIRST")" -H "Host: $DOMAIN" 2>/dev/null | head -8 | sed 's/^/  /'
else
  curl -sSI -k "https://127.0.0.1/media/probe" -H "Host: $DOMAIN" 2>/dev/null | head -8 | sed 's/^/  /'
fi
echo "  --- 对照：HEAD /api/health ---"
curl -sS -k "https://127.0.0.1/api/health" -H "Host: $DOMAIN" 2>/dev/null | head -c 300 | sed 's/^/  /'
echo

hdr "结论怎么读"
cat <<'TXT'
  · 第 3 步找到了 location /media/，但第 4 步目录不存在
      ⇒ 只需传文件：rsync -av deploy/media/ root@<host>:/opt/forme/media/

  · 第 3 步没找到 location /media/
      ⇒ 从第 2 步的输出里挑出**服务 pixeltoy.cn 的那个 server 块**，
        往它所在的文件里**追加**（不要整份覆盖）：

            location /media/ {
                alias /opt/forme/media/;
                default_type image/jpeg;   # 文件名没扩展名，不写会发 octet-stream
                autoindex off;
                expires 30d;
                add_header Cache-Control "public, max-age=2592000";
            }

        改前备份：sudo cp -a <那个文件> ~/nginx.bak
        改后：    sudo nginx -t && sudo systemctl reload nginx

  · 第 2 步里 pixeltoy.cn 有**多个** server 块
      ⇒ nginx 只用**第一个**匹配的。要往第一个里加，加进后面的不生效 ——
        这正好能解释「/api/ 通、/media/ 不通」。

  · 第 7 步有输出
      ⇒ 配置早写对了，只是没 reload。sudo nginx -t && sudo systemctl reload nginx
TXT

line
echo "  诊断结束 —— 本脚本没有改动任何东西。"
line
