import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  fetchMe,
  login as loginApi,
  logout as logoutApi,
  register as registerApi,
  roleLabel,
} from '@/api/auth.js'
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
  subscribe,
} from '@/api/tokenStore.js'
import { ensureAccessToken } from '@/api/client.js'
import { useChatStore } from '@/stores/chat.js'

/**
 * 登录态。
 *
 * 三层结构，各管一件事，别混：
 *   tokenStore（内存/localStorage）—— 令牌本身，零依赖，给 axios 拦截器读
 *   api/auth.js                    —— HTTP 细节与错误翻译
 *   store（这里）                  —— 身份、角色、加载状态，给界面用
 *
 * ⚠️ 访问令牌**不在**这里存：它只在 tokenStore 的内存里。刷新页面后靠刷新令牌
 * 重新换一对（`restore()`），所以"已登录"不能简单等同于"user 不为空"。
 */
export const useAuthStore = defineStore('auth', () => {
  /** 'unknown'（还没判断）| 'anonymous' | 'authenticated' */
  const status = ref('unknown')
  const user = ref(null)
  const busy = ref(false)
  const lastError = ref('')
  /** 会话失效原因，用于登录页给一句解释（"会话已过期，请重新登录"） */
  const expiredReason = ref('')

  let readyPromise = null

  const isAuthenticated = computed(() => status.value === 'authenticated' && !!user.value)
  const role = computed(() => user.value?.role || '')
  const username = computed(() => user.value?.username || '')
  const displayName = computed(() => user.value?.display_name || user.value?.username || '')
  const roleText = computed(() => (role.value ? roleLabel(role.value) : ''))

  /**
   * 能不能写知识库。
   *
   * 与后端 `require_roles("kb_admin")` 对齐：admin 天然包含 kb_admin（角色继承在
   * auth/deps.py::_ROLE_GRANTS）。operator 只能**看**文档清单，不能上传。
   * 这个判断只用来隐藏入口 —— 后端那道 403 才是真正的边界。
   */
  const canManageKb = computed(() => role.value === 'admin' || role.value === 'kb_admin')

  /** 头像用的首字（中文取第一个字，英文取首字母） */
  const initial = computed(() => (displayName.value || '?').trim().charAt(0).toUpperCase())

  /**
   * 会话被踢下线（刷新令牌过期/被撤销/重放检测）。
   *
   * 这个事件来自 tokenStore，可能由**任意**一个并发请求的 401 触发，
   * 所以处理放在 store 里统一做，而不是散在每个调用点。
   */
  subscribe((event) => {
    if (event.type === 'expired') {
      expiredReason.value = event.reason || ''
      resetLocal()
    }
  })

  /** 清掉一切"属于某个用户"的本地状态 */
  function resetLocal() {
    clearTokens()
    user.value = null
    status.value = 'anonymous'
    // 后端的历史是按「租户:用户:session_id」存 Redis 的。换了身份还留着旧的
    // session_id，前端会以为在续上一段对话，而后端那边其实是空白 —— 必须清掉。
    try {
      useChatStore().reset()
    } catch {
      /* store 还没初始化（例如极早的恢复阶段）时忽略 */
    }
  }

  /** 把后端的 TokenResponse 落到本地 */
  function applySession(data) {
    if (!data?.access_token) throw new Error('登录响应里没有 access_token')
    setTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    })
    user.value = data.user || null
    status.value = 'authenticated'
    expiredReason.value = ''
    lastError.value = ''
    // 换身份就换一段对话：上一个用户的消息和 session_id 都不该留着
    try {
      useChatStore().reset()
    } catch {
      /* 同上 */
    }
  }

  /**
   * 刷新页面后的恢复：访问令牌只放内存，所以必须用刷新令牌换一对，
   * 再用 /api/auth/me 拿回**库里的**身份（不是令牌里的，角色可能已变）。
   */
  async function restore() {
    if (!getRefreshToken()) {
      status.value = 'anonymous'
      return
    }
    try {
      await ensureAccessToken() // 失败时它会 clearTokens + 发 expired 事件
      if (!getAccessToken()) {
        status.value = 'anonymous'
        return
      }
      user.value = await fetchMe()
      status.value = 'authenticated'
    } catch (err) {
      // 令牌还在但 /me 拿不到身份（被禁用 / 网络断了）：当作未登录，
      // 但不能把刷新令牌删掉 —— 网络问题不该让用户丢掉登录态。
      user.value = null
      status.value = 'anonymous'
      lastError.value = err?.message ? String(err.message) : ''
    }
  }

  /**
   * 路由守卫与首屏都会调它；单飞，保证只跑一次。
   * @returns {Promise<'anonymous'|'authenticated'>}
   */
  function ensureReady() {
    if (status.value !== 'unknown') return Promise.resolve(status.value)
    if (!readyPromise) {
      readyPromise = restore()
        .finally(() => {
          // restore 内部已经会落定状态，这里只是兜住"它没设"的情况
          if (status.value === 'unknown') status.value = 'anonymous'
        })
        // 显式返回状态字符串：调用方（守卫、测试）靠它判断，别让它拿到 undefined
        .then(() => status.value)
    }
    return readyPromise
  }

  async function login({ username: name, password }) {
    busy.value = true
    lastError.value = ''
    try {
      applySession(await loginApi({ username: name, password }))
      return true
    } catch (err) {
      lastError.value = err?.message || '登录失败'
      return false
    } finally {
      busy.value = false
    }
  }

  /** 注册即登录：后端 201 直接返回一对令牌 */
  async function register({ username: name, password, displayName: nick }) {
    busy.value = true
    lastError.value = ''
    try {
      applySession(await registerApi({ username: name, password, displayName: nick }))
      return true
    } catch (err) {
      lastError.value = err?.message || '注册失败'
      return false
    } finally {
      busy.value = false
    }
  }

  async function logout() {
    const refresh = getRefreshToken()
    busy.value = true
    try {
      // 尽力而为：后端撤销失败（网络断了 / 已过期）也必须让用户登出，
      // 否则"点了登出却还在登录态"比撤销失败本身更糟。
      if (getAccessToken()) await logoutApi(refresh)
    } catch {
      /* 忽略：下面一定会清本地状态 */
    } finally {
      busy.value = false
      resetLocal()
    }
  }

  function clearError() {
    lastError.value = ''
  }

  function clearExpiredReason() {
    expiredReason.value = ''
  }

  return {
    // 状态
    status,
    user,
    busy,
    lastError,
    expiredReason,
    // 派生
    isAuthenticated,
    role,
    roleText,
    username,
    displayName,
    initial,
    canManageKb,
    // 动作
    ensureReady,
    restore,
    login,
    register,
    logout,
    clearError,
    clearExpiredReason,
  }
})
