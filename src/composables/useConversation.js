import { useChatStore } from '@/stores/chat.js'
import { useRolesStore } from '@/stores/roles.js'

/**
 * 把「角色」和「会话」接起来。
 *
 * 单独抽出来的原因：这段逻辑有两个调用点（侧边栏切角色、头部开新会话），
 * 而且它是唯一一处知道"新会话要用当前角色的开场白"的地方——
 * 散在两个组件里迟早会出现"切到客服了，但新会话还是通用助手的欢迎语"这种 bug。
 */
export function useConversation() {
  const chat = useChatStore()
  const roles = useRolesStore()

  /** 开一个新会话：换掉后端 session_id，用**当前角色**的开场白 */
  function newSession() {
    chat.reset(roles.currentRole.welcome)
  }

  /**
   * 切换角色 = 开一个属于新角色的新会话。
   *
   * 必须重置会话而不只是换文案：后端的历史是按 session_id 存在 Redis 里的，
   * 不换 id 的话新角色的开场白会和旧角色的上下文混在一起。
   *
   * @returns {boolean} 是否真的切换了
   */
  function switchRole(id) {
    if (!roles.setRole(id)) return false
    chat.reset(roles.currentRole.welcome)
    return true
  }

  return { chat, roles, newSession, switchRole }
}
