import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock 会被提升到 import 之前，所以 mock 函数必须用 vi.hoisted 建，
// 否则工厂执行时还处在 TDZ，会直接 ReferenceError。
const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  fetchMe: vi.fn(),
  ensureAccessToken: vi.fn(),
}))

vi.mock('@/api/auth.js', () => ({
  login: mocks.login,
  register: mocks.register,
  logout: mocks.logout,
  fetchMe: mocks.fetchMe,
  roleLabel: (role) => ({ admin: '管理员', kb_admin: '知识库管理员' })[role] || role,
}))

// api/client.js 一并 mock：auth store 只用到 ensureAccessToken，
// 而间接依赖它的 chat store 还会 import describeError / refreshAccessToken。
vi.mock('@/api/client.js', () => ({
  default: { post: vi.fn(), get: vi.fn() },
  ensureAccessToken: mocks.ensureAccessToken,
  refreshAccessToken: vi.fn(),
  describeError: (err, fallback) => err?.message || fallback,
}))

const { useAuthStore } = await import('./auth.js')
const { clearTokens, emitSessionExpired, getAccessToken, getRefreshToken, setAccessToken } =
  await import('@/api/tokenStore.js')

/** 后端 TokenResponse 的形状（字段名来自 api/auth.py 的 TokenResponse） */
function tokenResponse({ username = 'admin', role = 'admin', display_name = '管理员' } = {}) {
  return {
    access_token: `at-${username}`,
    refresh_token: `rt-${username}`,
    expires_in: 900,
    token_type: 'bearer',
    user: { user_id: 'u-1', username, display_name, role, tenant_id: 'default', customer_id: null },
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  sessionStorage.clear()
  clearTokens()
  vi.clearAllMocks()
})

describe('auth store', () => {
  it('登录成功后身份、令牌、角色都到位', async () => {
    mocks.login.mockResolvedValue(tokenResponse())
    const auth = useAuthStore()

    expect(auth.isAuthenticated).toBe(false) // 初始是 unknown，不是"已登录"
    expect(await auth.login({ username: 'admin', password: 'x' })).toBe(true)

    expect(auth.isAuthenticated).toBe(true)
    expect(auth.role).toBe('admin')
    expect(auth.roleText).toBe('管理员')
    expect(auth.displayName).toBe('管理员')
    expect(auth.initial).toBe('管')
    expect(getAccessToken()).toBe('at-admin')
    expect(getRefreshToken()).toBe('rt-admin')
    expect(auth.lastError).toBe('')
  })

  it('登录失败时保留后端原文，且不进入登录态', async () => {
    // 后端的 401 文案刻意不区分"用户不存在"和"密码错误"，前端要原样透出
    mocks.login.mockRejectedValue(new Error('用户名或密码不正确'))
    const auth = useAuthStore()

    expect(await auth.login({ username: 'admin', password: 'wrong' })).toBe(false)
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.lastError).toBe('用户名或密码不正确')
    expect(getRefreshToken()).toBe('')
  })

  it('注册即登录：后端 201 直接返回令牌，不用再调一次 login', async () => {
    mocks.register.mockResolvedValue(tokenResponse({ username: 'probe_user', role: 'user' }))
    const auth = useAuthStore()

    expect(await auth.register({ username: 'probe_user', password: 'ProbePassw0rd123' })).toBe(true)

    expect(auth.isAuthenticated).toBe(true)
    expect(mocks.login).not.toHaveBeenCalled()
    expect(auth.canManageKb).toBe(false) // 自助注册只能是普通用户
  })

  it('canManageKb 与后端 require_roles("kb_admin") 对齐（admin 继承 kb_admin）', async () => {
    const cases = [
      ['admin', true],
      ['kb_admin', true],
      ['operator', false],
      ['user', false],
    ]
    for (const [role, expected] of cases) {
      setActivePinia(createPinia())
      mocks.login.mockResolvedValue(tokenResponse({ role }))
      const auth = useAuthStore()
      await auth.login({ username: 'u', password: 'p' })
      expect(auth.canManageKb, `${role} 的 canManageKb`).toBe(expected)
    }
  })

  it('登出会请求后端撤销刷新令牌，并清空本地登录态', async () => {
    mocks.login.mockResolvedValue(tokenResponse())
    mocks.logout.mockResolvedValue({ success: true })
    const auth = useAuthStore()
    await auth.login({ username: 'admin', password: 'x' })

    await auth.logout()

    expect(mocks.logout).toHaveBeenCalledWith('rt-admin')
    expect(getAccessToken()).toBe('')
    expect(getRefreshToken()).toBe('')
    expect(auth.isAuthenticated).toBe(false)
  })

  it('后端撤销失败也必须让用户登出（否则"点了登出却还在登录态"更糟）', async () => {
    mocks.login.mockResolvedValue(tokenResponse())
    mocks.logout.mockRejectedValue(new Error('Network Error'))
    const auth = useAuthStore()
    await auth.login({ username: 'admin', password: 'x' })

    await auth.logout()

    expect(auth.isAuthenticated).toBe(false)
    expect(getRefreshToken()).toBe('')
  })

  it('刷新页面后靠刷新令牌恢复：先换令牌，再用 /me 取库里的身份', async () => {
    localStorage.setItem('auth_refresh_token', 'rt-stored')
    mocks.ensureAccessToken.mockImplementation(async () => {
      setAccessToken('at-restored', 900)
      return 'at-restored'
    })
    mocks.fetchMe.mockResolvedValue({ username: 'admin', role: 'kb_admin', display_name: '管理员' })

    const auth = useAuthStore()

    expect(await auth.ensureReady()).toBe('authenticated')
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.role).toBe('kb_admin')
    expect(auth.canManageKb).toBe(true)
    // /me 的返回值是权威身份：令牌里的 role 可能已经过期（改过角色）
    expect(mocks.fetchMe).toHaveBeenCalledTimes(1)
  })

  it('没有刷新令牌时不请求 /me，直接判为未登录', async () => {
    const auth = useAuthStore()

    expect(await auth.ensureReady()).toBe('anonymous')
    expect(mocks.fetchMe).not.toHaveBeenCalled()
  })

  it('ensureReady 单飞：路由守卫与首屏同时调用也只恢复一次', async () => {
    localStorage.setItem('auth_refresh_token', 'rt-stored')
    mocks.ensureAccessToken.mockImplementation(async () => {
      setAccessToken('at-restored', 900)
      return 'at-restored'
    })
    mocks.fetchMe.mockResolvedValue({ username: 'u', role: 'user' })
    const auth = useAuthStore()

    await Promise.all([auth.ensureReady(), auth.ensureReady(), auth.ensureReady()])

    expect(mocks.fetchMe).toHaveBeenCalledTimes(1)
  })

  it('恢复时 /me 失败不会删掉刷新令牌（网络抖动不该让人丢掉登录态）', async () => {
    localStorage.setItem('auth_refresh_token', 'rt-stored')
    mocks.ensureAccessToken.mockImplementation(async () => {
      setAccessToken('at-restored', 900)
      return 'at-restored'
    })
    mocks.fetchMe.mockRejectedValue(new Error('Network Error'))

    const auth = useAuthStore()

    expect(await auth.ensureReady()).toBe('anonymous')
    expect(mocks.fetchMe).toHaveBeenCalledTimes(1)
    // 关键：令牌还在，刷新页面再试一次就能恢复，而不是被逼着重新登录
    expect(getRefreshToken()).toBe('rt-stored')
  })

  it('会话失效事件（刷新令牌过期/被撤销）把状态打回未登录，并留下原因', async () => {
    mocks.login.mockResolvedValue(tokenResponse())
    const auth = useAuthStore()
    await auth.login({ username: 'admin', password: 'x' })
    expect(auth.isAuthenticated).toBe(true)

    emitSessionExpired('刷新令牌已失效，请重新登录')

    expect(auth.isAuthenticated).toBe(false)
    expect(auth.expiredReason).toBe('刷新令牌已失效，请重新登录')
    expect(getRefreshToken()).toBe('')
  })

  it('清掉过期原因后不再显示（登录页只需要提示一次）', async () => {
    const auth = useAuthStore()
    emitSessionExpired('令牌已失效')

    expect(auth.expiredReason).toBe('令牌已失效')
    auth.clearExpiredReason()
    expect(auth.expiredReason).toBe('')
  })

  it('换身份会清掉上一段对话的 session_id（后端历史按 租户:用户:session 隔离）', async () => {
    sessionStorage.setItem('chat_session_id', 's-from-previous-user')
    mocks.login.mockResolvedValue(tokenResponse())

    const auth = useAuthStore()
    await auth.login({ username: 'admin', password: 'x' })

    expect(sessionStorage.getItem('chat_session_id')).toBeNull()
  })
})
