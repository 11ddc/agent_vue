import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

// 整个应用目前只有一屏：对话为主，知识库是需要时展开的抽屉，没有第二个页面。
// 外壳（侧边栏 + 知识库抽屉）放在 App.vue，以后加设置/历史记录页不用动 HomeView。
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
  ],
})

export default router
