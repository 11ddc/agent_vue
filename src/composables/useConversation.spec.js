import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useConversation } from './useConversation.js'
import { DEFAULT_ROLE_ID, getRole } from '@/config/roles.js'

/**
 * 这个文件盯的是"角色 ↔ 会话"的接线。
 *
 * 为什么要单独测：这是唯一一处知道"新会话要用当前角色开场白"的逻辑。
 * 接错了会出两种很难发现的错：
 *   1. 切到客服了，但新会话还是通用助手的欢迎语；
 *   2. 重复点当前角色，把正在进行的对话清空了。
 *
 * 现在还多了一条约束：**未开放的角色点了不能真的切过去**（见 config/roles.js），
 * 否则用户会以为换了一个人设，实际后端请求体一模一样。
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

  /**
   * 临时把一个占位角色标成可用，跑完改回来。
   *
   * 现在只有"文档问答"是开放的，所以"切换角色要重置会话""切换后要记住选择"
   * 这两条契约在默认状态下根本走不到。可它们是 switchRole 的核心行为，
   * 将来把 available 打开时不能失效，所以这里改一下标志位把它们盯住。
   */
  function withRoleAvailable(id, run) {
    const role = getRole(id)
    const original = role.available
    role.available = true
    try {
      return run(role)
    } finally {
      role.available = original
    }
  }

  it('默认角色是文档问答，开场白来自角色预设而不是硬编码在 store 里', () => {
    expect(conv.roles.currentId).toBe(DEFAULT_ROLE_ID)
    expect(conv.chat.messages).toHaveLength(1)
    expect(conv.chat.messages[0].content).toBe(getRole(DEFAULT_ROLE_ID).welcome)
  })

  it('新会话用当前角色的开场白，并清掉后端 session_id', () => {
    seedConversation()

    conv.newSession()

    expect(conv.chat.messages).toHaveLength(1)
    expect(conv.chat.messages[0].role).toBe('assistant')
    expect(conv.chat.messages[0].content).toBe(getRole(DEFAULT_ROLE_ID).welcome)
    expect(conv.chat.sessionId).toBe('')
    expect(sessionStorage.getItem('chat_session_id')).toBeNull()
  })

  it('未开放的角色拒绝切换：不换人设、不清空正在进行的对话、不写进 localStorage', () => {
    seedConversation()
    const before = conv.chat.messages.length

    expect(conv.switchRole('service')).toBe(false)
    expect(conv.switchRole('general')).toBe(false)

    expect(conv.roles.currentId).toBe(DEFAULT_ROLE_ID)
    expect(conv.chat.messages).toHaveLength(before)
    expect(conv.chat.messages[1].content).toBe('你好')
    expect(conv.chat.sessionId).toBe('s-old')
    expect(localStorage.getItem('chat_role_id')).toBeNull()
  })

  it('切到一个已开放的角色：开场白、会话、记忆三件事一起生效', () => {
    withRoleAvailable('service', (service) => {
      seedConversation()

      expect(conv.switchRole('service')).toBe(true)

      expect(conv.roles.currentId).toBe('service')
      expect(conv.roles.currentRole.name).toBe('客服小优')
      expect(conv.chat.messages).toHaveLength(1)
      expect(conv.chat.messages[0].content).toBe(service.welcome)
      // 不换 session_id 的话新旧角色上下文会串在 Redis 里
      expect(conv.chat.sessionId).toBe('')
      expect(conv.chat.hasSession).toBe(false)
      expect(sessionStorage.getItem('chat_session_id')).toBeNull()
      // 角色选择会被记住，下次进来还是它
      expect(localStorage.getItem('chat_role_id')).toBe('service')
    })
  })

  it('重复点当前角色：返回 false，且**不清空**正在进行的对话', () => {
    seedConversation()
    const before = conv.chat.messages.length

    expect(conv.switchRole(DEFAULT_ROLE_ID)).toBe(false)

    expect(conv.chat.messages).toHaveLength(before)
    expect(conv.chat.messages[1].content).toBe('你好')
    expect(conv.chat.sessionId).toBe('s-old')
  })

  it('未知角色 id 回落到默认角色，而不是切到一个不存在的角色', () => {
    withRoleAvailable('service', () => {
      conv.switchRole('service')
      expect(conv.roles.currentId).toBe('service')

      // 脏 id 被 getRole 兜成默认角色 docs，所以这一次是真实切换
      expect(conv.switchRole('不存在')).toBe(true)
      expect(conv.roles.currentId).toBe(DEFAULT_ROLE_ID)
    })
  })

  it('已经在默认角色上时，传未知 id 不该被误判成切换（否则会白清一次会话）', () => {
    expect(conv.switchRole('不存在')).toBe(false)
    expect(conv.roles.currentId).toBe(DEFAULT_ROLE_ID)
  })

  it('localStorage 里存了脏值时回落到默认角色，而不是白屏', () => {
    localStorage.setItem('chat_role_id', '被删掉的角色')
    setActivePinia(createPinia())
    const fresh = useConversation()

    expect(fresh.roles.currentId).toBe(DEFAULT_ROLE_ID)
    // 兜底替用户改过就顺手写回，免得脏值一直躺在 localStorage 里
    expect(localStorage.getItem('chat_role_id')).toBe(DEFAULT_ROLE_ID)
  })

  it('存着已下线的角色（上一版选的客服小优）也回落到默认角色，且开场白跟着换', () => {
    localStorage.setItem('chat_role_id', 'service')
    setActivePinia(createPinia())
    const fresh = useConversation()

    expect(fresh.roles.currentId).toBe(DEFAULT_ROLE_ID)
    expect(fresh.chat.messages[0].content).toBe(getRole(DEFAULT_ROLE_ID).welcome)
    expect(localStorage.getItem('chat_role_id')).toBe(DEFAULT_ROLE_ID)
  })
})
