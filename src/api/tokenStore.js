import { readString, remove, write } from '@/utils/storage.js'

/**
 * 令牌持有者。
 *
 * ── 为什么单独一个模块，而不是放在 Pinia store 里 ────────────────
 * `client.js` 的拦截器**读**它，`stores/auth.js` **写**它。如果把它塞进 store，
 * 就会形成 `client.js → stores/auth.js → api/auth.js → client.js` 的循环 import，
 * 而 axios 拦截器是在模块加载期注册的 —— 循环到这一步会拿到 undefined，
 * 报错时机还很难定位。所以这里做成"零依赖 + 纯函数"的模块：
 * 只依赖 localStorage 的安全包装，不 import axios、不 import 任何 store。
 *
 * ── 两个令牌的存法不一样（这是刻意的）────────────────────────────
 * - **访问令牌只放内存**：刷新页面就没了，必须靠刷新令牌重新换一对。
 *   放 localStorage 会让它更容易被 XSS 捞走，而它本来只有 15 分钟寿命，
 *   持久化带来的唯一好处（少一次刷新）不值得。
 * - **刷新令牌放 localStorage**：这是"关掉浏览器再打开还登录着"的唯一来源。
 *   代价是 XSS 能读到它 —— 后端没有 httpOnly Cookie 方案（它把令牌放在 JSON 响应体里），
 *   所以这个取舍是当前接口形态下必付的，不是疏忽。
 */

const REFRESH_KEY = 'auth_refresh_token'

/** 提前这么多毫秒就认为访问令牌"该换了"，避免卡在过期瞬间发出请求 */
const SKEW_MS = 30 * 1000

let accessToken = ''
let expiresAt = 0 // 毫秒时间戳；0 = 未知（那就交给 401 去发现）

/* ===== 访问令牌 ===== */

export function getAccessToken() {
  return accessToken
}

export function isAccessTokenFresh() {
  if (!accessToken) return false
  if (!expiresAt) return true // 不知道到期时间就别自作主张去刷新
  return Date.now() < expiresAt - SKEW_MS
}

/* ===== 刷新令牌 ===== */

export function getRefreshToken() {
  return readString(REFRESH_KEY, '')
}

export function setRefreshToken(token) {
  if (token) write(REFRESH_KEY, token)
  else remove(REFRESH_KEY)
}

/* ===== 一起写 ===== */

/**
 * 落一对令牌。
 *
 * @param {{accessToken?: string, refreshToken?: string, expiresIn?: number}} pair
 *   `expiresIn` 是后端给的**秒**数（TokenResponse.expires_in，默认 900）。
 *   刷新响应里没有它就退化成"未知到期时间"，靠 401 兜底。
 */
export function setTokens({ accessToken: access, refreshToken, expiresIn } = {}) {
  if (access !== undefined) {
    accessToken = String(access || '')
    expiresAt = Number(expiresIn) > 0 ? Date.now() + Number(expiresIn) * 1000 : 0
  }
  if (refreshToken !== undefined) setRefreshToken(refreshToken)
  notify()
}

/** 只换访问令牌，不动刷新令牌的内存态（刷新失败时用不上，但语义要清楚） */
export function setAccessToken(access, expiresIn) {
  setTokens({ accessToken: access, expiresIn })
}

/** 清空全部令牌：登出、刷新被拒、重放检测踢下线，都走这里 */
export function clearTokens() {
  accessToken = ''
  expiresAt = 0
  setRefreshToken('')
  notify()
}

/* ===== 订阅：令牌变了 / 登录态没了 ===== */

const listeners = new Set()

/**
 * 订阅令牌变化。
 *
 * @param {(event: {type: 'changed'|'expired', reason?: string}) => void} fn
 * @returns {() => void} 取消订阅
 */
export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notify(event = { type: 'changed' }) {
  // 先取快照再遍历：订阅回调里可能会取消订阅（例如组件卸载），
  // 直接 for…of 迭代 Set 时改动它虽然不报错，但语义容易看错。
  for (const fn of Array.from(listeners)) {
    try {
      fn(event)
    } catch {
      /* 单个订阅者出错不该影响令牌本身的状态变更 */
    }
  }
}

/**
 * 宣告"当前会话已失效"。
 *
 * 触发点是刷新令牌被后端拒绝（过期 / 已撤销 / 重放检测）。为什么要有这个事件，
 * 而不是让调用方各自判断：401 可能来自任意一个并发请求，而"该去登录页了"是**全局**决定。
 * 由 App.vue 订阅它做跳转，避免每个组件都写一遍。
 */
export function emitSessionExpired(reason = '') {
  notify({ type: 'expired', reason })
}
