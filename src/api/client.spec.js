import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import api, { describeError, ensureAccessToken, refreshAccessToken } from './client.js'
import { clearTokens, getAccessToken, getRefreshToken, setTokens, subscribe } from './tokenStore.js'

/**
 * axios 拦截器：注入令牌、401 刷新一次、刷新失败清登录态。
 *
 * 为什么用自定义 adapter 而不是 axios-mock-adapter（没装）或起个真服务：
 *   - 不引新依赖；
 *   - 关键是能构造"**先 401，再用新令牌成功**"这种序列 —— 手工验证这条路径
 *     要等访问令牌 15 分钟自然过期，实际没人会去测，所以必须用测试钉住。
 */

let requests = []
let respond = null

function authOf(config) {
  const headers = config.headers
  if (!headers) return undefined
  // axios v1 给的是 AxiosHeaders 实例，取值方式与普通对象不同
  return typeof headers.get === 'function' ? headers.get('Authorization') : headers.Authorization
}

api.defaults.adapter = async (config) => {
  requests.push({ url: config.url, method: config.method, auth: authOf(config) })
  const next = await respond(config)

  if (next.status >= 400) {
    // 按 axios 的约定拒掉：拦截器只关心 err.response.status 与 err.config
    const err = new Error(`Request failed with status code ${next.status}`)
    err.isAxiosError = true
    err.config = config
    err.response = {
      status: next.status,
      data: next.data,
      headers: next.headers || {},
      config,
      statusText: '',
    }
    throw err
  }
  return {
    data: next.data,
    status: next.status,
    statusText: 'OK',
    headers: next.headers || {},
    config,
  }
}

/** 造一个已经登录的现场 */
function seedSession({ access = 'at-1', refresh = 'rt-1' } = {}) {
  setTokens({ accessToken: access, refreshToken: refresh, expiresIn: 900 })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  clearTokens()
  requests = []
  respond = null
})

afterEach(() => {
  clearTokens()
})

describe('请求拦截器：注入访问令牌', () => {
  it('有令牌时带 Authorization: Bearer', async () => {
    seedSession()
    respond = async () => ({ status: 200, data: { ok: true } })

    const res = await api.get('/auth/me')

    expect(res.data).toEqual({ ok: true })
    expect(requests[0].auth).toBe('Bearer at-1')
  })

  it('没有令牌时不带这个头（探针类接口不需要身份）', async () => {
    respond = async () => ({ status: 200, data: {} })

    await api.get('/health')

    expect(requests[0].auth).toBeUndefined()
  })
})

describe('响应拦截器：401 刷新一次并重试', () => {
  it('用刷新令牌换一对新令牌，再用新令牌重试原请求', async () => {
    seedSession({ access: 'stale', refresh: 'rt-1' })
    respond = async (config) => {
      if (config.url === '/auth/refresh') {
        return {
          status: 200,
          data: { access_token: 'fresh', refresh_token: 'rt-2', expires_in: 900 },
        }
      }
      // 第一次 /auth/me → 401（令牌被撤销），重试那次 → 200
      const seen = requests.filter((r) => r.url === '/auth/me').length
      return seen === 1
        ? { status: 401, data: { detail: '令牌已失效（已登出或被撤销）' } }
        : { status: 200, data: { username: 'admin' } }
    }

    const res = await api.get('/auth/me')

    expect(res.data).toEqual({ username: 'admin' })
    expect(requests.map((r) => r.url)).toEqual(['/auth/me', '/auth/refresh', '/auth/me'])
    expect(requests[2].auth).toBe('Bearer fresh')
    // 轮换后的刷新令牌必须落下来，否则下次刷新会拿一个已被消费的旧令牌去换 → 401
    expect(getRefreshToken()).toBe('rt-2')
  })

  it('重试只发生一次：连续 401 不会无限循环', async () => {
    seedSession({ access: 'stale' })
    respond = async (config) =>
      config.url === '/auth/refresh'
        ? { status: 200, data: { access_token: 'fresh', refresh_token: 'rt-2', expires_in: 900 } }
        : { status: 401, data: { detail: '令牌已失效' } }

    await expect(api.get('/auth/me')).rejects.toThrow('401')

    // 原请求 + 刷新 + 一次重试，到此为止
    expect(requests.map((r) => r.url)).toEqual(['/auth/me', '/auth/refresh', '/auth/me'])
  })

  it('标记 skipAuthRefresh 的请求 401 不触发刷新（登录失败就是失败）', async () => {
    seedSession()
    respond = async () => ({ status: 401, data: { detail: '用户名或密码不正确' } })

    await expect(
      api.post('/auth/login', { username: 'a', password: 'b' }, { skipAuthRefresh: true }),
    ).rejects.toThrow('401')

    expect(requests.map((r) => r.url)).toEqual(['/auth/login'])
    // 一次输错密码不该把已登录用户的会话清掉
    expect(getRefreshToken()).toBe('rt-1')
  })

  it('刷新也失败时清空登录态、广播 expired，并抛回原始错误', async () => {
    const events = []
    const off = subscribe((e) => events.push(e))
    seedSession({ access: 'stale', refresh: 'rt-dead' })
    respond = async () => ({ status: 401, data: { detail: '刷新令牌已失效，请重新登录' } })

    await expect(api.get('/auth/me')).rejects.toThrow('401')

    expect(requests.map((r) => r.url)).toEqual(['/auth/me', '/auth/refresh'])
    expect(getAccessToken()).toBe('')
    expect(getRefreshToken()).toBe('')
    expect(events.filter((e) => e.type === 'expired')).toHaveLength(1)
    expect(events.at(-1).reason).toBe('刷新令牌已失效，请重新登录')
    off()
  })

  it('403 / 503 一律不触发刷新（它们不是"令牌过期"）', async () => {
    seedSession()
    respond = async () => ({ status: 403, data: { detail: '权限不足' } })

    await expect(api.get('/kb/documents')).rejects.toThrow('403')
    expect(requests.map((r) => r.url)).toEqual(['/kb/documents'])

    requests = []
    respond = async () => ({ status: 503, data: { detail: '账号服务暂时不可用' } })
    await expect(api.get('/auth/me')).rejects.toThrow('503')
    expect(requests.map((r) => r.url)).toEqual(['/auth/me'])
  })
})

describe('ensureAccessToken / refreshAccessToken', () => {
  it('令牌还新鲜就直接返回，不发请求', async () => {
    seedSession({ access: 'at-1' })
    respond = async () => ({ status: 200, data: {} })

    expect(await ensureAccessToken()).toBe('at-1')
    expect(requests).toEqual([])
  })

  it('没有刷新令牌时返回空串（SSE 侧据此判断"没登录"）', async () => {
    clearTokens()
    expect(await ensureAccessToken()).toBe('')
    expect(requests).toEqual([])
  })

  it('只有刷新令牌（刚刷新页面）时先换一对再返回', async () => {
    setTokens({ refreshToken: 'rt-1' })
    respond = async () => ({
      status: 200,
      data: { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 900 },
    })

    expect(await ensureAccessToken()).toBe('at-2')
    expect(requests.map((r) => r.url)).toEqual(['/auth/refresh'])
    expect(getAccessToken()).toBe('at-2')
  })

  it('单飞：并发调用只发一次刷新请求', async () => {
    seedSession({ access: 'stale' })
    respond = async () => ({
      status: 200,
      data: { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 900 },
    })

    const [a, b] = await Promise.all([refreshAccessToken(), refreshAccessToken()])

    expect(a).toBe('at-2')
    expect(b).toBe('at-2')
    expect(requests).toHaveLength(1)
  })

  it('没有刷新令牌时 refreshAccessToken 直接返回 null，不发请求', async () => {
    expect(await refreshAccessToken()).toBe(null)
    expect(requests).toEqual([])
  })

  it('刷新响应里没有 access_token 时按失败处理（不信一个半截响应）', async () => {
    seedSession({ access: 'stale' })
    respond = async () => ({ status: 200, data: { refresh_token: 'rt-2' } })

    expect(await refreshAccessToken()).toBe(null)
    expect(getRefreshToken()).toBe('')
  })
})

describe('describeError 的状态码兜底', () => {
  const failure = (status, data = {}, headers = {}) => ({ response: { status, data, headers } })

  it('有 detail 时优先透出后端原文 —— 登录失败不能显示成"会话过期"', () => {
    expect(describeError(failure(401, { detail: '用户名或密码不正确' }))).toBe('用户名或密码不正确')
  })

  it('detail 是数组时取第一条 msg（FastAPI 的参数校验错误）', () => {
    expect(describeError(failure(422, { detail: [{ msg: 'field required' }] }))).toBe(
      '参数错误：field required',
    )
  })

  it('后端没给文案时按状态码说人话（401/403/503 的含义完全不同）', () => {
    expect(describeError(failure(401))).toBe('登录状态已失效，请重新登录')
    expect(describeError(failure(403))).toBe('没有权限执行这个操作')
    expect(describeError(failure(503))).toBe('服务暂时不可用，请稍后重试')
  })

  it('限流响应带 Retry-After 时告诉用户还要等多久', () => {
    expect(describeError(failure(429, {}, { 'retry-after': '30' }))).toBe(
      '请求过于频繁（约 30 秒后可重试），请稍后再试',
    )
  })
})
