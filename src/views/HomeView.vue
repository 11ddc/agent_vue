<script setup>
import ChatPanel from '@/components/ChatPanel.vue'
import ConversationHeader from '@/components/ConversationHeader.vue'
</script>

<template>
  <!--
    对话列。
    重构前这里是「一屏两栏：左聊天 + 右 360px 知识库」，整页 max-width 1440px，
    聊天正文一行能拉到 800px 以上 —— 中文超过约 40 字就难扫读。
    现在对话是唯一主角，列宽锁在 --column-max，知识库收进抽屉（见 KnowledgeDrawer）。
  -->
  <div class="column">
    <ConversationHeader />
    <ChatPanel />
  </div>
</template>

<style scoped>
.column {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: var(--column-max);
  height: 100%;
  min-height: 0;
  margin: 0 auto;
  border-inline: 1px solid var(--border);
  background: var(--bg-app);
}
</style>
