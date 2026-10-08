<script setup>
import { RouterView } from 'vue-router'
import AppSidebar from '@/components/AppSidebar.vue'
import KnowledgeDrawer from '@/components/KnowledgeDrawer.vue'
import { useUiStore } from '@/stores/ui.js'
import { initTheme } from '@/stores/theme.js'

/**
 * 应用外壳：左侧导航 + 中间内容区 + 知识库抽屉。
 *
 * 为什么外壳放在 App.vue 而不是 HomeView：侧边栏和抽屉是跨路由的框架，
 * 以后加页面（设置、历史记录）时不该跟着 HomeView 一起被换掉。
 */
const ui = useUiStore()

/*
 * 主题必须在**首次渲染之前**落到 <html> 上，否则会先按浅色画一帧、
 * 再被系统深色刷一下（闪白/闪黑）。setup 在 mount 期间执行，早于首次绘制，够用。
 *
 * 为什么不放在 main.ts：main.ts 是 TS，而 store 是 JS，
 * 当前 tsconfig 下 TS 直接 import JS 会报 TS7016（缺声明文件）；
 * 打开 allowJs 又会把 src/**\/*.spec.js 一起拉进 app 程序，代价比这一行大。
 */
initTheme()
</script>

<template>
  <div class="app-shell">
    <AppSidebar />

    <main class="app-stage">
      <RouterView />
    </main>

    <!--
      窄屏侧栏浮层的遮罩。position: fixed 让它脱离 .app-shell 的 flex 布局，
      不会挤占 flex 项的位置。
    -->
    <div v-if="ui.mobileNavOpen" class="nav-backdrop" @click="ui.closeMobileNav()"></div>

    <KnowledgeDrawer />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100%;
  overflow: hidden;
  background: var(--bg-app);
}

.app-stage {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.nav-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: var(--bg-overlay);
}

/* 宽屏下不存在浮层侧栏，遮罩只是双保险 */
@media (min-width: 901px) {
  .nav-backdrop {
    display: none;
  }
}
</style>
