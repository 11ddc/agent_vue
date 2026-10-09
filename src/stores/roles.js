import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { DEFAULT_ROLE_ID, ROLES, getRole, resolveActiveRole } from '@/config/roles.js'
import { readString, write } from '@/utils/storage.js'

const STORAGE_KEY = 'chat_role_id'

export const useRolesStore = defineStore('roles', () => {
  // 存进去的可能是脏值（手改过、版本升级删过角色、选过后来下线的角色），
  // 一律过一遍 resolveActiveRole：它保证拿到的一定是**可用**角色
  const stored = readString(STORAGE_KEY, DEFAULT_ROLE_ID)
  const currentId = ref(resolveActiveRole(stored).id)
  // 兜底替用户改过就顺手写回，免得脏值一直躺在 localStorage 里
  if (currentId.value !== stored) write(STORAGE_KEY, currentId.value)

  const currentRole = computed(() => getRole(currentId.value))

  /**
   * @returns {boolean} 是否真的发生了切换。
   * 调用方靠它决定要不要重置会话——重复点当前角色不该清空正在进行的对话。
   *
   * 未开放的角色（`available: false`）一律拒绝：切换意味着换人设 + 清空会话，
   * 而这两件事后端都还没有能力支持，划过去只会让用户以为换成功了。
   * 界面上的"功能未开放"提示由调用方（侧边栏）负责，store 只做状态把关。
   */
  function setRole(id) {
    const next = getRole(id)
    if (!next.available) return false
    if (next.id === currentId.value) return false
    currentId.value = next.id
    write(STORAGE_KEY, next.id)
    return true
  }

  return { list: ROLES, currentId, currentRole, setRole }
})
