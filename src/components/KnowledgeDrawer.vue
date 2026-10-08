<script setup>
import { nextTick, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import KnowledgePanel from '@/components/KnowledgePanel.vue'
import { useUiStore } from '@/stores/ui.js'

/**
 * 知识库抽屉。
 *
 * 为什么要从"常驻右栏"改成抽屉：
 * 重构前知识库占着 360px 固定列，等于把 1/3 的屏幕永久分给一个低频操作
 * （上传一次，然后聊一天），而对话正文只能在剩下的空间里挤。
 * 把对话变成主角、把上传收进按需展开的面板，是这个重构的核心。
 */
const ui = useUiStore()

const drawer = ref(null)
const closeBtn = ref(null)
// 打开抽屉前谁有焦点。关闭时要还回去，否则键盘用户关掉抽屉后焦点会掉到 body
let lastFocused = null

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

watch(
  () => ui.kbDrawerOpen,
  (open) => {
    if (open) {
      lastFocused = document.activeElement
      nextTick(() => closeBtn.value?.focus())
    } else if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus()
      lastFocused = null
    }
  },
)

/** Esc 关闭 + Tab 在抽屉内部循环，不让焦点跑到后面的对话里 */
function onKeydown(event) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    ui.closeKbDrawer()
    return
  }
  if (event.key !== 'Tab' || !drawer.value) return

  const nodes = Array.from(drawer.value.querySelectorAll(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null,
  )
  if (!nodes.length) return

  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  const active = document.activeElement

  if (event.shiftKey && (active === first || !drawer.value.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <div v-if="ui.kbDrawerOpen" class="drawer-root" @keydown="onKeydown">
    <div class="backdrop" @click="ui.closeKbDrawer()"></div>

    <aside
      ref="drawer"
      class="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kb-drawer-title"
    >
      <header class="drawer-head">
        <div class="drawer-title-wrap">
          <h2 id="kb-drawer-title" class="drawer-title">知识库</h2>
          <p class="drawer-sub">上传的文档会被解析、切块、向量化后立即参与回答</p>
        </div>
        <button ref="closeBtn" class="icon-btn" aria-label="关闭知识库" @click="ui.closeKbDrawer()">
          <AppIcon name="x" :size="17" />
        </button>
      </header>

      <KnowledgePanel />
    </aside>
  </div>
</template>

<style scoped>
.drawer-root {
  position: fixed;
  inset: 0;
  z-index: 80;
}

.backdrop {
  position: absolute;
  inset: 0;
  background: var(--bg-overlay);
  animation: fade-in var(--duration) var(--ease);
}

.drawer {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  display: flex;
  flex-direction: column;
  width: min(420px, 100%);
  background: var(--bg-surface);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  animation: slide-in var(--duration) var(--ease);
}

.drawer-head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  flex-shrink: 0;
  padding: var(--space-4) var(--space-4) var(--space-3);
  border-bottom: 1px solid var(--border);
}

.drawer-title-wrap {
  min-width: 0;
}

.drawer-title {
  font-size: var(--text-md);
  font-weight: 600;
  line-height: 1.3;
}

.drawer-sub {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--text-muted);
  line-height: var(--leading-normal);
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  margin-left: auto;
  border-radius: var(--radius-md);
  color: var(--text-muted);
  transition:
    background var(--duration-fast) var(--ease),
    color var(--duration-fast) var(--ease);
}

.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
}

@keyframes slide-in {
  from {
    transform: translateX(100%);
  }
}
</style>
