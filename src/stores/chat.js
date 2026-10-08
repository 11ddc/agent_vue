import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { streamChat, sendChat } from '@/api/chat.js'
import { describeError } from '@/api/client.js'
import { readSessionString, removeSession, writeSession } from '@/utils/storage.js'
import { DEFAULT_ROLE_ID, getRole } from '@/config/roles.js'

const SESSION_KEY = 'chat_session_id'

/*
 * 开场白来自角色预设，不再硬编码在这里。
 * 这个应用已经从"只能客服"改成通用对话产品，客服只是其中一个可选角色
 * （见 src/config/roles.js）；切换角色时调用方会把新角色的欢迎语传进来。
 */
const DEFAULT_WELCOME = getRole(DEFAULT_ROLE_ID).welcome

let msgSeq = 0
function nextId() {
  msgSeq += 1
  return `${Date.now()}-${msgSeq}`
}

function makeMessage(role, content, extra = {}) {
  return {
    id: nextId(),
    role, // 'user' | 'assistant'
    content,
    time: new Date().toISOString(),
    ...extra,
  }
}

export const useChatStore = defineStore('chat', () => {
  // ===== 状态 =====
  const messages = ref([makeMessage('assistant', DEFAULT_WELCOME)])
  const inputText = ref('')
  const isSending = ref(false)
  /** 流式过程中的阶段提示（后端 status 事件推来的文案） */
  const statusText = ref('')
  /** 上一次回答的交付方式，用于界面标注：stream / sync */
  const lastMode = ref('')
  // 走安全包装：隐私模式下裸调 sessionStorage 会抛异常，直接把应用搞白屏
  const sessionId = ref(readSessionString(SESSION_KEY))

  // 打断当前请求用；每次 send 重新建一个
  let controller = null

  // ===== 计算属性 =====
  const canSend = computed(() => !!inputText.value.trim() && !isSending.value)
  const hasSession = computed(() => !!sessionId.value)

  // 引导问句已经移到角色预设（src/config/roles.js），不同角色给不同的问句。
  // 客服/文档角色那 4 条是逐条核对过知识库出处的，出处注释也一起搬过去了。

  // ===== 会话管理 =====

  function setSession(id) {
    if (!id || id === sessionId.value) return
    sessionId.value = id
    writeSession(SESSION_KEY, id)
  }

  /**
   * 开启新会话。
   *
   * @param {string} [welcome] 开场白。切换角色时必须传新角色的欢迎语，
   *   否则会出现"切到客服了，开场白还是通用助手"的错位。
   *
   * 注意：后端的历史（query_rewrite 读取的会话记录）是**按 session_id 存在 Redis 里**的，
   * 前端这里换一个 id 就等于让后端换一段上下文——这就是"新会话"的全部含义，
   * 前端不需要也没法主动去删后端的历史。
   */
  function reset(welcome = DEFAULT_WELCOME) {
    stop()
    sessionId.value = ''
    removeSession(SESSION_KEY)
    messages.value = [makeMessage('assistant', welcome)]
    statusText.value = ''
    lastMode.value = ''
    inputText.value = ''
  }

  function stop() {
    if (controller) {
      controller.abort()
      controller = null
    }
  }

  // ===== 发送 =====

  async function send(rawText) {
    const text = String(rawText ?? inputText.value).trim()
    if (!text || isSending.value) return

    messages.value.push(makeMessage('user', text))
    inputText.value = ''
    isSending.value = true
    statusText.value = '正在连接…'

    messages.value.push(makeMessage('assistant', '', { pending: true, status: statusText.value }))
    // 取回数组里的响应式代理：直接改 push 进去的那个原始对象**不会触发更新**
    const reply = messages.value[messages.value.length - 1]

    controller = new AbortController()
    const { signal } = controller
    const startedAt = Date.now()
    let resetReason = ''

    const applyEvent = (evt) => {
      switch (evt.type) {
        case 'status':
          statusText.value = evt.text || '处理中…'
          reply.status = statusText.value
          break
        case 'delta':
          if (evt.content) reply.content += evt.content
          // 一旦开始吐正文，就不再显示阶段提示，避免和正文抢位置
          statusText.value = ''
          reply.status = ''
          break
        case 'reset':
          // 后端宣告前面推的 token 作废（例如"资料较多，改用分段生成"），
          // 必须清空已渲染的内容，否则新旧答案会首尾粘在一起
          reply.content = ''
          resetReason = evt.reason || '已重新生成'
          reply.resetReason = resetReason
          break
        case 'meta':
          if (evt.session_id) setSession(evt.session_id)
          if (evt.intent) reply.intent = evt.intent
          if (evt.method) reply.method = evt.method
          break
        case 'error':
          reply.error = evt.message || '后端处理失败'
          break
        case 'done':
          break
        default:
          break
      }
    }

    try {
      const result = await streamChat({
        message: text,
        sessionId: sessionId.value,
        signal,
        onEvent: applyEvent,
      })
      if (result.sessionId) setSession(result.sessionId)
      lastMode.value = 'stream'
      reply.mode = 'stream'
    } catch (err) {
      if (signal.aborted) {
        // 用户主动停止：保留已经收到的部分内容，并标注是被打断的
        reply.interrupted = true
        if (!reply.content) reply.content = '（已停止）'
        reply.pending = false
        reply.status = ''
        statusText.value = ''
        isSending.value = false
        controller = null
        reply.elapsedMs = Date.now() - startedAt
        return
      }
      // 流式没成，先记下原因；下面如果正文仍是空的，会走同步接口兜底
      reply.error = reply.error || describeError(err, '流式连接失败')
    }

    // ── 降级判定 ────────────────────────────────────────────────
    // 只要最终**一个字都没有**就退回同步接口 /api/chat。
    // 这条规则同时覆盖了三种失败：SSE 直接连不上、后端推了 error 事件、
    // 以及流在吐正文前断掉。已有正文时绝不重跑 —— 后端有副作用（写 Redis 历史、
    // 转人工计数），重跑会让答案重复，还会把同一句话计进会话历史。
    if (!reply.content.trim()) {
      statusText.value = '流式不可用，改用普通请求…'
      reply.status = statusText.value
      try {
        const data = await sendChat({
          message: text,
          sessionId: sessionId.value,
          signal,
        })
        if (data?.session_id) setSession(data.session_id)
        reply.content = data?.answer || '（后端没有返回内容）'
        reply.intent = data?.intent || reply.intent
        reply.method = data?.method || reply.method
        reply.handoff = !!data?.handoff
        reply.mode = 'sync'
        lastMode.value = 'sync'
        reply.error = ''
      } catch (err2) {
        reply.content =
          reply.content || '抱歉，我暂时无法回答这个问题。请稍后重试，或拨打客服热线 400-888-6666。'
        reply.error = describeError(err2, '请求失败')
        reply.mode = 'failed'
      }
    } else if (reply.error) {
      // 已经吐过一部分正文，但流在中途断了：保留内容 + 如实标注，不重跑
      reply.interrupted = true
    }

    reply.pending = false
    reply.status = ''
    reply.elapsedMs = Date.now() - startedAt
    statusText.value = ''
    isSending.value = false
    controller = null
  }

  return {
    messages,
    inputText,
    isSending,
    statusText,
    lastMode,
    sessionId,
    canSend,
    hasSession,
    send,
    stop,
    reset,
    setSession,
  }
})
