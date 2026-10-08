/**
 * 浏览器存储的安全包装。
 *
 * 为什么不能直接调：隐私模式、被浏览器策略禁用、配额写满这几种情况下
 * `localStorage.getItem` / `setItem` 会**抛异常**。原代码里
 * `sessionStorage.getItem(SESSION_KEY)` 是裸调的，一旦抛异常整个应用白屏。
 * 首选项和会话 id 丢了只是回到默认值/开个新会话，绝不该让应用挂掉。
 */

function localArea() {
  // 连 `localStorage` 这个引用本身都可能抛（沙箱化 iframe / 策略禁用）
  try {
    return localStorage
  } catch {
    return null
  }
}

function sessionArea() {
  try {
    return sessionStorage
  } catch {
    return null
  }
}

function get(area, key) {
  try {
    return area().getItem(key)
  } catch {
    return null
  }
}

function set(area, key, value) {
  try {
    area().setItem(key, String(value))
  } catch {
    /* 存不下就算了：本次会话内的状态仍然是正确的 */
  }
}

function drop(area, key) {
  try {
    area().removeItem(key)
  } catch {
    /* 同上 */
  }
}

/* ===== localStorage：首选项 ===== */

export function readString(key, fallback = '') {
  const value = get(localArea, key)
  return value === null ? fallback : value
}

export function readBool(key, fallback = false) {
  const value = readString(key, '')
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

export function write(key, value) {
  set(localArea, key, value)
}

export function remove(key) {
  drop(localArea, key)
}

/* ===== sessionStorage：一次会话内有效的东西（比如后端会话 id）===== */

export function readSessionString(key, fallback = '') {
  const value = get(sessionArea, key)
  return value === null ? fallback : value
}

export function writeSession(key, value) {
  set(sessionArea, key, value)
}

export function removeSession(key) {
  drop(sessionArea, key)
}
