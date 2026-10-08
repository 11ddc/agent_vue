import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  readBool,
  readSessionString,
  readString,
  remove,
  removeSession,
  write,
  writeSession,
} from './storage.js'

describe('storage 安全包装', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('localStorage 正常读写与删除', () => {
    write('k', 'v')
    expect(readString('k')).toBe('v')
    remove('k')
    expect(readString('k')).toBe('')
  })

  it('sessionStorage 正常读写与删除', () => {
    writeSession('s', 'abc')
    expect(readSessionString('s')).toBe('abc')
    removeSession('s')
    expect(readSessionString('s')).toBe('')
  })

  it('键不存在时返回兜底值', () => {
    expect(readString('missing', 'fallback')).toBe('fallback')
    expect(readSessionString('missing', 'fallback')).toBe('fallback')
    expect(readBool('missing', true)).toBe(true)
    expect(readBool('missing')).toBe(false)
  })

  it('非法布尔字面量回落到兜底值，而不是被当成 true', () => {
    localStorage.setItem('junk', 'yes')
    expect(readBool('junk', false)).toBe(false)
    expect(readBool('junk', true)).toBe(true)
  })

  it('读被禁用时抛异常也要返回兜底值（隐私模式）', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(readString('k', 'safe')).toBe('safe')
    expect(readSessionString('k', 'safe')).toBe('safe')
    expect(readBool('k', true)).toBe(true)
  })

  it('写/删被禁用时吞掉异常，不让应用白屏', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(() => write('k', 'v')).not.toThrow()
    expect(() => writeSession('k', 'v')).not.toThrow()
    expect(() => remove('k')).not.toThrow()
    expect(() => removeSession('k')).not.toThrow()
  })
})
