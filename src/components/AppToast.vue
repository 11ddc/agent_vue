<script setup>
import AppIcon from '@/components/AppIcon.vue'
import { useToastStore } from '@/stores/toast.js'

/**
 * 全局提示浮层。
 *
 * 挂在 App.vue 的最外层（登录页也会渲染），位置固定在视口底部居中，
 * z-index 高于知识库抽屉，保证"点了没反应"这类反馈不会被任何浮层盖住。
 *
 * 为什么把 role="status" 放在**常驻的空容器**上：读屏只在 aria-live 区域
 * 本来就存在于 DOM 里时才会播报后插入的内容；等有了提示再挂载整个容器，
 * 播报会丢。
 */
const toast = useToastStore()
</script>

<template>
  <div class="toast-layer" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <p v-for="item in toast.items" :key="item.id" class="toast">
        <AppIcon name="info" :size="15" />
        <span>{{ item.message }}</span>
      </p>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-layer {
  position: fixed;
  inset-inline: 0;
  bottom: var(--space-6);
  z-index: 90;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding-inline: var(--space-4);
  /* 容器铺满整行只为居中，不该挡住底下的点击 */
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  max-width: min(420px, 100%);
  padding: 9px var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--bg-surface);
  box-shadow: var(--shadow-lg);
  color: var(--text-primary);
  font-size: var(--text-sm);
  line-height: 1.4;
}

.toast-enter-active,
.toast-leave-active,
.toast-move {
  transition:
    opacity var(--duration) var(--ease),
    transform var(--duration) var(--ease);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
