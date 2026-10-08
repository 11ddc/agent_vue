import { ref } from 'vue'
import { defineStore } from 'pinia'
import { readBool, write } from '@/utils/storage.js'

const COLLAPSE_KEY = 'ui_sidebar_collapsed'

/**
 * 纯布局状态。
 *
 * 为什么单独一个 store：知识库抽屉要能被两个地方打开
 * （侧边栏的"知识库"入口、对话头部的小屏按钮），
 * 折叠状态也要在路由切换后保持。放在 App.vue 的局部 ref 里就得靠 props/emit 层层传。
 */
export const useUiStore = defineStore('ui', () => {
  /** 桌面端：侧边栏收成图标导航条 */
  const sidebarCollapsed = ref(readBool(COLLAPSE_KEY, false))
  /** 窄屏：侧边栏作为浮层展开 */
  const mobileNavOpen = ref(false)
  const kbDrawerOpen = ref(false)

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
    write(COLLAPSE_KEY, sidebarCollapsed.value)
  }

  function openMobileNav() {
    mobileNavOpen.value = true
  }

  function closeMobileNav() {
    mobileNavOpen.value = false
  }

  function openKbDrawer() {
    kbDrawerOpen.value = true
    // 抽屉和浮层侧栏同时出现会在窄屏上叠两层，先收起侧栏
    mobileNavOpen.value = false
  }

  function closeKbDrawer() {
    kbDrawerOpen.value = false
  }

  function toggleKbDrawer() {
    if (kbDrawerOpen.value) closeKbDrawer()
    else openKbDrawer()
  }

  return {
    sidebarCollapsed,
    mobileNavOpen,
    kbDrawerOpen,
    toggleSidebar,
    openMobileNav,
    closeMobileNav,
    openKbDrawer,
    closeKbDrawer,
    toggleKbDrawer,
  }
})
