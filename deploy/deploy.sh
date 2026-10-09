#!/usr/bin/env bash
#
# 一键部署 / 更新（在服务器上执行）
#
#   bash my-ai-chat-app/deploy/deploy.sh
#
# 前置条件：
#   1) 两个仓库在**同一个父目录**下：<父目录>/my-agent-api 与 <父目录>/my-ai-chat-app
#   2) my-agent-api/.env 已按 DEPLOY.md 第 3 步准备好（含 MYSQL_ROOT_PASSWORD）
#   3) 已装 docker + docker compose v2
#
# 幂等：重复执行 = 重新构建 + 重启。数据都在具名卷（mysql_data / redis_data /
# app_data / bm25_cache）和宿主机目录（chroma_db / knowledge_base）里，不会丢。
# 更新流程：两个仓库各 git pull 一次，再跑本脚本。
#
# 用 `bash xxx.sh` 运行，不要 `sh xxx.sh`（脚本用了 bash 的 set -o pipefail）。

set -euo pipefail

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # .../my-ai-chat-app
ROOT_DIR="$(dirname "$WEB_DIR")"                             # 两个仓库的父目录
API_DIR="$ROOT_DIR/my-agent-api"

PROJECT=aichat                 # 后端 compose 项目名 → 网络 aichat_default
NETWORK="${PROJECT}_default"
WEB_PROJECT=aichat-web

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  !! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m!! %s\033[0m\n\n' "$*" >&2; exit 1; }

# ── 0. 前置检查 ──────────────────────────────────────────────────────────
[ -d "$API_DIR" ] || die "找不到后端目录：$API_DIR
   两个仓库必须放在同一个父目录下，形如：
       /opt/aichat/my-agent-api
       /opt/aichat/my-ai-chat-app"
[ -f "$API_DIR/.env" ] || die "找不到 $API_DIR/.env
   .env 不进 git（里面有真实 API key），必须手动放上去。见 DEPLOY.md 第 3 步。"
command -v docker >/dev/null 2>&1 || die "没装 docker"
command -v curl   >/dev/null 2>&1 || die "没装 curl（自检要用；apt install curl / yum install curl）"
docker compose version >/dev/null 2>&1 || die "没有 docker compose 插件（需要 v2；v1 的 docker-compose 命令不能用）"

# 后端 compose 里这两项是 ${VAR:?} 强校验，缺了 compose 直接报错。
grep -qE '^[[:space:]]*MYSQL_ROOT_PASSWORD=' "$API_DIR/.env" \
    || die ".env 里缺 MYSQL_ROOT_PASSWORD（compose 用它初始化 mysql，缺了直接拒绝启动）"
grep -qE '^[[:space:]]*MYSQL_PASSWORD=' "$API_DIR/.env" \
    || die ".env 里缺 MYSQL_PASSWORD（compose 用它建业务账号并拼 MYSQL_URL）"

# 后端 AUTH_ENABLED 默认是 **true**，而前端一个 token 都不带 → 页面会一直 401。
# 这里不当场拒绝（将来加了登录页就该开认证），但必须让人看见。
if grep -qE '^[[:space:]]*AUTH_ENABLED=' "$API_DIR/.env"; then
    log "认证开关：$(grep -E '^[[:space:]]*AUTH_ENABLED=' "$API_DIR/.env" | tr -d '\r')"
else
    warn ".env 里没有 AUTH_ENABLED —— 默认值是 true，而当前前端没有登录页，"
    warn "页面会一直报「缺少访问令牌（Authorization: Bearer <token>）」。"
    warn "先在 .env 里显式写一行 AUTH_ENABLED=0（见 DEPLOY.md 第 3 步）。"
fi

# ── 1. 宿主机目录与属主 ──────────────────────────────────────────────────
# 容器里的 api 以 uid=10001 运行。bind mount 的目录如果由 Docker 自动创建，
# 属主是 root，结果就是上传文档时 Permission denied（422/500，日志里一行 PermissionError）。
log "准备运行时目录并修正属主（容器内 uid=10001）"
mkdir -p "$API_DIR"/knowledge_base \
         "$API_DIR"/chroma_db \
         "$API_DIR"/bm25_cache \
         "$API_DIR"/data \
         "$API_DIR"/logs \
         "$API_DIR"/embbding_models

SUDO=""
[ "$(id -u)" = "0" ] || SUDO="sudo"
$SUDO chown -R 10001:10001 "$API_DIR"/knowledge_base "$API_DIR"/chroma_db

if [ -d "$API_DIR/embbding_models/bge-small-zh-v1.5" ]; then
    log "本地 embedding 模型已就位（离线可用）"
else
    warn "没找到 embbding_models/bge-small-zh-v1.5 —— 首次向量化时会去 hf-mirror 下载约 90MB，"
    warn "首次提问/上传会明显变慢。传模型的命令见 DEPLOY.md 第 4 步。"
fi

# ── 2. 后端：mysql + redis + api ─────────────────────────────────────────
log "构建并启动后端（首次要装 torch，几分钟到十几分钟）"
( cd "$API_DIR" && docker compose -p "$PROJECT" up -d --build )

log "等待 api 健康检查通过"
api_id="$( cd "$API_DIR" && docker compose -p "$PROJECT" ps -q api )"
[ -n "$api_id" ] || die "api 容器没起来。看日志：cd $API_DIR && docker compose -p $PROJECT logs api"

state="unknown"
for _ in $(seq 1 90); do
    state="$(docker inspect -f '{{.State.Health.Status}}' "$api_id" 2>/dev/null || echo unknown)"
    # 刻意写成 if 而不是 `[ ... ] && break`：set -e 下这种 && 链的退出语义很绕，
    # 一旦哪天在末尾多加一条命令就会变成"测试失败 → 脚本静默退出"。
    if [ "$state" = "healthy" ]; then
        break
    fi
    if [ "$state" = "unhealthy" ]; then
        warn "api 健康检查失败，最近日志："
        ( cd "$API_DIR" && docker compose -p "$PROJECT" logs --tail 60 api ) || true
        die "先修上面的报错再重跑本脚本"
    fi
    printf '.'
    sleep 5
done
printf '\n'
if [ "$state" != "healthy" ]; then
    warn "等了约 7 分钟 api 仍不是 healthy（当前：$state），继续往下走，但请检查日志"
fi

# ── 3. 数据库表结构 ──────────────────────────────────────────────────────
# 幂等；不建表的话上传文档会在写父块时炸掉。容器内的 MYSQL_URL 已被 compose
# 覆盖成 mysql:3306，所以这里不用管 .env 里那行指向 127.0.0.1 的地址。
log "初始化 MySQL 表结构（幂等）"
( cd "$API_DIR" && docker compose -p "$PROJECT" exec -T api python -m db.init_schema )

# 存量文档的 ACL 回填：幂等，空库时是 no-op。失败不阻断部署（常见于首次、空库）。
log "回填文档 ACL（幂等）"
( cd "$API_DIR" && docker compose -p "$PROJECT" exec -T api python -m rag.acl_backfill ) \
    || warn "ACL 回填失败；如果知识库还是空的可以忽略，否则看 DEPLOY.md 排障表"

# ── 4. 前端：nginx ───────────────────────────────────────────────────────
docker network inspect "$NETWORK" >/dev/null 2>&1 \
    || die "docker 网络 $NETWORK 不存在，说明后端没按 -p $PROJECT 启动过"

log "构建并启动前端（nginx）"
( cd "$WEB_DIR/deploy" && docker compose -p "$WEB_PROJECT" up -d --build )

# ── 5. 自检 ──────────────────────────────────────────────────────────────
log "自检（/health 与 /ready 是经 nginx 反代打到后端的，顺带验证了代理链路）"
sleep 3

for path in / /health /ready; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1${path}" || true)"
    printf '   %-9s -> HTTP %s\n' "$path" "${code:-000}"
    if [ "$path" = "/" ] && [ "${code:-000}" != "200" ]; then
        warn "首页没返回 200，看日志：cd $WEB_DIR/deploy && docker compose -p $WEB_PROJECT logs web"
    fi
done

health="$(curl -fsS --max-time 10 http://127.0.0.1/health 2>/dev/null || true)"
case "$health" in
    *'"auth_enabled": true'*|*'"auth_enabled":true'*)
        warn "认证已开启（auth_enabled=true）：当前前端没有登录页，页面会一直提示缺少令牌。"
        warn "要么在 .env 写 AUTH_ENABLED=0 后重启 api，要么先给前端补一个登录页。" ;;
    *'"auth_enabled": false'*|*'"auth_enabled":false'*)
        log "认证关闭（auth_enabled=false）：前端不带 token 即可用。"
        warn "这意味着公网上任何人都能调用你的 LLM key、往知识库传文档 ——"
        warn "请务必做 DEPLOY.md「安全加固」里的 Basic 认证或 HTTPS + 登录页。" ;;
    *)
        warn "没能从 /health 读出 auth_enabled，原始返回：${health:-<空>}" ;;
esac

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')" || true
log "部署完成"
cat <<EOF
   浏览器打开： http://${LAN_IP:-<服务器IP>}/
   后端日志：   cd $API_DIR && docker compose -p $PROJECT logs -f api
   前端日志：   cd $WEB_DIR/deploy && docker compose -p $WEB_PROJECT logs -f web

   提醒：知识库为空时，问什么都会回「没有找到相关资料」。上传入口在页面右栏
   （单文件 ≤50MB，支持 pdf/txt/md/docx/xlsx/xlsm）。
EOF
