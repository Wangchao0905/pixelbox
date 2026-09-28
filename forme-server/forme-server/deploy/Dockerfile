# Pixel Box 服务端镜像
# ==================================================================
# 这个服务**没有任何 npm 依赖**（只用 node: 内置模块），
# 所以镜像里不需要 npm install，构建是秒级的，
# 也不存在依赖树投毒、lockfile 漂移这类问题。
#
# 构建：
#   docker build -f deploy/Dockerfile -t forme-server:1.0.0 .
# ==================================================================

FROM node:22-slim

# 时区设成东八区：日志时间与「30 天有效期」的计算都按北京时间看更直观
ENV TZ=Asia/Shanghai
ENV NODE_ENV=production

WORKDIR /app

# 先拷元数据，再拷代码 —— 便于将来真加了依赖时利用层缓存
COPY package.json ./
COPY src ./src

# 用镜像自带的 node 用户（uid 1000）跑，不用 root。
# 这个服务要解析用户上传的图片，被攻破时非 root 能显著限制影响范围。
RUN mkdir -p /app/data && chown -R node:node /app

USER node

# 容器内绑 0.0.0.0 是必须的（否则同网络里的 nginx 容器连不上），
# 安全性由「compose 里不 publish 端口」保证。见 docker-compose.yml。
ENV HOST=0.0.0.0
ENV ALLOW_PUBLIC_BIND=1
ENV PORT=8787
ENV DATA_DIR=/app/data

EXPOSE 8787

# 健康检查直接打业务接口，能同时验证「进程活着」和「配置没写错」
# （/api/health 的 ok 字段在配置有问题时是 false）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>r.json()).then(d=>process.exit(d.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.mjs"]
