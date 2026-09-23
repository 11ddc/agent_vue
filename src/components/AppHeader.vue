<script setup>
import { RouterLink } from 'vue-router'
import { useChatStore } from '@/stores/chat.js'
import { useKnowledgeStore } from '@/stores/knowledge.js'

const chat = useChatStore()
const kb = useKnowledgeStore()
</script>

<template>
  <header class="app-header">
    <div class="header-inner">
      <RouterLink to="/" class="logo">
        <span class="logo-icon">🎧</span>
        <div class="logo-text">
          <strong>智能客服工作台</strong>
          <small>RAG 检索 + Agent 编排</small>
        </div>
      </RouterLink>

      <nav class="nav-links">
        <RouterLink to="/" class="nav-link">对话</RouterLink>
        <a class="nav-link" href="http://127.0.0.1:8000/docs" target="_blank" rel="noreferrer">
          接口文档
        </a>
      </nav>

      <div class="header-actions">
        <span class="status-pill" :class="{ busy: chat.isSending || kb.isBusy }">
          <span class="dot"></span>
          {{ chat.isSending ? '回答中' : kb.isBusy ? '入库中' : '空闲' }}
        </span>
        <span class="kb-badge" :title="`本次已成功入库 ${kb.doneCount} 个文件`">
          知识库 +{{ kb.doneCount }}
        </span>
        <button v-if="chat.hasSession" class="btn-ghost" @click="chat.reset()">重置会话</button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 100;
  height: 64px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.header-inner {
  max-width: 1440px;
  height: 100%;
  margin: 0 auto;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 28px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
}

.logo-icon {
  font-size: 26px;
}

.logo-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.logo-text strong {
  font-size: 17px;
  font-weight: 700;
  color: #e74c3c;
}

.logo-text small {
  font-size: 11px;
  color: #a8b0bb;
}

.nav-links {
  display: flex;
  gap: 22px;
}

.nav-link {
  font-size: 14px;
  font-weight: 500;
  color: #333;
  transition: color 0.2s;
  white-space: nowrap;
}

.nav-link:hover,
.nav-link.router-link-exact-active {
  color: #e74c3c;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}

.status-pill,
.kb-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 14px;
  font-size: 12px;
  background: #f4f6f8;
  color: #6b7280;
  white-space: nowrap;
}

.status-pill .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #34c759;
}

.status-pill.busy .dot {
  background: #ff9f0a;
  animation: blink 1s ease-in-out infinite;
}

@keyframes blink {
  50% {
    opacity: 0.3;
  }
}

.btn-ghost {
  padding: 6px 14px;
  border: 1px solid #e0e0e0;
  border-radius: 14px;
  background: #fff;
  font-size: 12px;
  color: #555;
  transition: all 0.2s;
}

.btn-ghost:hover {
  border-color: #e74c3c;
  color: #e74c3c;
  background: #fff5f5;
}

@media (max-width: 860px) {
  .nav-links,
  .kb-badge {
    display: none;
  }
}
</style>
