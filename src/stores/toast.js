import { ref } from 'vue'
import { defineStore } from 'pinia'

/**
 * 轻量提示浮层（toast）的状态。
 *
 * 为什么单独一个 store 而不是在组件里 `ref`：
 * 提示的触发点分散在各个业务组件里（目前是侧边栏的"功能未开放"），
 * 而渲染点只有一个（App.vue 里的 AppToast）。走 store 就不用把
 * "谁来持有提示文案"这件事在组件树里传一遍。
 *
 * 为什么自带定时器：自动消失是提示的固有行为，放在 store 里
 * 组件就只管渲染，也不用担心组件卸载后定时器还挂着引用。
 */

/** 默认停留时长：够看清一句话，又不至于一直压着界面 */
export const TOAST_DURATION = 3000

export const useToastStore = defineStore('toast', () => {
  /** @type {import('vue').Ref<Array<{ id: number, message: string }>>} */
  const items = ref([])
  let seq = 0
  /** id → 定时器句柄，用来在手动关闭或复用同一条时取消旧倒计时 */
  const timers = new Map()

  function clearTimer(id) {
    const timer = timers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.delete(id)
    }
  }

  function dismiss(id) {
    clearTimer(id)
    items.value = items.value.filter((item) => item.id !== id)
  }

  /**
   * 排一次倒计时。duration <= 0 表示不自动消失（只能手动 dismiss）。
   * 先取消旧定时器：同一 id 重新计时时不能留下两个定时器。
   */
  function schedule(id, duration) {
    clearTimer(id)
    if (duration <= 0) return
    const timer = setTimeout(() => dismiss(id), duration)
    timers.set(id, timer)
  }

  /**
   * 弹一条提示。
   *
   * @param {string} message 文案，空白字符串直接忽略（不给空浮层）
   * @param {{ duration?: number }} [options] duration: 0 表示不自动消失
   * @returns {number|null} 提示 id；没弹出来返回 null
   */
  function notify(message, { duration = TOAST_DURATION } = {}) {
    const text = String(message ?? '').trim()
    if (!text) return null

    // 连点同一个入口不该叠出一摞一模一样的浮层：复用最后一条，只把倒计时重新开始
    const last = items.value[items.value.length - 1]
    if (last && last.message === text) {
      schedule(last.id, duration)
      return last.id
    }

    seq += 1
    const id = seq
    items.value = [...items.value, { id, message: text }]
    schedule(id, duration)
    return id
  }

  /** 清空（登出、卸载、测试收尾用；顺带取消所有待触发的定时器） */
  function clear() {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    items.value = []
  }

  return { items, notify, dismiss, clear }
})
