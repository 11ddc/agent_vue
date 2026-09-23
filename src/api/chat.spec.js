import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSSEParser, streamChat } from './chat.js'

/**
 * 这些用例盯的是"手写的 SSE 解析"这一段。
 *
 * 后端（api/chat.py 的 _sse）用 sse_starlette 发帧，真实网络下有三件事
 * 一定会发生，而它们只有在真连上后端时才会暴露：
 *   1. 分片不落在行边界上（一个中文 token 可能被切成两半）
 *   2. sse_starlette 的 ping=15 会插 `: ping` 注释行
 *   3. 最后一帧可能没有结尾换行
 * 所以这里按"字节流"驱动解析器，而不是喂现成的字符串。
 */

function collect() {
  const events = []
  return { events, parser: createSSEParser((e) => events.push(e)) }
}

describe('createSSEParser', () => {
  it('解析标准 event + data 帧', () => {
    const { events, parser } = collect()
    parser.feed('event: delta\ndata: {"type":"delta","content":"你好"}\n\n')
    parser.close()
    expect(events).toEqual([{ type: 'delta', content: '你好' }])
  })

  it('忽略 sse_starlette 的 ping 注释行', () => {
    const { events, parser } = collect()
    parser.feed(': ping - 2026-09-23 10:00:00\n\n')
    parser.feed('event: done\ndata: {"type":"done"}\n\n')
    parser.close()
    expect(events).toEqual([{ type: 'done' }])
  })

  it('按 \\n 缓冲，跨分片也能拼回完整帧', () => {
    const { events, parser } = collect()
    // 故意切在最难看的位置：JSON 中间、转义符中间
    parser.feed('event: del')
    parser.feed('ta\ndata: {"type":"delta","cont')
    parser.feed('ent":"abc\\n')
    parser.feed('def"}\n\n')
    parser.close()
    expect(events).toEqual([{ type: 'delta', content: 'abc\ndef' }])
  })

  it('多行 data 按规范用 \\n 拼接', () => {
    const { events, parser } = collect()
    parser.feed('data: {"type":"delta",\ndata: "content":"x"}\n\n')
    parser.close()
    // 两行 data 拼起来是一个合法 JSON
    expect(events).toEqual([{ type: 'delta', content: 'x' }])
  })

  it('兼容 CRLF 行尾', () => {
    const { events, parser } = collect()
    parser.feed('event: done\r\ndata: {"type":"done"}\r\n\r\n')
    parser.close()
    expect(events).toEqual([{ type: 'done' }])
  })

  it('最后一帧没有结尾换行时，close() 仍要吐出（不能丢内容）', () => {
    const { events, parser } = collect()
    parser.feed('event: delta\ndata: {"type":"delta","content":"收尾"}')
    expect(events).toEqual([]) // 还没遇到空行，先不派发
    parser.close()
    expect(events).toEqual([{ type: 'delta', content: '收尾' }])
  })

  it('data 不是 JSON 时兜底成纯文本 delta，而不是把内容丢掉', () => {
    const { events, parser } = collect()
    parser.feed('event: delta\ndata: 裸文本\n\n')
    parser.close()
    expect(events).toEqual([{ type: 'delta', content: '裸文本' }])
  })
})

describe('streamChat', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch(chunks, { ok = true, status = 200, headers = {} } = {}) {
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c))
        controller.close()
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok,
        status,
        headers: new Headers(headers),
        body,
        text: async () => '',
      })),
    )
  }

  it('把后端事件原样回调，并从 meta 事件取回 session_id', async () => {
    stubFetch([
      'event: status\ndata: {"type":"status","stage":"retrieving","text":"正在检索知识库…"}\n\n',
      'event: delta\ndata: {"type":"delta","content":"您好，"}\n\n',
      'event: delta\ndata: {"type":"delta","content":"请稍等"}\n\n',
      'event: meta\ndata: {"type":"meta","session_id":"s-123","intent":"rag"}\n\n',
      'event: done\ndata: {"type":"done"}\n\n',
    ])

    const seen = []
    const result = await streamChat({
      message: '你好',
      sessionId: '',
      onEvent: (e) => seen.push(e.type),
    })

    expect(result).toEqual({ sessionId: 's-123', sawDelta: true, done: true })
    expect(seen).toEqual(['status', 'delta', 'delta', 'meta', 'done'])
  })

  it('没有 session_id 时不把该键塞进请求体（后端不接受 null）', async () => {
    stubFetch(['event: done\ndata: {"type":"done"}\n\n'])
    await streamChat({ message: 'hi', sessionId: '', onEvent: () => {} })

    const [url, init] = globalThis.fetch.mock.calls[0]
    // 必须带 /api 前缀，否则会打到 Vite 开发服务器自己身上（5173 没有这个路由）
    expect(url).toBe('/api/chat/stream')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ message: 'hi' })
  })

  it('有 session_id 时带上，保证多轮上下文连续', async () => {
    stubFetch(['event: done\ndata: {"type":"done"}\n\n'])
    await streamChat({ message: 'hi', sessionId: 's-9', onEvent: () => {} })

    const [, init] = globalThis.fetch.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ message: 'hi', session_id: 's-9' })
  })

  it('HTTP 非 2xx 时抛出后端 detail，而不是一句没有信息量的失败', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 422,
        headers: new Headers(),
        body: null,
        text: async () => '{"detail":[{"msg":"field required"}]}',
      })),
    )
    // FastAPI 校验失败的 detail 是数组，必须能读出来而不是被 .trim() 抛成 TypeError
    await expect(streamChat({ message: '', sessionId: '', onEvent: () => {} })).rejects.toThrow(
      '参数错误：field required',
    )
  })

  it('错误体不是 JSON 时把原始文本抛出去，并带上状态码兜底', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        headers: new Headers(),
        body: null,
        text: async () => 'Internal Server Error',
      })),
    )
    await expect(streamChat({ message: 'x', sessionId: '', onEvent: () => {} })).rejects.toThrow(
      'Internal Server Error',
    )
  })

  it('一个 delta 都没收到时 sawDelta 为 false（调用方据此决定能否降级重跑）', async () => {
    stubFetch(['event: status\ndata: {"type":"status","text":"正在检索…"}\n\n'])
    const result = await streamChat({ message: 'x', sessionId: '', onEvent: () => {} })
    expect(result.sawDelta).toBe(false)
    expect(result.done).toBe(false)
  })
})
