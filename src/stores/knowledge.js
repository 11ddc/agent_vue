import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { uploadDocument, precheckFile, KnowledgeUploadError } from '@/api/knowledge.js'

let seq = 0
function nextId() {
  seq += 1
  return `kb-${Date.now()}-${seq}`
}

/**
 * 知识库上传状态。
 *
 * 这里刻意把上传拆成两个阶段展示，因为它们的耗时量级完全不同：
 *   1. uploading —— 浏览器把字节发给后端（按网速，通常几秒）
 *   2. indexing  —— 后端在服务端做「解析 → 切块 → embedding → 入库」
 *                    （见 upload_file.py 最后的 asyncio.to_thread(init_rag, ...)）
 *
 * axios 的 onUploadProgress 到 100% 只代表第 1 步完了，第 2 步一点进度都拿不到。
 * 如果不区分，界面会在 100% 那里干挂着，看起来像卡死；分开标注才如实。
 */
export const useKnowledgeStore = defineStore('knowledge', () => {
  const items = ref([])
  const pendingCount = ref(0)

  const isBusy = computed(() => pendingCount.value > 0)
  const doneCount = computed(() => items.value.filter((i) => i.status === 'done').length)

  let controller = null

  async function upload(file) {
    const localError = precheckFile(file)
    if (localError) {
      items.value.unshift({
        id: nextId(),
        name: file?.name || '未知文件',
        size: file?.size || 0,
        status: 'error',
        percent: 0,
        message: localError,
        time: new Date().toISOString(),
      })
      return false
    }

    const item = {
      id: nextId(),
      name: file.name,
      size: file.size,
      status: 'uploading',
      percent: 0,
      message: '',
      documentCount: 0,
      time: new Date().toISOString(),
    }
    items.value.unshift(item)
    // 取回响应式代理，后续突变才会触发视图更新
    const row = items.value[0]
    pendingCount.value += 1
    controller = new AbortController()
    const startedAt = Date.now()

    try {
      const result = await uploadDocument(file, {
        signal: controller.signal,
        onProgress: ({ percent }) => {
          if (percent === null) return
          row.percent = percent
          // 字节发完了，接下来是服务端索引——这中间可能等很久，必须换个说法
          if (percent >= 100 && row.status === 'uploading') {
            row.status = 'indexing'
            row.message = '服务端正在解析、切块并写入向量库…'
          }
        },
      })
      row.status = 'done'
      row.percent = 100
      row.documentCount = result.documentCount
      row.name = result.filename || row.name
      row.elapsedMs = Date.now() - startedAt
      row.message =
        result.documentCount > 0
          ? `入库完成，新增 ${result.documentCount} 个文档块`
          : '入库完成'
      return true
    } catch (err) {
      if (err instanceof KnowledgeUploadError && err.kind === 'canceled') {
        row.status = 'canceled'
        row.message = '已取消'
        return false
      }
      row.status = 'error'
      row.message = err?.message || '上传失败'
      return false
    } finally {
      pendingCount.value = Math.max(0, pendingCount.value - 1)
      controller = null
    }
  }

  function cancel() {
    if (controller) {
      controller.abort()
      controller = null
    }
  }

  function remove(id) {
    items.value = items.value.filter((i) => i.id !== id)
  }

  function clearFinished() {
    items.value = items.value.filter((i) => i.status !== 'done')
  }

  function clearAll() {
    cancel()
    items.value = []
  }

  return {
    items,
    isBusy,
    doneCount,
    upload,
    cancel,
    remove,
    clearFinished,
    clearAll,
  }
})
