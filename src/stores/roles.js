import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { DEFAULT_ROLE_ID, ROLES, getRole } from '@/config/roles.js'
import { readString, write } from '@/utils/storage.js'

const STORAGE_KEY = 'chat_role_id'

export const useRolesStore = defineStore('roles', () => {
  // 存进去的可能是脏值（手改过、版本升级删过角色），一律过一遍 getRole 兜底
  const currentId = ref(getRole(readString(STORAGE_KEY, DEFAULT_ROLE_ID)).id)

  const currentRole = computed(() => getRole(currentId.value))

  /**
   * @returns {boolean} 是否真的发生了切换。
   * 调用方靠它决定要不要重置会话——重复点当前角色不该清空正在进行的对话。
   */
  function setRole(id) {
    const next = getRole(id).id
    if (next === currentId.value) return false
    currentId.value = next
    write(STORAGE_KEY, next)
    return true
  }

  return { list: ROLES, currentId, currentRole, setRole }
})
