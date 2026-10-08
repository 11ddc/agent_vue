import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { readString, write } from '@/utils/storage.js'

const STORAGE_KEY = 'ui_theme'

/** 三档而不是两档：显式选过浅色/深色之后，仍然能回到"跟随系统" */
export const THEMES = ['system', 'light', 'dark']

const LABELS = { system: '跟随系统', light: '浅色', dark: '深色' }
const ICONS = { system: 'monitor', light: 'sun', dark: 'moon' }

export function themeLabel(preference) {
  return LABELS[preference] || LABELS.system
}

export function themeIcon(preference) {
  return ICONS[preference] || ICONS.system
}

export function nextTheme(preference) {
  const index = THEMES.indexOf(preference)
  return THEMES[(index + 1) % THEMES.length]
}

function readStoredTheme() {
  const stored = readString(STORAGE_KEY, 'system')
  return THEMES.includes(stored) ? stored : 'system'
}

/**
 * 把偏好写到 <html data-theme>。
 * system 对应**摘掉**属性，让 CSS 里的 prefers-color-scheme 自己决定——
 * 这样用户改系统主题时页面能实时跟着变，不需要 JS 监听 matchMedia。
 */
export function applyTheme(preference) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (preference === 'light' || preference === 'dark') root.setAttribute('data-theme', preference)
  else root.removeAttribute('data-theme')
}

/**
 * 在 createApp 之前调用一次，避免首帧渲染成浅色再被系统深色刷一下（闪白/闪黑）。
 * 放在 store 外面是因为 store 要等 app.use(createPinia()) 之后才能用。
 */
export function initTheme() {
  const preference = readStoredTheme()
  applyTheme(preference)
  return preference
}

export const useThemeStore = defineStore('theme', () => {
  const preference = ref(initTheme())
  const label = computed(() => themeLabel(preference.value))
  const icon = computed(() => themeIcon(preference.value))

  function set(next) {
    const value = THEMES.includes(next) ? next : 'system'
    preference.value = value
    applyTheme(value)
    write(STORAGE_KEY, value)
    return value
  }

  function cycle() {
    return set(nextTheme(preference.value))
  }

  return { preference, label, icon, set, cycle }
})
