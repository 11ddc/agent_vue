# 智能客服工作台 — 前端文档

一个屏幕完成两件事：**左边和后端对话，右边把文档传进知识库**。上传的资料会被后端解析、切块、向量化，立刻参与后续回答。

后端项目：[`F:\my-agent-api`](../my-agent-api)（FastAPI + LangGraph + Chroma + BM25 混合检索，本文档只描述前端）。

| | |
|---|---|
| 技术栈 | Vue 3 · Vue Router · Pinia · Axios · Vite 8 |
| 后端依赖 | 需要 `my-agent-api` 跑在 `127.0.0.1:8000`（前端不提供任何 mock 数据） |
| 测试 | 22 个单元用例，全部离线（不连后端） |

---

## 快速启动

```bash
npm install
npm run dev          # http://localhost:5173
```

另外开一个终端把后端拉起来：

```bash
cd F:\my-agent-api
venv\Scripts\activate
python main.py       # uvicorn 监听 127.0.0.1:8000
```

请求链路：前端 `/api/xxx` → Vite 代理（`vite.config.ts` 的 `server.proxy`）→ `http://127.0.0.1:8000/api/xxx`。

> `npm run dev` 和 `npm run build` 都必须在**你自己的终端**里跑。`npm run build` 用的是 `run-p`，它依赖管道 stdio 起子进程；在受限沙箱环境里会报 `spawn EPERM`，这是环境限制而不是项目问题。

---

## 目录结构

```
src/
├── api/
│   ├── client.js          # axios 实例（baseURL=/api）+ 错误信息翻译
│   ├── chat.js            # 聊天封装：SSE 流式 + 同步降级 + 手写 SSE 解析器
│   ├── chat.spec.js       # SSE 解析 / 请求体的单元测试
│   └── knowledge.js       # 知识库上传封装 + 本地预检
├── stores/
│   ├── chat.js            # 会话、消息、流式增量、中断、降级（Pinia）
│   ├── chat.spec.js       # 降级规则 / reset / 停止 的单元测试
│   └── knowledge.js       # 上传队列与两阶段进度（Pinia）
├── components/
│   ├── AppHeader.vue      # 顶栏：标题、接口文档链接、运行状态、重置会话
│   ├── ChatPanel.vue      # 左栏：聊天界面
│   └── KnowledgePanel.vue # 右栏：知识库上传
├── views/
│   └── HomeView.vue       # 一屏两栏布局（grid，窄屏自动堆叠）
├── router/index.ts        # 单路由
├── App.vue                # 根组件
└── main.ts                # 应用入口
```

---

## 后端接口契约

三个接口都在 `my-agent-api` 里，前端只用这三个。

### `POST /api/chat` — 同步对话

请求：`{ message: string, session_id?: string }`

响应：`{ answer, session_id, intent?, method?, handoff? }`

### `POST /api/chat/stream` — 流式对话（SSE）

请求体同上。注意这是 **POST**，所以不能用 `EventSource`（它只支持 GET、不能带 body），前端用 `fetch` + `ReadableStream` 自己解析 SSE 帧。

事件类型（`data` 是 JSON）：

| `type` | 字段 | 含义 |
|---|---|---|
| `status` | `stage`, `text` | 阶段提示，如「正在检索知识库…」 |
| `delta` | `content` | 正文增量（真 token） |
| `reset` | `reason` | **作废前面已推送的正文**，后面会重推完整答案 |
| `meta` | `session_id`, `intent`, `method` | 结构化元信息 |
| `done` | — | 正常结束 |
| `error` | `message` | 编排图执行失败 |

### `POST /api/upload` — 上传文档到知识库

multipart，字段名必须是 **`file`**。支持 `.pdf .txt .md .docx .xlsx .xlsm`，单个文件 ≤ 50 MB。落盘到 `my-agent-api/knowledge_base/`，随后**同步**跑完「解析 → 切块 → embedding → 入库」，所以这个接口很慢。

成功：`{ success: true, filename, document_count }`

失败有三种形态，前端全部做了区分处理：

| 情况 | HTTP | 响应体 |
|---|---|---|
| 类型不支持 | 200 | `{ success: false, error: "..." }` |
| 文件过大 | 413 | `{ detail: "文件过大（...）" }` |
| 文件名非法 | 400 | `{ detail: "非法文件名: ..." }` |

---

## 关键设计

### 1. 流式为主，同步兜底

`/api/chat/stream` 和 `/api/chat` 走的是后端**同一张 LangGraph 编排图**，答案内容一致，差别只在交付方式。前端默认走流式（首字快很多，后端精排 p90 就有 5.8 秒），失败时退回同步。

降级规则写在 `stores/chat.js`，只有一条：

> **最终一个字都没有 → 退回 `/api/chat`；已经吐过正文 → 绝不重跑。**

第二条是关键。后端一次问答有副作用（写 Redis 会话历史、累计转人工计数），流中途断线后再重跑一遍，用户会看到两遍答案，后端也会把同一句话重复计进历史。所以这种情况只保留已收到的部分并标注「回答被中断」。

### 2. `session_id` 的传法

后端定义是 `session_id: str = Field(default_factory=uuid4)` —— 可以不给，但一旦给了就不能是 `null`。所以前端**省略这个键**而不是传 `undefined`/`null`（传 `null` 会被 pydantic 拒掉）。会话 id 存在 `sessionStorage`，刷新页面仍延续同一段上下文；「新会话」= 换一个 id，等于让后端换一段历史。

### 3. 上传为什么要分两个阶段显示

`uploading`（浏览器发字节，有真实百分比）和 `indexing`（后端解析+向量化，**拿不到任何进度**）。`onUploadProgress` 到 100% 只代表第一阶段结束，如果那时还显示进度条，界面会在 100% 干挂着像卡死。所以第二阶段换成流动条纹 + 「服务端正在解析、切块并写入向量库…」的文案。

上传是**串行**的（选多个文件也是一次一个）：每个文件都会让后端跑一遍重活，并发提交只会互相抢 CPU 和向量库。

### 4. 答案按纯文本渲染

后端返回的是 markdown 文本（含列表、表格）。前端目前用 `white-space: pre-wrap` 原样显示，**不注入 HTML**——没有引入渲染库，也就没有 XSS 面。代价是表格不是表格的样子。要改的话建议上 `marked` + `dompurify`（两者都还没装）。

---

## 测试

```bash
npm run test:unit
```

覆盖最容易出错的两块手写逻辑：

- `src/api/chat.spec.js` —— SSE 解析器（跨分片、ping 注释行、CRLF、多行 `data`、末帧无换行、非 JSON 兜底），以及请求体是否带 `session_id`、URL 是否带 `/api` 前缀、错误体的 `detail` 是数组时能不能正常读出来。
- `src/stores/chat.spec.js` —— 降级规则（无正文才重跑、有正文不重跑）、`reset` 事件清空旧 token、用户点停止保留部分内容、`session_id` 的存取。

不依赖后端、Redis 或任何外部服务。

---

## 关于被删掉的商城 demo

这个前端原本是一个电商展示 demo（首页 Banner、商品网格、商品详情页、假登录注册、右下角客服浮窗），数据全部由前端 `mock.js` 伪造。

现在整站只剩客服工作台，相关文件已删除：

`api/mock.js`、`components/{ChatWidget,ProductCard,LoginModal,RegisterModal,HelloWorld,TheWelcome,WelcomeItem}.vue`、`components/icons/`、`stores/{auth.js,counter.ts}`、`views/{AboutView,ProductDetail}.vue`、`assets/{base.css,logo.svg}`

> 删除前打过一份备份：`_backup_before_chat_refactor.zip`（在项目根目录）。这个前端目录**不是 git 仓库**，删除不可回滚，所以留了这份压缩包。确认不需要后可以直接删掉它。

假登录注册被一并移除的原因是它依赖 `mock.js`，而后端没有任何认证接口——留着会是个看起来能用、实际连着空气的入口。
