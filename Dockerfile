# syntax=docker/dockerfile:1
#
# 前端镜像 —— 只干两件事：vite build，然后用 nginx 把静态产物发出去。
#
# ── 拓扑（入口 nginx 在后端仓库的 docker-compose.yml 里）────────────────
#
#   浏览器 ──▶ nginx :80       后端 compose 的 nginx 服务：官方镜像 + 只读挂载
#              │                deploy/nginx/default.conf，负责 /api、探针、SSE、XFF
#              ├─ /api/ /health /ready /metrics ──▶ api:8000
#              └─ 其余（/、/assets/…）───────────▶ web:80  ← 本镜像（纯静态服务器）
#
# 所以这个镜像里**没有** /api 反代、没有 client_max_body_size、没有 XFF 处理：
# 那些是入口 nginx 一个人的事。这里只做静态站该做的事 —— 资源长缓存、
# index.html 不缓存、SPA 的 try_files 回退（入口 nginx 的注释里也是这么分工的）。
#
# 构建由后端 compose 的 web 服务完成（context: ${FRONTEND_DIR}、dockerfile: Dockerfile），
# 手动构建只用于排障：
#     docker build -t my-agent-api-web:latest .
#
# ⚠️ FRONTEND_DIR 默认是 ../frontend。前端仓库目录名是 my-ai-chat-app 的话，要在后端
#    .env 里加一行 FRONTEND_DIR=../my-ai-chat-app，否则 compose 找不到这个 Dockerfile。
#
# ⚠️ 最终镜像必须监听 80：入口 nginx 的 upstream 写死了 server web:80。
#
# ⚠️ 不需要任何编译期环境变量：接口走同源相对路径 /api（src/api/client.js），
#    由入口 nginx 反代过去，所以后端 compose 里那个 VITE_API_BASE 构建参数用不上。
#
# 需要 BuildKit：下面 npm 依赖那层的缓存挂载（--mount=type=cache）依赖它，
# docker compose v2 默认就是 BuildKit。

# ── 阶段 1：构建静态产物 ─────────────────────────────────────────────
# 用 node:24-slim（Debian/glibc）而不是 alpine：package-lock 里有一批带预编译二进制
# 的原生依赖（rolldown、oxlint 等），glibc 上是官方支持的主线；换成 musl 就得指望
# npm 的 optionalDependencies 恰好兜住，不值得为省几十 MB 冒这个险。
# 24.x 满足 package.json 的 engines（^22.18.0 || >=24.12.0）。
FROM node:24-slim AS build

WORKDIR /app

# 关掉 npm 的更新提示 / 审计 / 募捐输出，日志只留真正有用的部分
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# 依赖单独一层：先只拷这两个文件再装依赖，这样只改 src/ 时这层命中缓存，
# 不会重装 node_modules（如果把 COPY . . 放在前面，这个效果就没了）。
COPY package.json package-lock.json ./

# 用 npm ci 而不是 npm install —— 严格按 package-lock.json 装，避免服务器上装出与
# 本地不同的依赖版本（"我本地是好的"最常见的来源）。
# 缓存挂载让重复构建复用 npm 下载缓存（首次构建照旧要联网拉包）；
# 拉包慢（国内）时可以 --build-arg NPM_REGISTRY=https://registry.npmmirror.com。
ARG NPM_REGISTRY=""
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
    && npm ci --no-audit --no-fund

COPY . .

# 只跑 vite build（= npm run build-only，跳过 vue-tsc）。想让类型错误也拦住发版，
# 就在后端 compose 的 web.build.args 里加 RUN_TYPE_CHECK: "true"。
ARG RUN_TYPE_CHECK=false
RUN if [ "$RUN_TYPE_CHECK" = "true" ]; then npm run build; else npm run build-only; fi

# 产物自检：万一构建"成功"但 dist 是空的（入口路径写错之类），在构建阶段就红掉，
# 而不是部署完才发现静态站一律 404。
RUN test -f dist/index.html || { echo "构建产物缺失：dist/index.html"; exit 1; }

# ── 阶段 2：运行时（纯静态服务器）────────────────────────────────────
# 1.30 是 nginx 当前的 stable 线（主线 1.31；1.27/1.28 已是 legacy 线）。
# 这个 tag 跟着同线最新补丁走，重建镜像即拿到安全更新；拉不到就换 nginx:stable-alpine。
# upstream 里写的是 web:80，所以这里固定监听 80（alpine 版自带的 busybox wget
# 正好给 HEALTHCHECK 用，不用装 curl）。
FROM nginx:1.30-alpine

LABEL org.opencontainers.image.title="my-ai-chat-app" \
      org.opencontainers.image.description="智能客服工作台前端：Vite 构建产物 + 静态 nginx（监听 80，/api 由入口 nginx 反代）"

# 内置站点配置：从 deploy/static-nginx.conf 用普通 COPY 打进镜像。
#
# ⚠️ 它以前是 `COPY <<'CONF' ... CONF` 内嵌在本文件里的。改成独立文件的原因很实际：
#    heredoc 需要 Dockerfile 前端 >= 1.4，而第 1 行 `# syntax=docker/dockerfile:1` 会让
#    BuildKit 去镜像仓库拉一份前端镜像 —— 如果拉到的是一份旧缓存（国内镜像源里很常见），
#    heredoc 就退化成普通参数，构建报 `unknown instruction: server` 这种莫名其妙的错
#    （而 --mount 只需要 1.2，所以它照常通过，更难判断）。
#    普通 COPY 对前端版本没有任何要求，从根上消掉这个不确定性。
#
# 这份配置**不读**仓库里那份 deploy/nginx.conf —— 那份是旧单机部署的「入口配置」
# （含 /api 反代），在新拓扑里由后端 compose 的 nginx 服务承担。
COPY deploy/static-nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

# 配置语法在构建阶段就校验：写错了这里直接失败，不会等到线上 nginx 起不来、
# 在 restart: unless-stopped 下无限重启（那画面很难查）。
# 前半句是防呆：万一哪天有人把 static-nginx.conf 又拷回本文件里内嵌、
# 而忘了给定界符加引号，$uri 会在构建期被展开成空串 —— 那种配置 nginx -t
# 未必报错，却会静默失效，所以干脆断言变量还在。
RUN grep -q 'try_files \$uri \$uri/ /index.html;' /etc/nginx/conf.d/default.conf \
    && nginx -t

# 只暴露 80，不对宿主机发布端口 —— 入口 nginx 在同网络里用服务名 web:80 访问。
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

# nginx 官方镜像已声明 STOPSIGNAL SIGQUIT，docker stop 时会优雅退出，这里不重复声明。
CMD ["nginx", "-g", "daemon off;"]
