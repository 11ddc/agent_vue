import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import LoginView from '../views/LoginView.vue'
import { useAuthStore } from '../stores/auth.js'

/**
 * 只有一个业务页面 + 一个登录页。
 *
 * 外壳（侧边栏 + 知识库抽屉）放在 App.vue：`meta.layout === 'auth'` 的页面
 * 不套外壳（未登录时露出"新对话/知识库/会话 xxx"没有意义，点哪个都会 401）。
 *
 * ⚠️ 后端所有业务接口都要求身份（`require_user` / `require_roles`），
 *    所以这里的守卫不是"锦上添花的体验优化"，而是**唯一的入口**：
 *    没有它，用户会在一个能打开、但每个动作都 401 的空壳里打转。
 */
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { layout: 'auth' },
    },
  ],
})

const PUBLIC_ROUTES = new Set(['login'])

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  // 首次进入时必须先等"恢复登录态"跑完：访问令牌只存在内存里，
  // 刷新页面后要靠刷新令牌重新换一对。不等它就会把一个已登录的用户
  // 误判成未登录、直接弹回登录页 —— 这是最容易踩的一处竞态。
  await auth.ensureReady()

  if (PUBLIC_ROUTES.has(String(to.name))) {
    // 已经登录的人再访问 /login 就直接回首页，避免"登录了却停在登录页"
    return auth.isAuthenticated ? { name: 'home' } : true
  }

  if (!auth.isAuthenticated) {
    return {
      name: 'login',
      // 记住原本要去哪；首页是默认值，不必写进 query 徒增噪音
      ...(to.fullPath === '/' ? {} : { query: { redirect: to.fullPath } }),
    }
  }

  return true
})

export default router
