import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearTokens,
  emitSessionExpired,
  getAccessToken,
  getRefreshToken,
  isAccessTokenFresh,
  setAccessToken,
  setTokens,
  subscribe,
} from './tokenStore.js'

/**
 * 令牌持有者。
 *
 * 这里盯的是"两个令牌的存法不一样"这条设计：访问令牌只在内存、刷新令牌才落盘。
 * 它是整套登录态的地基 —— 存错地方（例如把访问令牌也写进 localStorage）不会报错，
 * 只会安静地扩大 XSS 的影响面，所以必须有断言钉住。
 */

/** 收集本次用例注册的取消订阅函数，避免用例之间互相触发 */
let unsubs = []

function watch() {
  const events = []
  unsubs.push(subscribe((e) => events.push(e)))
  return events
}

/** localStorage 里当前所有的值（不用 Object.keys：Storage 的枚举行为各实现不一） */
function storedValues() {
  const out = []
  for (let i = 0; i < localStorage.length; i += 1) {
    out.push(localStorage.getItem(localStorage.key(i)))
  }
  return out
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  unsubs = []
  clearTokens()
  vi.clearAllMocks()
})

afterEach(() => {
  unsubs.forEach((off) => off())
  vi.useRealTimers()
})

describe('tokenStore', () => {
  it('setTokens：访问令牌只在内存，只有刷新令牌落 localStorage', () => {
    setTokens({ accessToken: 'at-1', refreshToken: 'rt-1', expiresIn: 900 })

    expect(getAccessToken()).toBe('at-1')
    expect(getRefreshToken()).toBe('rt-1')
    expect(localStorage.length).toBe(1)
    expect(localStorage.key(0)).toBe('auth_refresh_token')
    expect(storedValues()).toEqual(['rt-1'])
  })

  it('保存的是后端原样给的刷新令牌（不是哈希、没有被改写）', () => {
    setTokens({ refreshToken: 'rt-abc' })
    expect(localStorage.getItem('auth_refresh_token')).toBe('rt-abc')
  })

  it('过期时间按 expiresIn 的秒数算，并留 30 秒提前量', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    setTokens({ accessToken: 'at', expiresIn: 900 })

    expect(isAccessTokenFresh()).toBe(true)

    // 900 - 30 = 870 秒之后就该判定"快过期了"：提前刷新，而不是卡在过期那一瞬间
    vi.advanceTimersByTime(871 * 1000)
    expect(isAccessTokenFresh()).toBe(false)
  })

  it('不知道到期时间时不假装过期（交给 401 去发现）', () => {
    setTokens({ accessToken: 'at' })
    expect(isAccessTokenFresh()).toBe(true)
  })

  it('没有令牌时永远不算新鲜', () => {
    expect(isAccessTokenFresh()).toBe(false)
  })

  it('clearTokens 把内存与 localStorage 都清掉', () => {
    setTokens({ accessToken: 'at', refreshToken: 'rt', expiresIn: 900 })
    clearTokens()

    expect(getAccessToken()).toBe('')
    expect(getRefreshToken()).toBe('')
    expect(localStorage.getItem('auth_refresh_token')).toBeNull()
  })

  it('setAccessToken 只换访问令牌，保留刷新令牌', () => {
    setTokens({ accessToken: 'old', refreshToken: 'rt', expiresIn: 900 })
    setAccessToken('new', 900)

    expect(getAccessToken()).toBe('new')
    expect(getRefreshToken()).toBe('rt')
  })

  it('订阅者能收到 changed（令牌变更）与 expired（会话失效）', () => {
    const events = watch()

    setTokens({ accessToken: 'at', refreshToken: 'rt', expiresIn: 900 })
    emitSessionExpired('刷新令牌已失效，请重新登录')

    expect(events.map((e) => e.type)).toEqual(['changed', 'expired'])
    expect(events[1].reason).toBe('刷新令牌已失效，请重新登录')
  })

  it('取消订阅后不再收到事件', () => {
    const events = watch()
    unsubs.forEach((off) => off())
    unsubs = []

    setTokens({ accessToken: 'at', refreshToken: 'rt', expiresIn: 900 })

    expect(events).toEqual([])
  })

  it('单个订阅者抛异常不会影响其他订阅者（也不影响令牌本身）', () => {
    const events = []
    unsubs.push(
      subscribe(() => {
        throw new Error('boom')
      }),
    )
    unsubs.push(subscribe((e) => events.push(e)))

    setTokens({ accessToken: 'at', refreshToken: 'rt', expiresIn: 900 })

    expect(events.map((e) => e.type)).toEqual(['changed'])
    expect(getAccessToken()).toBe('at')
  })
})
