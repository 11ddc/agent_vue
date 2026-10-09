import axios from 'axios'

import {
  clearTokens,
  emitSessionExpired,
  getAccessToken,
  getRefreshToken,
  isAccessTokenFresh,
  setTokens,
} from './tokenStore.js'

// 真实后端请求实例
// 通过 Vite 代理转发：/api/xxx → http://127.0.0.1:8000/api/xxx
//
// timeout 从 10s 放宽到 120s：后端走的是「混合检索 → 精排 → 生成」链路，
// 精排 p90 就要 5.8s，加上 LLM 生成，一次同步问答很容易超过 10s。
// 10s 会把一个正在正常工作的请求判成失败。上传接口单独传更长的 timeout。
const api = axios.create({
  baseURL: '/api',
  timeout: 120000,
})

/**
 * 刷新令牌专用标记。
 *
 * 刷新请求走的是**同一个** api 实例，靠这个标记让响应拦截器不要处理它自己的 401。
 * 为什么不另建一个"不挂拦截器的裸实例"：那样确实也能防递归，但刷新路径就完全
 * 在测试里够不着了（除非把裸实例也导出，纯粹为了测试污染公开接口）。
 * 用标记的话，"刷新也会失败"这条分支可以在同一个 adapter 上完整测出来。
 */
const REFRESH_CONFIG = { skipAuthRefresh: true, timeout: 30000 }

/** 单飞：多个请求同时 401 时只发一次刷新，其余等同一个 Promise */
let refreshing = null

/**
 * 用刷新令牌换一对新令牌（后端是**轮换**的：旧的立即作废）。
 *
 * @returns {Promise<string|null>} 新的访问令牌；刷新不了就是 null（并且已清空登录态）
 */
export async function refreshAccessToken() {
  const token = getRefreshToken()
  if (!token) return null

  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await api.post('/auth/refresh', { refresh_token: token }, REFRESH_CONFIG)
        const data = res.data || {}
        if (!data.access_token) throw new Error('刷新响应里没有 access_token')
        setTokens({
          accessToken: data.access_token,
          refreshToken: data.refresh_token, // 轮换后必须**换掉**旧的，否则下次刷新会用已消费的令牌
          expiresIn: data.expires_in,
        })
        return data.access_token
      } catch (err) {
        // 刷新令牌已失效（过期 / 已登出 / 重放检测）——只能重新登录。
        // 注意：后端在检测到"已撤销的刷新令牌被重放"时会撤销该账号**全部**刷新令牌，
        // 所以这里不是"重试一下就好"，而是确定性地结束会话。
        clearTokens()
        emitSessionExpired(describeError(err, ''))
        return null
      } finally {
        refreshing = null
      }
    })()
  }
  return refreshing
}

/**
 * 拿一个**尽量新鲜**的访问令牌；没有或快过期就先刷新。
 * 手写 fetch 的那条链路（SSE）不走 axios 拦截器，必须显式调这个。
 *
 * @returns {Promise<string>} 令牌；空串表示"没有可用的令牌"
 */
export async function ensureAccessToken() {
  if (isAccessTokenFresh()) return getAccessToken()
  if (getRefreshToken()) {
    const fresh = await refreshAccessToken()
    if (fresh) return fresh
  }
  return getAccessToken() || ''
}

// ── 请求拦截器：带上访问令牌 ──────────────────────────────────
api.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token && !config.skipAuth) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ── 响应拦截器：401 时刷新一次并重试原请求 ────────────────────
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const config = err?.config
    const status = err?.response?.status

    // 只处理 401，且只重试一次。
    // skipAuthRefresh 是登录/注册/刷新自己标的：它们的 401 是"密码错了"这类**业务结果**，
    // 去刷新既没意义，还会误清登录态。
    if (status !== 401 || !config || config.skipAuthRefresh || config._authRetried) {
      throw err
    }

    const fresh = await refreshAccessToken()
    if (!fresh) throw err // 刷新不了：把原始 401 抛给调用方，文案由它决定

    config._authRetried = true
    config.headers = { ...config.headers, Authorization: `Bearer ${fresh}` }
    return api.request(config)
  },
)

/**
 * 把 axios 的错误翻译成一句能直接给用户看的中文。
 *
 * 后端有几种"错误"不是网络故障，而是业务拒绝，必须把原文透出来：
 *   - /api/upload 用 HTTPException(413/400) → 错误体在 err.response.data.detail
 *   - 另有 200 + {success:false, error} 的情况，那属于正常返回，不走这里
 *
 * ⚠️ 顺序很重要：**先 detail 再按状态码兜底**。
 *    像登录失败（401 + "用户名或密码不正确"）这类，后端文案就是给用户看的；
 *    如果先按 401 映射成"登录状态已失效"，登录页就会对一次输错密码提示"会话过期"。
 *    状态码兜底只负责"后端没给 detail"的那种情况。
 */
export function describeError(err, fallback = '请求失败，请稍后重试') {
  if (axios.isCancel?.(err) || err?.name === 'AbortError' || err?.code === 'ERR_CANCELED') {
    return '已取消'
  }
  if (err?.code === 'ECONNABORTED') {
    return '请求超时：后端处理时间过长，请稍后重试'
  }
  const data = err?.response?.data
  const status = err?.response?.status
  if (data) {
    if (typeof data === 'string' && data.trim()) return data.trim()
    if (data.detail) {
      // FastAPI 的校验错误里 detail 是数组，取第一条的 msg
      if (Array.isArray(data.detail)) {
        const first = data.detail[0]
        if (first?.msg) return `参数错误：${first.msg}`
      } else {
        return String(data.detail)
      }
    }
    if (data.error) return String(data.error)
    if (data.message) return String(data.message)
  }
  // 后端没给可读文案时，按状态码说人话（401/403/429/503 的含义完全不同，
  // 见 my-agent-api/auth/deps.py：401 去登录、403 找管理员要权限、503 是服务端暂时不可用）
  if (status === 401) return '登录状态已失效，请重新登录'
  if (status === 403) return '没有权限执行这个操作'
  if (status === 429) return `请求过于频繁${retryHint(err)}，请稍后再试`
  if (status === 503) return '服务暂时不可用，请稍后重试'
  if (status === 413) return '文件过大，已被服务端拒绝'
  if (status) return `请求失败（HTTP ${status}）`
  if (err?.message === 'Network Error') {
    // 不写死 127.0.0.1:8000：开发和生产的后端地址不是同一个（生产走 nginx 同源反代）
    return '连不上后端服务，请确认后端已启动'
  }
  return err?.message ? String(err.message) : fallback
}

/** 限流响应会带 Retry-After，能读到就告诉用户还要等多久 */
function retryHint(err) {
  const raw = err?.response?.headers?.['retry-after']
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? `（约 ${Math.ceil(seconds)} 秒后可重试）` : ''
}

export default api
