<script setup>
import ChatPanel from '@/components/ChatPanel.vue'
import KnowledgePanel from '@/components/KnowledgePanel.vue'
</script>

<template>
  <!--
    一屏两栏：左边聊天，右边知识库上传。
    两栏都是 flex 列 + min-height:0，让内部的消息区/列表区自己滚，
    整页不出现滚动条 —— 聊天界面里页面级滚动会把输入框顶出视口。
  -->
  <main class="workbench">
    <ChatPanel class="col-chat" />
    <KnowledgePanel class="col-kb" />
  </main>
</template>

<style scoped>
.workbench {
  height: calc(100vh - 64px); /* 64px = AppHeader 的高度 */
  max-width: 1440px;
  margin: 0 auto;
  padding: 18px 20px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 18px;
}

.col-chat,
.col-kb {
  min-height: 0;
  min-width: 0;
}

@media (max-width: 1080px) {
  .workbench {
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 14px;
    padding: 14px;
  }
}

/* 窄屏改为上下堆叠，各自给固定高度，仍然不产生整页滚动 */
@media (max-width: 860px) {
  .workbench {
    height: auto;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(480px, 62vh) minmax(380px, auto);
  }
}
</style>
