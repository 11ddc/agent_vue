<script setup>
import { computed, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import AppSidebar from '@/components/AppSidebar.vue'
import KnowledgeDrawer from '@/components/KnowledgeDrawer.vue'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import { initTheme } from '@/stores/theme.js'

/**
 * 应用外壳：左侧导航 + 中间内容区 + 知识库抽屉。
 *
 * 为什么外壳放在 App.vue 而不是 HomeView：侧边栏和抽屉是跨路由的框架，
 * 以后加页面（设置、历史记录）时不该跟着 HomeView 一起被换掉。
 *
 * 三种形态由登录态与路由决定：
 *   status === 'unknown'      → 恢复登录态中（只有这种情况才会出现一小会儿）
 *   meta.layout === 'auth'    → 登录页，**不套外壳**
 *   其余                      → 正常外壳
 */
const ui = useUiStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const isAuthLayout = computed(() => route.meta.layout === 'auth')

/**
 * 是否套外壳（侧边栏 + 知识库抽屉）。
 *
 * 条件是"已登录 **且** 不是登录页"，两个都要：
 *   - 只看路由的话，一个未登录用户（例如守卫没跑到、或以后加了没标 meta 的路由）
 *     会看到一个能点、但每个动作都 401 的侧边栏；
 *   - 只看登录态的话，已登录用户访问 /login 时会连侧边栏一起看到登录表单。
 */
const showShell = computed(() => auth.isAuthenticated && !isAuthLayout.value)

/*
 * 会话在**当前页面上**失效时补一次跳转。
 *
 * 为什么路由守卫不够：守卫只在"发生导航"时执行。如果用户已经停在首页、
 * 刷新令牌在后台过期，这时不会发生任何导航，界面会停在一个每个动作都 401 的空壳里。
 * auth store 会在 tokenStore 发出 expired 事件时把 isAuthenticated 置为 false，
 * 这里盯着它的变化把用户送到登录页。
 */
watch(
  () => auth.isAuthenticated,
  (ok, was) => {
    if (ok || !was) return // 只在"已登录 → 未登录"这一跳上动作
    if (isAuthLayout.value) return // 已经在登录页了，不必再跳
    // 首页是登录后的默认落点，不必把 redirect=/ 塞进 query（与路由守卫口径一致）
    const from = route.fullPath
    router.replace(from === '/' ? { name: 'login' } : { name: 'login', query: { redirect: from } })
  },
)

/*
 * 主题必须在**首次渲染之前**落到 <html> 上，否则会先按浅色画一帧、
 * 再被系统深色刷一下（闪白/闪黑）。setup 在 mount 期间执行，早于首次绘制，够用。
 *
 * 放在这里而不是 main.ts：外壳的三种形态都由这个组件决定，主题是同一层的关注点，
 * 集中在一处最好读。（tsconfig 现在已开 allowJs，main.ts 也能 import JS store 了 ——
 * 见 tsconfig.app.json 的说明 —— 所以这里纯粹是"放哪更合适"的选择，不是限制。）
 */
initTheme()
</script>

<template>
  <!-- 首屏恢复登录态：此时路由还没解析出来（守卫在 await 刷新令牌），
       不套外壳，免得先闪一下侧边栏再跳到登录页 -->
  <div v-if="auth.status === 'unknown'" class="app-boot" role="status" aria-live="polite">
    正在恢复登录状态…
  </div>

  <!-- 已登录的业务页：套外壳 -->
  <div v-else-if="showShell" class="app-shell">
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

  <!-- 其余情况（主要是登录/注册页）：全屏，没有侧边栏 -->
  <RouterView v-else />
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

.app-boot {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: var(--bg-app);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

/* 宽屏下不存在浮层侧栏，遮罩只是双保险 */
@media (min-width: 901px) {
  .nav-backdrop {
    display: none;
  }
}
</style>
