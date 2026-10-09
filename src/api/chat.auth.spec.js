import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock 会被提升到 import 之前，所以 mock 函数必须用 vi.hoisted 建，
// 否则工厂执行时还处在 TDZ，会直接 ReferenceError。
const mocks = vi.hoisted(() => ({
  ensureAccessToken: vi.fn(),
  refreshAccessToken: vi.fn(),
}))

vi.mock('./client.js', () => ({
  default: { post: vi.fn(), get: vi.fn() },
  ensureAccessToken: mocks.ensureAccessToken,
  refreshAccessToken: mocks.refreshAccessToken,
}))

const { streamChat } = await import('./chat.js')

/**
 * SSE 链路的鉴权。
 *
 * 这是整套改动里**最容易漏**的一处：同步接口走 axios 实例，令牌由拦截器统一注入；
 * 而流式接口用的是原生 `fetch`（因为要 POST + 自己读 ReadableStream），拦截器
 * 完全够不着它。只改 axios 那一半的话，界面表现为"一发消息就 401"，
 * 而 axios 侧的用例全是绿的 —— 所以单独一个文件钉住它。
 */

/** 按顺序喂响应；用完后重复最后一个 */
function stubFetch(responses) {
  const calls = []
  let i = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      calls.push({ url, init })
      const next = responses[Math.min(i, responses.length - 1)]
      i += 1
      if (next.status >= 400) {
        return {
          ok: false,
          status: next.status,
          headers: new Headers(),
          body: null,
          text: async () => next.body || '',
        }
      }
      const encoder = new TextEncoder()
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: done\ndata: {"type":"done"}\n\n'))
          controller.close()
        },
      })
      return { ok: true, status: next.status, headers: new Headers(), body, text: async () => '' }
    }),
  )
  return calls
}

beforeEach(() => {
  mocks.ensureAccessToken.mockReset()
  mocks.refreshAccessToken.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('streamChat 的鉴权', () => {
  it('必须自己带上 Authorization（axios 拦截器管不到 fetch）', async () => {
    mocks.ensureAccessToken.mockResolvedValue('at-1')
    const calls = stubFetch([{ status: 200 }])

    await streamChat({ message: '你好', sessionId: '', onEvent: () => {} })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/chat/stream')
    expect(calls[0].init.headers.Authorization).toBe('Bearer at-1')
  })

  it('没有令牌时不带这个头（由后端给出 401，而不是发一个假的 Bearer）', async () => {
    mocks.ensureAccessToken.mockResolvedValue('')
    const calls = stubFetch([{ status: 200 }])

    await streamChat({ message: 'hi', sessionId: '', onEvent: () => {} })

    expect(calls[0].init.headers.Authorization).toBeUndefined()
  })

  it('401 时刷新一次并用新令牌重试，不把失败直接抛给用户', async () => {
    mocks.ensureAccessToken.mockResolvedValueOnce('stale').mockResolvedValueOnce('fresh')
    mocks.refreshAccessToken.mockResolvedValue('fresh')
    const calls = stubFetch([{ status: 401, body: '{"detail":"令牌已失效"}' }, { status: 200 }])

    const result = await streamChat({ message: 'hi', sessionId: '', onEvent: () => {} })

    expect(calls).toHaveLength(2)
    expect(calls[0].init.headers.Authorization).toBe('Bearer stale')
    expect(calls[1].init.headers.Authorization).toBe('Bearer fresh')
    expect(result.done).toBe(true)
    expect(result.sawDelta).toBe(false)
  })

  it('401 且刷新不了时抛出后端原文，且只请求一次（不无限重试）', async () => {
    mocks.ensureAccessToken.mockResolvedValue('stale')
    mocks.refreshAccessToken.mockResolvedValue(null)
    const calls = stubFetch([{ status: 401, body: '{"detail":"刷新令牌已失效，请重新登录"}' }])

    await expect(streamChat({ message: 'hi', sessionId: '', onEvent: () => {} })).rejects.toThrow(
      '刷新令牌已失效，请重新登录',
    )
    expect(calls).toHaveLength(1)
  })

  it('请求体仍然按老约定：没有 session_id 时不下发这个键', async () => {
    mocks.ensureAccessToken.mockResolvedValue('at')
    const calls = stubFetch([{ status: 200 }])

    await streamChat({ message: 'hi', sessionId: '', onEvent: () => {} })

    expect(JSON.parse(calls[0].init.body)).toEqual({ message: 'hi' })
  })
})
