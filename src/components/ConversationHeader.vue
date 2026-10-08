<script setup>
import { computed } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useConversation } from '@/composables/useConversation.js'
import { useKnowledgeStore } from '@/stores/knowledge.js'
import { useUiStore } from '@/stores/ui.js'

/**
 * 对话列顶部的一条细栏。
 *
 * 对比重构前的 AppHeader：64px 高、带投影、通栏居中，
 * 上面挂着 logo、导航、状态胶囊、知识库计数、重置按钮——那是一条"应用框架"横栏，
 * 把对话挤下去一大截。现在它退化成一个跟内容同宽的窄条，
 * 只承担两个信息：**现在跟谁说话**、**当前状态**。
 */
const { chat, roles, newSession } = useConversation()
const kb = useKnowledgeStore()
const ui = useUiStore()

const role = computed(() => roles.currentRole)

const statusText = computed(() => {
  if (chat.isSending) return chat.statusText || '正在生成…'
  if (kb.isBusy) return '正在写入知识库…'
  return '在线'
})
</script>

<template>
  <header class="conv-head">
    <button class="icon-btn only-narrow" aria-label="打开侧边栏" @click="ui.openMobileNav()">
      <AppIcon name="menu" :size="18" />
    </button>

    <div class="identity">
      <span class="avatar" aria-hidden="true">
        <AppIcon :name="role.icon" :size="17" />
      </span>
      <div class="identity-text">
        <h1 class="name">{{ role.name }}</h1>
        <!-- aria-live：流式阶段的文案变化要能被读屏播报，但不能打断用户输入 -->
        <p class="status" role="status" aria-live="polite">
          <span
            class="dot"
            :class="{ busy: chat.isSending || kb.isBusy }"
            aria-hidden="true"
          ></span>
          {{ statusText }}
        </p>
      </div>
    </div>

    <div class="head-actions">
      <button class="ghost-btn" @click="newSession()">
        <AppIcon name="refresh" :size="15" />
        <span>新会话</span>
      </button>
      <button class="ghost-btn" @click="ui.openKbDrawer()">
        <AppIcon name="book" :size="15" />
        <span>知识库</span>
        <span v-if="kb.doneCount" class="count tnum">+{{ kb.doneCount }}</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.conv-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
  background: var(--bg-app);
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  transition: background var(--duration-fast) var(--ease);
}

.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.identity {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-full);
  background: var(--accent-soft);
  color: var(--accent-text);
}

.identity-text {
  min-width: 0;
}

.name {
  font-size: var(--text-md);
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.01em;
}

.status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--text-muted);
  line-height: 1.3;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--success);
}

.dot.busy {
  background: var(--warning);
  animation: pulse 1.4s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}

.head-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}

.ghost-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  transition:
    border-color var(--duration-fast) var(--ease),
    color var(--duration-fast) var(--ease);
}

.ghost-btn:hover {
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.count {
  padding: 0 6px;
  border-radius: var(--radius-full);
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: var(--text-xs);
}

/* 窄屏下这一栏只留汉堡键和状态，"新会话/知识库"收进侧栏和抽屉 */
@media (max-width: 640px) {
  .ghost-btn .count {
    display: none;
  }

  .ghost-btn span:not(.count) {
    display: none;
  }

  .ghost-btn {
    padding: 6px 8px;
  }
}

@media (min-width: 901px) {
  .only-narrow {
    display: none;
  }
}
</style>
