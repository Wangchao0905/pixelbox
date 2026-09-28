#!/usr/bin/env bash
# Pixel Box 支付回调连通性验证
# ==================================================================
# 用法：./deploy/verify-notify.sh https://你的域名/api/pay/notify [消息推送Token]
#
# 为什么需要单独验证这一步：
#   回调地址配错不会立刻报错。表现是「用户付了钱，但点数永远不到账」，
#   而你要等到有真实用户投诉才会发现。所以上线前必须主动验一次。
#
# 两个参数都验：
#   POST —— 平台推发货/退款消息走这条
#   GET  —— MP 后台「消息推送」点保存时的 URL 验证走这条
#   两者是独立的代码路径，POST 通了不代表 GET 通。给了 Token 才会验 GET。
#
# 注意：本脚本只能验证「路径存在且响应格式正确」。
# 真正的端到端验证必须用真机走一笔真实支付（见 DEPLOY.md 第 8 节）。
# ==================================================================

set -u

URL="${1:-}"
TOKEN="${2:-}"

if [ -z "$URL" ]; then
  echo "用法：$0 https://你的域名/api/pay/notify [消息推送Token]"
  echo "     第二个参数填 MP 后台「消息推送」里那个 Token，才能顺便验 URL 验证握手。"
  exit 2
fi

echo "验证回调地址：$URL"
echo "────────────────────────────────────────────────────────"

# 用一段无法解析的 XML 当作载荷：我们只关心「路径是否存在、响应格式是否正确」，
# 不关心业务处理结果。真实的推送带签名，本地无法伪造。
#
# 响应体与状态码一次取回，不落临时文件 —— 避免 Windows 上 Git Bash 的
# /tmp 与 curl（原生 Windows 程序）看到的路径不是同一个位置。
POST_URL="$URL"
if [ -n "$TOKEN" ]; then
  POST_TS=$(date +%s)
  POST_NONCE=$RANDOM
  POST_SIG=$(printf '%s\n' "$TOKEN" "$POST_TS" "$POST_NONCE" \
    | LC_ALL=C sort | tr -d '\n' | sha1sum | cut -d' ' -f1)
  POST_URL="$URL?signature=$POST_SIG&timestamp=$POST_TS&nonce=$POST_NONCE"
fi

RESPONSE=$(curl -s \
  --noproxy '*' \
  --max-time 15 \
  -X POST "$POST_URL" \
  -H 'Content-Type: application/xml' \
  --data '<xml><Test>preflight</Test></xml>' \
  -w '\n%{http_code}' 2>/dev/null)

CURL_EXIT=$?
HTTP_CODE=$(printf '%s' "$RESPONSE" | tail -n1)
BODY=$(printf '%s' "$RESPONSE" | sed '$d')

if [ $CURL_EXIT -ne 0 ]; then
  echo "❌ 请求失败（curl 退出码 $CURL_EXIT）"
  echo ""
  case $CURL_EXIT in
    6)  echo "   域名解析失败。检查 DNS 是否已指向服务器公网 IP。" ;;
    7)  echo "   连接被拒绝。检查服务是否已启动、nginx 是否在监听 443。" ;;
    28) echo "   请求超时。检查防火墙 / 安全组是否放行 443。" ;;
    60) echo "   TLS 证书验证失败。证书可能未生效或已过期。" ;;
    *)  echo "   检查网络、防火墙与证书。" ;;
  esac
  exit 1
fi

echo "HTTP 状态码：$HTTP_CODE"
echo "响应体：${BODY:-（空）}"
echo ""

case "$HTTP_CODE" in
  200)
    if echo "$BODY" | grep -q '<xml>'; then
      echo "✅ 通过：路径存在，返回了平台要求的 XML 格式。"
      echo ""
      echo "   注意：响应里的 ErrCode 非 0 是正常的 ——"
      echo "   我们发的是伪造载荷，服务端认不出订单，这是预期行为。"
      echo "   关键是它**没有返回 404**，说明路径配对了。"
    else
      echo "⚠️  HTTP 200 但响应体不是 XML：$BODY"
      echo "   平台的推送要求响应体为 XML，请检查 nginx 是否改写了响应。"
      exit 1
    fi
    ;;
  403)
    if [ -z "$TOKEN" ]; then
      echo "✅ 未签名的 POST 被拒绝；传入 Token 可验证完整的签名路径。"
    else
      echo "❌ 已签名的 POST 被拒绝。核对 Token 与服务端配置。"
      exit 1
    fi
    ;;
  404)
    echo "❌ 404：路径不存在。这是最常见的配置错误。"
    echo ""
    echo "   检查 WECHAT_PAY_NOTIFY_URL 是否漏掉了 /api："
    echo "     错误：https://域名/pay/notify"
    echo "     正确：https://域名/api/pay/notify"
    exit 1
    ;;
  502|503|504)
    echo "❌ $RESPONSE：nginx 起来了，但连不上后端。"
    echo "   检查 forme-server 是否在 127.0.0.1:8787 上运行："
    echo "     curl http://127.0.0.1:8787/api/health"
    exit 1
    ;;
  301|302)
    echo "❌ $RESPONSE：发生了跳转。回调地址不能跳转（平台不跟随重定向）。"
    echo "   检查 nginx 是否把 https 又跳了一次，或域名写成了 http。"
    exit 1
    ;;
  *)
    echo "❌ 非预期状态码 $RESPONSE。"
    exit 1
    ;;
esac

echo ""
echo "────────────────────────────────────────────────────────"

# ── 消息推送的 URL 验证握手（GET）────────────────────────────────
# 后台「消息推送」点保存时走的就是这一跳：微信发 GET 带 signature/timestamp/
# nonce/echostr，服务端验签后**原样返回 echostr**。答不上来后台直接报
# 「配置失败」，配置根本存不下去，发货与退款推送都永远配不上。
#
# 这一跳和上面的 POST 是两条独立路径，POST 通了不代表它通 —— 必须单独验。
if [ -z "$TOKEN" ]; then
  echo "⚠️  没给 Token，跳过 URL 验证握手（GET）的检查。"
  echo "   建议补上第二个参数，它是后台能否保存配置的关键："
  echo "     $0 $URL <消息推送Token>"
else
  echo "验证 URL 验证握手（GET）："
  TS=$(date +%s)
  NONCE=$RANDOM
  ECHOSTR="verify_${TS}_${NONCE}"

  # 字典序排序必须用 LC_ALL=C：默认 locale 的排序规则不是字节序，
  # 可能把字母排到数字前面，算出来的 sha1 就和服务端（按 ASCII 排）不一致。
  SIG=$(printf '%s\n' "$TOKEN" "$TS" "$NONCE" \
    | LC_ALL=C sort | tr -d '\n' | sha1sum | cut -d' ' -f1)

  HANDSHAKE=$(curl -s \
    --noproxy '*' \
    --max-time 15 \
    "$URL?signature=$SIG&timestamp=$TS&nonce=$NONCE&echostr=$ECHOSTR" \
    -w '\n%{http_code}' 2>/dev/null)

  HS_EXIT=$?
  HS_CODE=$(printf '%s' "$HANDSHAKE" | tail -n1)
  HS_BODY=$(printf '%s' "$HANDSHAKE" | sed '$d')

  if [ $HS_EXIT -ne 0 ]; then
    echo "❌ 握手请求失败（curl 退出码 $HS_EXIT）"
    exit 1
  fi

  if [ "$HS_CODE" = "200" ] && [ "$HS_BODY" = "$ECHOSTR" ]; then
    echo "✅ 通过：验签成功，且原样返回了 echostr —— 后台点保存能存下去。"
  else
    echo "❌ 握手失败：状态码 $HS_CODE"
    echo "   期望响应体：$ECHOSTR"
    echo "   实际响应体：${HS_BODY:-（空）}"
    echo ""
    case "$HS_CODE" in
      403) echo "   Token 不一致：.env 里的 WECHAT_MSG_TOKEN 必须与后台「消息推送」里填的逐字相同。" ;;
      503) echo "   服务端没配 WECHAT_MSG_TOKEN。填好 .env.local 后重启服务。" ;;
      404) echo "   GET 没被接住：服务端版本较旧，或 nginx 只转发了 POST。" ;;
      400) echo "   服务端认为参数不全，或版本较旧。" ;;
      *)   echo "   检查 nginx 是否改写了响应体 —— echostr 必须原样返回，不能加引号或换行。" ;;
    esac
    exit 1
  fi
fi

echo ""
echo "────────────────────────────────────────────────────────"
echo "下一步：用真机走一笔真实支付，确认点数真的到账。"
echo "只验证路径可达是不够的 —— 签名、AppKey、道具配置错了同样收不到货。"
