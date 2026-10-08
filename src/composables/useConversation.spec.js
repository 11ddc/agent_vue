import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useConversation } from './useConversation.js'
import { getRole } from '@/config/roles.js'

/**
 * 这个文件盯的是"角色 ↔ 会话"的接线。
 *
 * 为什么要单独测：这是唯一一处知道"新会话要用当前角色开场白"的逻辑。
 * 接错了会出两种很难发现的错：
 *   1. 切到客服了，但新会话还是通用助手的欢迎语；
 *   2. 重复点当前角色，把正在进行的对话清空了。
 */
describe('useConversation', () => {
  let conv

  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    sessionStorage.clear()
    conv = useConversation()
  })

  function seedConversation() {
    conv.chat.messages.push({
      id: 'u-1',
      role: 'user',
      content: '你好',
      time: new Date().toISOString(),
    })
    conv.chat.sessionId = 's-old'
    sessionStorage.setItem('chat_session_id', 's-old')
  }

  it('默认角色是通用助手，开场白来自角色预设而不是硬编码在 store 里', () => {
    expect(conv.roles.currentId).toBe('general')
    expect(conv.chat.messages).toHaveLength(1)
    expect(conv.chat.messages[0].content).toBe(getRole('general').welcome)
  })

  it('新会话用当前角色的开场白，并清掉后端 session_id', () => {
    seedConversation()

    conv.newSession()

    expect(conv.chat.messages).toHaveLength(1)
    expect(conv.chat.messages[0].role).toBe('assistant')
    expect(conv.chat.messages[0].content).toBe(getRole('general').welcome)
    expect(conv.chat.sessionId).toBe('')
    expect(sessionStorage.getItem('chat_session_id')).toBeNull()
  })

  it('切换角色后，开场白换成新角色的（不是通用助手的）', () => {
    expect(conv.switchRole('service')).toBe(true)

    expect(conv.roles.currentId).toBe('service')
    expect(conv.roles.currentRole.name).toBe('客服小优')
    expect(conv.chat.messages).toHaveLength(1)
    expect(conv.chat.messages[0].content).toBe(getRole('service').welcome)
    expect(conv.chat.messages[0].content).not.toBe(getRole('general').welcome)
  })

  it('切换角色会重置会话：不换 session_id 的话新旧角色上下文会串在 Redis 里', () => {
    seedConversation()

    conv.switchRole('docs')

    expect(conv.chat.sessionId).toBe('')
    expect(conv.chat.hasSession).toBe(false)
    expect(sessionStorage.getItem('chat_session_id')).toBeNull()
  })

  it('重复点当前角色：返回 false，且**不清空**正在进行的对话', () => {
    seedConversation()
    const before = conv.chat.messages.length

    expect(conv.switchRole('general')).toBe(false)

    expect(conv.chat.messages).toHaveLength(before)
    expect(conv.chat.messages[1].content).toBe('你好')
    expect(conv.chat.sessionId).toBe('s-old')
  })

  it('未知角色 id 回落到默认角色，而不是切到一个不存在的角色', () => {
    conv.switchRole('service')
    expect(conv.roles.currentId).toBe('service')

    // 脏 id 被 getRole 兜成第一个角色 general，所以这一次是真实切换
    expect(conv.switchRole('不存在')).toBe(true)
    expect(conv.roles.currentId).toBe('general')
  })

  it('已经在默认角色上时，传未知 id 不该被误判成切换（否则会白清一次会话）', () => {
    expect(conv.switchRole('不存在')).toBe(false)
    expect(conv.roles.currentId).toBe('general')
  })

  it('角色选择会被记住（下次进来还是这个角色）', () => {
    conv.switchRole('service')
    expect(localStorage.getItem('chat_role_id')).toBe('service')
  })

  it('localStorage 里存了脏值时回落到默认角色，而不是白屏', () => {
    localStorage.setItem('chat_role_id', '被删掉的角色')
    setActivePinia(createPinia())
    const fresh = useConversation()
    expect(fresh.roles.currentId).toBe('general')
  })
})
