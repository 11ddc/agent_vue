import axios from 'axios'

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
 * 把 axios 的错误翻译成一句能直接给用户看的中文。
 *
 * 后端有几种"错误"不是网络故障，而是业务拒绝，必须把原文透出来：
 *   - /api/upload 用 HTTPException(413/400) → 错误体在 err.response.data.detail
 *   - 另有 200 + {success:false, error} 的情况，那属于正常返回，不走这里
 */
export function describeError(err, fallback = '请求失败，请稍后重试') {
  if (axios.isCancel?.(err) || err?.name === 'AbortError' || err?.code === 'ERR_CANCELED') {
    return '已取消'
  }
  if (err?.code === 'ECONNABORTED') {
    return '请求超时：后端处理时间过长，请稍后重试'
  }
  const data = err?.response?.data
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
  if (err?.response?.status) return `请求失败（HTTP ${err.response.status}）`
  if (err?.message === 'Network Error') {
    return '连不上后端服务，请确认 127.0.0.1:8000 已启动'
  }
  return err?.message ? String(err.message) : fallback
}

export default api
