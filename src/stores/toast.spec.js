import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOAST_DURATION, useToastStore } from './toast.js'

/**
 * 提示浮层 store。
 *
 * 重点在两件容易写错的事：
 *   1. 自动消失（有定时器 → 必须用假定时器测，不然要么等 3 秒、要么漏测）；
 *   2. 连点同一个入口不能叠出一摞一模一样的浮层。
 */
describe('toast store', () => {
  let toast

  beforeEach(() => {
    setActivePinia(createPinia())
    toast = useToastStore()
    vi.useFakeTimers()
  })

  afterEach(() => {
    // 先把待触发的定时器收掉，再关掉假定时器，避免跨用例泄漏
    toast.clear()
    vi.useRealTimers()
  })

  it('notify 推一条提示，文案去掉首尾空白', () => {
    const id = toast.notify('  「客服小优」功能未开放  ')

    expect(id).toBeTypeOf('number')
    expect(toast.items).toHaveLength(1)
    expect(toast.items[0].message).toBe('「客服小优」功能未开放')
  })

  it('默认 TOAST_DURATION 之后自动消失', () => {
    toast.notify('功能未开放')

    vi.advanceTimersByTime(TOAST_DURATION - 1)
    expect(toast.items).toHaveLength(1)

    vi.advanceTimersByTime(1)
    expect(toast.items).toHaveLength(0)
  })

  it('duration 传 0 表示不自动消失，只能手动关', () => {
    const id = toast.notify('需要用户确认', { duration: 0 })

    vi.advanceTimersByTime(TOAST_DURATION * 10)
    expect(toast.items).toHaveLength(1)

    toast.dismiss(id)
    expect(toast.items).toHaveLength(0)
  })

  it('连点同一个入口：复用最后一条，不叠一摞，且倒计时重新开始', () => {
    const first = toast.notify('「客服小优」功能未开放')
    vi.advanceTimersByTime(TOAST_DURATION - 500)
    const second = toast.notify('「客服小优」功能未开放')

    expect(second).toBe(first)
    expect(toast.items).toHaveLength(1)

    // 若没重新计时，这条在 500ms 后就该消失
    vi.advanceTimersByTime(500)
    expect(toast.items).toHaveLength(1)

    vi.advanceTimersByTime(TOAST_DURATION - 500)
    expect(toast.items).toHaveLength(0)
  })

  it('不同文案各自一条，互不影响', () => {
    const a = toast.notify('第一条')
    vi.advanceTimersByTime(1000)
    const b = toast.notify('第二条')

    expect(a).not.toBe(b)
    expect(toast.items.map((item) => item.message)).toEqual(['第一条', '第二条'])

    // 第一条到点先走，第二条还在
    vi.advanceTimersByTime(TOAST_DURATION - 1000)
    expect(toast.items.map((item) => item.message)).toEqual(['第二条'])
  })

  it('空白文案不弹（不给空浮层）', () => {
    expect(toast.notify('')).toBeNull()
    expect(toast.notify('   ')).toBeNull()
    expect(toast.notify(null)).toBeNull()
    expect(toast.notify(undefined)).toBeNull()
    expect(toast.items).toHaveLength(0)
  })

  it('dismiss 掉不存在的 id 不报错', () => {
    toast.notify('功能未开放')
    expect(() => toast.dismiss(999)).not.toThrow()
    expect(toast.items).toHaveLength(1)
  })

  it('clear 清空全部，并取消还没到点的定时器', () => {
    toast.notify('第一条')
    toast.notify('第二条')

    toast.clear()
    expect(toast.items).toHaveLength(0)

    // 旧定时器若还挂着，到点会来 dismiss 一个已经不存在的 id
    vi.advanceTimersByTime(TOAST_DURATION)
    expect(toast.items).toHaveLength(0)
  })
})
