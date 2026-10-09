import api, { describeError } from './client.js'

/**
 * 认证接口封装：`/api/auth/*`（见 my-agent-api/api/auth.py）。
 *
 * 三条不能忘的细节：
 *   1. 这几个接口都标了 `skipAuthRefresh` —— 它们的 401 是**业务结果**（密码不对、
 *      刷新令牌失效），不是"访问令牌过期"。让拦截器去刷新既没意义，还会误清登录态。
 *   2. 注册成功是 **201**，而且**直接返回一对令牌**（等于注册即登录），不用再调一次 login。
 *   3. 自助注册拿到的角色由**服务端硬编码**为最低权限 user；请求里传 role/tenant
 *      不但无效，还是明确的攻击面（后端拒收）。所以这里根本不发这两个字段。
 */

/** 业务错误：让调用方能区分"字段该标红"和"整体失败" */
export class AuthError extends Error {
  constructor(message, { status = null, kind = 'unknown' } = {}) {
    super(message)
    this.name = 'AuthError'
    this.status = status
    this.kind = kind
  }
}

/**
 * 状态码 → 语义标签。
 *
 * 文案一律交给 client.js 的 `describeError`：它已经保证**先读后端 detail**，
 * 而后端这几个接口的 detail 本来就是给用户看的中文
 * （"用户名或密码不正确" / "账号已被禁用，请联系管理员" / "用户名已存在" /
 *   "账号因多次登录失败被临时锁定，请稍后再试"）。
 * 在这里另写一套映射只会和它漂移，还会把好文案换成差文案。
 */
function kindOf(status) {
  if (status === 401) return 'bad-credentials'
  if (status === 403) return 'forbidden'
  if (status === 409) return 'duplicate'
  if (status === 422) return 'invalid'
  if (status === 429) return 'locked'
  if (status === 503) return 'unavailable'
  return 'transport'
}

function wrap(err, fallback) {
  const status = err?.response?.status ?? null
  return new AuthError(describeError(err, fallback), { status, kind: kindOf(status) })
}

/**
 * 登录。
 *
 * ⚠️ 后端刻意不区分"用户不存在"和"密码错误"（都返回 401 + "用户名或密码不正确"），
 * 前端也不该自作聪明去猜 —— 那等于把服务端刚堵上的用户名枚举又泄回来。
 */
export async function login({ username, password }) {
  try {
    const res = await api.post('/auth/login', { username, password }, { skipAuthRefresh: true })
    return res.data
  } catch (err) {
    throw wrap(err, '登录失败，请检查用户名和密码')
  }
}

/**
 * 自助注册。成功（201）直接返回令牌，调用方按"已登录"处理。
 *
 * 密码规则必须与后端 `auth/security.py::password_problems` 对齐，否则用户会拿到 422。
 */
export async function register({ username, password, displayName }) {
  try {
    const res = await api.post(
      '/auth/register',
      {
        username,
        password,
        // 空串会被后端当成"给了个空名字"，不如直接省略
        ...(displayName ? { display_name: displayName } : {}),
      },
      { skipAuthRefresh: true },
    )
    return res.data
  } catch (err) {
    throw wrap(err, '注册失败，请稍后再试')
  }
}

/** 登出：撤销当前访问令牌 + 指定的刷新令牌。要求已登录 */
export async function logout(refreshToken) {
  const res = await api.post('/auth/logout', { refresh_token: refreshToken || null })
  return res.data
}

/** 当前身份。以**库里的记录**为准（令牌里的角色可能已经被改过） */
export async function fetchMe() {
  const res = await api.get('/auth/me')
  return res.data
}

/* ===== 与后端 password_problems 对齐的本地校验 ===== */

/** 与 config.AUTH_MIN_PASSWORD_LEN 的默认值一致（后端默认 8） */
export const MIN_PASSWORD_LEN = 8
export const MIN_USERNAME_LEN = 3

/** 角色 → 中文名。后端 Role 枚举只有这四种 */
export const ROLE_LABELS = {
  admin: '管理员',
  kb_admin: '知识库管理员',
  operator: '坐席',
  user: '普通用户',
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || '未知角色'
}

/**
 * 本地预检，返回第一条不满足的说明；null 表示通过。
 *
 * 为什么要在前端重做一遍：这些规则在**服务端**（auth/security.py），本地不拦就会
 * 让用户填完表单、等一个来回，再收到一句 422。规则本身很短，重复一遍是划算的。
 * 但它是"提前告知"，不是"安全边界"——真正的判定永远在服务端。
 */
export function validateCredentials({ username, password, confirmPassword, mode = 'login' }) {
  const name = String(username || '').trim()
  if (!name) return '请输入用户名'
  if (mode === 'register' && name.length < MIN_USERNAME_LEN) {
    return `用户名至少 ${MIN_USERNAME_LEN} 个字符`
  }
  if (!password) return '请输入密码'
  if (mode === 'register') {
    if (password.length < MIN_PASSWORD_LEN) return `密码至少 ${MIN_PASSWORD_LEN} 个字符`
    if (password.trim() !== password) return '密码首尾不要留空格'
    if (new Set(password).size <= 2) return '密码不要用重复字符组成'
    if (confirmPassword !== undefined && password !== confirmPassword) return '两次输入的密码不一致'
  }
  return null
}
