import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock 会被提升到 import 之前，所以 mock 函数必须用 vi.hoisted 建，
// 否则工厂执行时还处在 TDZ，会直接 ReferenceError。
const mocks = vi.hoisted(() => ({ streamChat: vi.fn(), sendChat: vi.fn() }))

vi.mock('@/api/chat.js', () => ({
  streamChat: mocks.streamChat,
  sendChat: mocks.sendChat,
}))

const { useChatStore } = await import('./chat.js')

/**
 * 这里盯的是**降级规则**，也就是"什么时候可以退回同步接口重跑"。
 *
 * 为什么这条规则值得写用例：后端的一次问答有副作用（写 Redis 会话历史、
 * 累计转人工计数）。如果流式已经吐了正文、中途断了，再调一次 /chat 重跑，
 * 用户会看到两遍答案，后端也会把同一句话重复计进历史。
 */
describe('chat store 的流式 / 降级行为', () => {
  let chat

  beforeEach(() => {
    setActivePinia(createPinia())
    sessionStorage.clear()
    mocks.streamChat.mockReset()
    mocks.sendChat.mockReset()
    chat = useChatStore()
  })

  function lastReply() {
    return chat.messages[chat.messages.length - 1]
  }

  it('正常流式：delta 增量累积，mode 标成 stream，不触发同步接口', async () => {
    mocks.streamChat.mockImplementation(async ({ onEvent }) => {
      onEvent({ type: 'status', stage: 'retrieving', text: '正在检索知识库…' })
      onEvent({ type: 'delta', content: '您好，' })
      onEvent({ type: 'delta', content: '云枢S3 Pro 支持 Wi-Fi 6。' })
      onEvent({ type: 'meta', session_id: 's-1', intent: 'rag', method: 'rag_flow' })
      onEvent({ type: 'done' })
      return { sessionId: 's-1', sawDelta: true, done: true }
    })

    await chat.send('云枢S3 Pro 支持什么协议？')

    const reply = lastReply()
    expect(reply.content).toBe('您好，云枢S3 Pro 支持 Wi-Fi 6。')
    expect(reply.pending).toBe(false)
    expect(reply.mode).toBe('stream')
    expect(reply.intent).toBe('rag')
    expect(chat.isSending).toBe(false)
    expect(chat.statusText).toBe('')
    expect(mocks.sendChat).not.toHaveBeenCalled()
  })

  it('从 meta 事件拿到 session_id 并存进 sessionStorage，保证多轮上下文', async () => {
    mocks.streamChat.mockImplementation(async ({ onEvent }) => {
      onEvent({ type: 'delta', content: '好' })
      onEvent({ type: 'meta', session_id: 's-abc' })
      return { sessionId: 's-abc', sawDelta: true, done: true }
    })

    await chat.send('第一句')

    expect(chat.sessionId).toBe('s-abc')
    expect(sessionStorage.getItem('chat_session_id')).toBe('s-abc')
    expect(chat.hasSession).toBe(true)

    // 第二轮必须把 session_id 带上，否则后端会当成全新会话
    mocks.streamChat.mockImplementation(async ({ onEvent }) => {
      onEvent({ type: 'delta', content: '继续' })
      return { sessionId: 's-abc', sawDelta: true, done: true }
    })
    await chat.send('第二句')
    expect(mocks.streamChat.mock.calls[1][0].sessionId).toBe('s-abc')
  })

  it('流式一个字都没吐出来 → 退回同步接口，回答来自 /chat', async () => {
    mocks.streamChat.mockRejectedValue(new Error('连不上流式接口'))
    mocks.sendChat.mockResolvedValue({
      answer: '同步接口的回答',
      session_id: 's-2',
      intent: 'agent',
      method: 'agent_flow',
    })

    await chat.send('问题')

    const reply = lastReply()
    expect(mocks.sendChat).toHaveBeenCalledTimes(1)
    expect(reply.content).toBe('同步接口的回答')
    expect(reply.mode).toBe('sync')
    expect(reply.error).toBe('')
    expect(chat.sessionId).toBe('s-2')
    expect(chat.lastMode).toBe('sync')
  })

  it('已经吐过正文才断线 → 绝不重跑同步接口，保留部分内容并标注中断', async () => {
    mocks.streamChat.mockImplementation(async ({ onEvent }) => {
      onEvent({ type: 'delta', content: '这是已经收到的前半段' })
      throw new Error('连接中断')
    })

    await chat.send('问题')

    const reply = lastReply()
    expect(mocks.sendChat).not.toHaveBeenCalled()
    expect(reply.content).toBe('这是已经收到的前半段')
    expect(reply.interrupted).toBe(true)
    expect(reply.pending).toBe(false)
  })

  it('后端推 error 事件且没有正文 → 仍然降级到同步接口', async () => {
    mocks.streamChat.mockImplementation(async ({ onEvent }) => {
      onEvent({ type: 'error', message: '编排图执行失败' })
      onEvent({ type: 'done' })
      return { sessionId: 's-3', sawDelta: false, done: true }
    })
    mocks.sendChat.mockResolvedValue({ answer: '兜底回答', session_id: 's-3' })

    await chat.send('问题')

    expect(mocks.sendChat).toHaveBeenCalledTimes(1)
    expect(lastReply().content).toBe('兜底回答')
  })

  it('reset 事件要清空前面推的 token，否则新旧答案会首尾粘在一起', async () => {
    mocks.streamChat.mockImplementation(async ({ onEvent }) => {
      onEvent({ type: 'delta', content: '被作废的旧内容' })
      onEvent({ type: 'reset', reason: '资料较多，改用分段生成，请稍候' })
      onEvent({ type: 'delta', content: '完整答案' })
      return { sessionId: 's-4', sawDelta: true, done: true }
    })

    await chat.send('问题')

    const reply = lastReply()
    expect(reply.content).toBe('完整答案')
    expect(reply.resetReason).toBe('资料较多，改用分段生成，请稍候')
  })

  it('用户点停止：保留已收到的内容并标记中断，不再请求同步接口', async () => {
    mocks.streamChat.mockImplementation(
      ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }),
    )

    const pending = chat.send('问题')
    chat.stop()
    await pending

    const reply = lastReply()
    expect(reply.interrupted).toBe(true)
    expect(reply.content).toBe('（已停止）')
    expect(chat.isSending).toBe(false)
    expect(mocks.sendChat).not.toHaveBeenCalled()
  })

  it('空输入不发起请求', async () => {
    await chat.send('   ')
    expect(mocks.streamChat).not.toHaveBeenCalled()
    expect(chat.isSending).toBe(false)
  })

  it('reset 换掉 session_id 并清空消息，等于让后端从零开始一段上下文', () => {
    sessionStorage.setItem('chat_session_id', 's-old')
    setActivePinia(createPinia())
    const fresh = useChatStore()
    expect(fresh.sessionId).toBe('s-old')

    fresh.reset()

    expect(fresh.sessionId).toBe('')
    expect(sessionStorage.getItem('chat_session_id')).toBeNull()
    expect(fresh.messages).toHaveLength(1)
    expect(fresh.messages[0].role).toBe('assistant')
  })
})
