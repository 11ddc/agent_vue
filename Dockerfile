# 智能客服工作台前端 —— 生产镜像
#
# 两阶段：Node 里构建静态产物 → 拷进 nginx。最终镜像里没有源码、没有 node_modules，
# 只有 dist + 一份 nginx 配置。
#
# 手动构建（在 my-ai-chat-app 目录下）：
#     docker build -t my-ai-chat-web:latest .
# 想连类型检查（vue-tsc）一起跑，更严但更容易因为一个类型报错让部署失败：
#     docker build --build-arg RUN_TYPE_CHECK=true -t my-ai-chat-web:latest .
#
# ⚠️ 前端**不需要**任何编译期环境变量：接口地址是相对路径 `/api`（见 src/api/client.js），
#    由 nginx 反代到后端容器。换后端地址只改 deploy/nginx.conf，不用重新构建前端。

# ── 构建阶段 ─────────────────────────────────────────────────
FROM node:24-slim AS build
WORKDIR /app

# 依赖单独一层：只改 src/ 时这一层命中缓存，不会重装 node_modules。
# 用 npm ci 而不是 npm install —— 严格按 package-lock.json 装，避免服务器上装出
# 与本地不同的依赖版本（"我本地是好的"最常见的来源）。
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG RUN_TYPE_CHECK=false
RUN if [ "$RUN_TYPE_CHECK" = "true" ]; then npm run build; else npm run build-only; fi

# ── 运行阶段 ─────────────────────────────────────────────────
FROM nginx:1.27-alpine

# 站点配置 + /api 反代规则；upstream 用 compose 里的服务名 api
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# 只对外暴露 80。后端 8000 不需要映射出来 —— 由 nginx 在同源下反代。
EXPOSE 80

# busybox wget 自带的，不用额外装 curl
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
