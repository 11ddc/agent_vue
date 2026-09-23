import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

// 整个应用就是一个客服工作台：对话 + 知识库上传在同一屏，没有第二个页面。
// 客服按钮/商品页等旧路由已随商城 demo 一并移除（见 components/ 下的清理记录）。
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
