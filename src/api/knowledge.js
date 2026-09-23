import axios from 'axios'
import api, { describeError } from './client.js'

/**
 * 知识库上传接口：POST /api/upload（multipart，字段名必须是 file）
 *
 * 后端（my-agent-api/api/upload_file.py）返回三种"失败"，形态各不相同，
 * 必须分开处理，否则用户只会看到一句没信息量的"上传失败"：
 *
 *   1. 类型不支持  → HTTP 200 + {success: false, error: "不支持的文件类型 ..."}
 *   2. 文件过大    → HTTP 413 + {detail: "文件过大（... 字节，上限 ...）"}
 *   3. 文件名非法  → HTTP 400 + {detail: "非法文件名: ..."}
 *   （索引失败会抛异常 → 500，由 describeError 兜底成状态码提示）
 */

// 与后端 ALLOWED_SUFFIXES 保持一致
export const ALLOWED_EXTENSIONS = ['.pdf', '.txt', '.md', '.docx', '.xlsx', '.xlsm']

export const ACCEPT_ATTR = ALLOWED_EXTENSIONS.join(',')

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MB，与后端一致，前端先拦一道

export class KnowledgeUploadError extends Error {
  constructor(message, { kind = 'unknown', status = null } = {}) {
    super(message)
    this.name = 'KnowledgeUploadError'
    this.kind = kind
    this.status = status
  }
}

/** 把字节数说成人话 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  // parseFloat 去掉多余的尾零：50.00 → 50，1.50 → 1.5
  if (bytes < 1024 * 1024) return `${parseFloat((bytes / 1024).toFixed(1))} KB`
  return `${parseFloat((bytes / 1024 / 1024).toFixed(2))} MB`
}

function extensionOf(name) {
  const idx = String(name || '').lastIndexOf('.')
  return idx === -1 ? '' : String(name).slice(idx).toLowerCase()
}

/** 选文件时的本地预检，省掉一次必然失败的往返 */
export function precheckFile(file) {
  if (!file) return '没有选择文件'
  const ext = extensionOf(file.name)
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `不支持的文件类型「${ext || '无后缀'}」，仅支持：${ALLOWED_EXTENSIONS.join('、')}`
  }
  if (file.size === 0) return '这是一个空文件'
  if (file.size > MAX_UPLOAD_BYTES) {
    return `文件过大（${formatBytes(file.size)}），上限 ${formatBytes(MAX_UPLOAD_BYTES)}`
  }
  return null
}

/**
 * 上传文档到知识库，后端会自动触发 RAG 增量索引。
 *
 * timeout 给到 15 分钟：这个接口不只是收文件，它在服务端做
 * 「解析 → 切块 → embedding → 入库」，是同步等待的重活
 * （后端自己也是 asyncio.to_thread 丢线程池跑的），
 * 默认超时会误杀一个正在正常索引的请求。
 */
export async function uploadDocument(file, { onProgress, signal } = {}) {
  const form = new FormData()
  form.append('file', file) // 字段名必须是 file，与后端 File(...) 参数名对应

  let res
  try {
    res = await api.post('/upload', form, {
      timeout: 15 * 60 * 1000,
      signal,
      onUploadProgress: (evt) => {
        if (!onProgress) return
        // total 在部分环境下拿不到（chunked），此时只报已发送量
        const total = evt.total || file.size || 0
        const percent = total ? Math.min(100, Math.round((evt.loaded / total) * 100)) : null
        onProgress({ loaded: evt.loaded, total, percent })
      },
    })
  } catch (err) {
    if (axios.isCancel?.(err) || err?.code === 'ERR_CANCELED') {
      throw new KnowledgeUploadError('已取消上传', { kind: 'canceled' })
    }
    const status = err?.response?.status ?? null
    const kind = status === 413 ? 'too-large' : status === 400 ? 'bad-name' : 'transport'
    throw new KnowledgeUploadError(describeError(err, '上传失败'), { kind, status })
  }

  const data = res.data || {}
  // 注意：类型不支持时后端返回的是 HTTP 200，只能靠 success 字段判断
  if (data.success === false) {
    throw new KnowledgeUploadError(data.error || '后端拒绝了这次上传', {
      kind: 'rejected',
      status: res.status,
    })
  }

  return {
    filename: data.filename || file.name,
    // 后端注释里 file_size 被注掉了，这里的 size 用本地的，只作展示
    size: file.size,
    documentCount: Number(data.document_count) || 0,
  }
}
