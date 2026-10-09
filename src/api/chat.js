import api, { ensureAccessToken, refreshAccessToken } from './client.js'

/**
 * 聊天接口封装。后端同时提供两条链路（见 my-agent-api/api/chat.py）：
 *
 *   POST /api/chat         同步：一次返回完整 answer
 *   POST /api/chat/stream  流式：SSE，事件类型 status / delta / reset / meta / done / error
 *
 * 两条走的是**同一张 LangGraph 编排图**，答案内容一致，差别只在交付方式。
 *
 * ## 鉴权（两条链路都要令牌）
 * 后端两条链路都挂了 `Depends(require_user)`。同步那条走 axios 实例，令牌由
 * client.js 的请求拦截器统一注入；**流式这条必须自己带头** —— 它用的是原生 `fetch`，
 * 拦截器完全够不着。这是最容易漏的一处：axios 侧改好了，SSE 依旧 401。
 *
 * 关于 session_id：后端把它定义成 `str = Field(default_factory=uuid4)`，
 * 也就是"可以不给、但一旦给了就不能是 null"。所以没有会话时我们必须**省略这个键**，
 * 而不是传 undefined/null —— JSON.stringify 会丢掉值为 undefined 的键，
 * 传 null 则会被 pydantic 拒掉（none is not an allowed value）。
 */

// 必须带 /api 前缀：Vite 只代理 '/api'（见 vite.config.ts 的 server.proxy），
// 少了前缀 fetch 会打到开发服务器自身的 5173 上，直接 404。
const API_BASE = '/api'
const STREAM_PATH = `${API_BASE}/chat/stream`
const SYNC_PATH = '/chat' // 走 axios 实例，它的 baseURL 已经是 '/api'

function buildBody(message, sessionId) {
  const body = { message }
  if (sessionId) body.session_id = sessionId
  return body
}

/**
 * 解析一段 SSE 文本流，逐帧回调。
 *
 * 为什么不直接用 EventSource：EventSource 只支持 GET、不能带请求体，
 * 而后端这个接口是 POST + JSON body，所以只能用 fetch 读 ReadableStream 自己解析。
 *
 * 需要处理的 SSE 细节：
 *   - 帧与帧之间用**空行**分隔，字段行是 `field: value`（冒号后可能有一个空格）
 *   - `data:` 可以出现多次，按规范要用 \n 拼起来（后端把整个事件 JSON 编码进单行，
 *     所以正文里的换行是转义过的，不会把一条 data 拆成多行）
 *   - 以 `:` 开头的是注释，sse_starlette 的 ping=15 心跳就是这种，必须忽略
 *   - 网络分片不保证落在行边界上，所以必须自己缓冲、按 \n 切
 */
export function createSSEParser(onEvent) {
  let buffer = ''
  let eventName = null
  let dataLines = []

  function dispatch() {
    if (dataLines.length === 0) {
      eventName = null
      return
    }
    const raw = dataLines.join('\n')
    let payload
    try {
      payload = JSON.parse(raw)
    } catch {
      // 兜底：后端约定 data 一定是 JSON，真解析不了就当成纯文本 delta，别把内容丢了
      payload = { type: eventName || 'message', content: raw }
    }
    eventName = null
    dataLines = []
    onEvent(payload)
  }

  function handleLine(line) {
    if (line === '') {
      dispatch()
      return
    }
    if (line.startsWith(':')) return // 注释 / 心跳
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') eventName = value
    else if (field === 'data') dataLines.push(value)
  }

  return {
    feed(text) {
      buffer += text
      let idx
      while ((idx = buffer.indexOf('\n')) !== -1) {
        handleLine(buffer.slice(0, idx).replace(/\r$/, ''))
        buffer = buffer.slice(idx + 1)
      }
    },
    /** 流结束时的收尾：最后一帧可能没有结尾换行 */
    close() {
      if (buffer) {
        handleLine(buffer.replace(/\r$/, ''))
        buffer = ''
      }
      dispatch()
    },
  }
}

/**
 * 流式对话。onEvent 会收到后端原样推来的事件对象。
 *
 * @returns {Promise<{ sessionId: string|null, sawDelta: boolean, done: boolean }>}
 *          调用方靠 sawDelta 判断"有没有已经吐过正文"——这决定了失败时
 *          能不能安全地退回同步接口重跑（已经吐过就不能重跑，否则答案会重复两遍）。
 */
export async function streamChat({ message, sessionId, signal, onEvent }) {
  const body = JSON.stringify(buildBody(message, sessionId))

  // 最多两次：第一次用当前令牌，401 就刷新一次再试。
  // 为什么不用 axios 的响应拦截器代劳：这条链路是原生 fetch，拦截器管不到，
  // 所以要在这里把"取令牌 → 401 刷新 → 重试"这套逻辑自己走一遍。
  let res
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await ensureAccessToken()
    res = await fetch(STREAM_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
      signal,
    })
    if (res.status === 401 && attempt === 0 && (await refreshAccessToken())) continue
    break
  }

  if (!res.ok) {
    // 想拿到后端的 detail，但错误体可能是 JSON 也可能不是。
    // 坑在这：FastAPI 的参数校验错误里 detail 是**数组**（[{loc, msg, type}]），
    // 直接对它调 .trim() 会抛 TypeError，把真实原因盖成一句类型错误。
    let raw = ''
    try {
      raw = await res.text()
    } catch {
      /* 错误体读不出来就算了，下面退回状态码 */
    }
    let detail = ''
    try {
      const parsed = JSON.parse(raw)
      const d = parsed?.detail ?? parsed?.error ?? parsed?.message
      if (Array.isArray(d)) detail = d[0]?.msg ? `参数错误：${d[0].msg}` : ''
      else if (typeof d === 'string') detail = d.trim()
      else if (d != null) detail = String(d)
    } catch {
      detail = raw.trim() // 不是 JSON：原始文本通常比状态码更有信息量
    }
    throw new Error(detail || `流式接口返回 HTTP ${res.status}`)
  }
  if (!res.body) throw new Error('当前浏览器不支持流式响应读取')

  let sawDelta = false
  let done = false
  let sid = res.headers.get('X-Session-Id') || null

  const parser = createSSEParser((event) => {
    if (event.type === 'delta' && event.content) sawDelta = true
    if (event.type === 'done') done = true
    if (event.type === 'meta' && event.session_id) sid = event.session_id
    onEvent(event)
  })

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  try {
    for (;;) {
      const { done: finished, value } = await reader.read()
      if (finished) break
      // stream:true 让跨分片的多字节字符（中文）能被正确拼接
      parser.feed(decoder.decode(value, { stream: true }))
    }
    parser.feed(decoder.decode())
    parser.close()
  } finally {
    reader.cancel().catch(() => {})
  }

  return { sessionId: sid, sawDelta, done }
}

/** 同步对话（流式失败时的降级路径）。 */
export async function sendChat({ message, sessionId, signal }) {
  const res = await api.post(SYNC_PATH, buildBody(message, sessionId), { signal })
  return res.data
}
