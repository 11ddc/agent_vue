<script setup>
import { computed } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useConversation } from '@/composables/useConversation.js'
import { useAuthStore } from '@/stores/auth.js'
import { useKnowledgeStore } from '@/stores/knowledge.js'
import { useThemeStore } from '@/stores/theme.js'
import { useUiStore } from '@/stores/ui.js'

/**
 * 左侧导航栏。
 *
 * 布局状态不通过 props/emit 传，直接读写 ui store：
 * 折叠状态和知识库抽屉都要跨组件共享（对话头部的小屏按钮也能打开抽屉），
 * 走 props 就得在 App.vue 里做一层纯粹的转发。
 */
const { chat, roles, newSession, switchRole } = useConversation()
const auth = useAuthStore()
const kb = useKnowledgeStore()
const theme = useThemeStore()
const ui = useUiStore()

const statusText = computed(() => {
  if (chat.isSending) return chat.statusText || '回答中…'
  if (kb.isBusy) return '正在写入知识库…'
  return '就绪'
})

const sessionLabel = computed(() => (chat.sessionId ? `${chat.sessionId.slice(0, 8)}…` : ''))

function onSelectRole(id) {
  // 切换角色 = 换一段后端上下文（reset），已经在当前角色时 switchRole 返回 false 不做任何事
  switchRole(id)
  ui.closeMobileNav()
}

function onNewSession() {
  newSession()
  ui.closeMobileNav()
}

/**
 * 登出。
 *
 * 这里**不**自己跳转：App.vue 盯着 auth.isAuthenticated，一旦由 true 变 false
 * 就统一接管跳转（带上 redirect，登录后能回到原来那页）。会话在后台失效时走的是
 * 同一条路径，所以跳转逻辑只有一份，不会出现"手动登出跳首页、被动失效跳别处"的分裂。
 */
async function onLogout() {
  await auth.logout()
  ui.closeMobileNav()
}
</script>

<template>
  <aside
    class="sidebar"
    :class="{ 'is-collapsed': ui.sidebarCollapsed, 'is-open': ui.mobileNavOpen }"
  >
    <div class="side-top">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <AppIcon name="sparkles" :size="16" :stroke-width="2" />
        </span>
        <span class="brand-text">
          <strong>AI 对话</strong>
          <small>知识库增强</small>
        </span>
      </div>

      <button
        class="icon-btn rail-toggle"
        :aria-label="ui.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
        :aria-expanded="!ui.sidebarCollapsed"
        @click="ui.toggleSidebar()"
      >
        <AppIcon name="panelLeft" :size="17" />
      </button>
    </div>

    <button class="new-session" @click="onNewSession">
      <AppIcon name="plus" :size="17" :stroke-width="2" />
      <span class="label">新对话</span>
    </button>

    <nav class="roles" aria-label="选择助手角色">
      <p class="section-label">助手角色</p>
      <ul class="role-list">
        <li v-for="role in roles.list" :key="role.id">
          <button
            class="role"
            :class="{ 'is-active': role.id === roles.currentId }"
            :aria-current="role.id === roles.currentId ? 'true' : undefined"
            :title="`${role.name} · ${role.tagline}`"
            @click="onSelectRole(role.id)"
          >
            <span class="role-icon" aria-hidden="true">
              <AppIcon :name="role.icon" :size="17" />
            </span>
            <span class="role-text">
              <span class="role-name">{{ role.name }}</span>
              <span class="role-tagline">{{ role.tagline }}</span>
            </span>
          </button>
        </li>
      </ul>
    </nav>

    <!--
      底部这一栏是"元信息区"：知识库入口 + 主题 + 开发者用的接口文档。
      原来的 AppHeader 把「空闲/回答中」「知识库 +N」「重置会话」全塞在顶部主视觉里，
      那是运维看板语言，不该占用对话产品最贵的那条横栏。
    -->
    <div class="side-bottom">
      <button class="side-item" @click="ui.openKbDrawer()">
        <AppIcon name="book" :size="17" />
        <span class="label">知识库</span>
        <span v-if="kb.doneCount" class="count tnum">+{{ kb.doneCount }}</span>
      </button>

      <button
        class="side-item"
        :aria-label="`主题：${theme.label}，点击切换`"
        :title="`当前：${theme.label}（点击切换）`"
        @click="theme.cycle()"
      >
        <AppIcon :name="theme.icon" :size="17" />
        <span class="label">主题：{{ theme.label }}</span>
      </button>

      <!-- 相对路径：开发环境由 Vite 代理、生产由 nginx 反代（见 deploy/nginx.conf）。
           写死 127.0.0.1:8000 的话，部署到服务器后这个链接会指向**访客自己的电脑**。 -->
      <a class="side-item" href="/docs" target="_blank" rel="noreferrer">
        <AppIcon name="externalLink" :size="17" />
        <span class="label">接口文档</span>
      </a>

      <p v-if="sessionLabel" class="side-session tnum" :title="chat.sessionId">
        会话 {{ sessionLabel }}
      </p>

      <!-- 当前身份与登出入口。理论上未登录走不到这个外壳（路由守卫生效），
           v-if 只是让"万一"也不至于渲染出一个空名片的头像 -->
      <div v-if="auth.isAuthenticated" class="side-user">
        <span class="avatar" aria-hidden="true">{{ auth.initial }}</span>
        <span class="user-text">
          <span class="user-name" :title="auth.displayName">{{ auth.displayName }}</span>
          <span class="user-role">{{ auth.roleText }}</span>
        </span>
      </div>

      <button
        v-if="auth.isAuthenticated"
        class="side-item"
        type="button"
        :disabled="auth.busy"
        @click="onLogout"
      >
        <AppIcon name="logOut" :size="17" />
        <span class="label">{{ auth.busy ? '正在退出…' : '退出登录' }}</span>
      </button>

      <p class="side-status" role="status" aria-live="polite">
        <span class="dot" :class="{ busy: chat.isSending || kb.isBusy }" aria-hidden="true"></span>
        {{ statusText }}
      </p>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: var(--sidebar-width);
  height: 100%;
  padding: var(--space-3);
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  transition: width var(--duration) var(--ease);
}

/* ===== 顶部：品牌 + 折叠 ===== */
.side-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-1) var(--space-3);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.brand-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
  background: var(--accent-soft);
  color: var(--accent-text);
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}

.brand-text strong {
  font-size: var(--text-md);
  font-weight: 650;
  letter-spacing: -0.01em;
}

.brand-text small {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
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

/* ===== 新对话 ===== */
.new-session {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: 9px var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: var(--text-base);
  font-weight: 500;
  transition:
    border-color var(--duration-fast) var(--ease),
    background var(--duration-fast) var(--ease);
}

.new-session:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}

/* ===== 角色列表 ===== */
.roles {
  flex: 1;
  min-height: 0;
  margin-top: var(--space-5);
  overflow-y: auto;
}

.section-label {
  padding: 0 var(--space-2) var(--space-2);
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--text-muted);
}

.role-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.role {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-2) var(--space-2);
  border-radius: var(--radius-md);
  text-align: left;
  transition:
    background var(--duration-fast) var(--ease),
    color var(--duration-fast) var(--ease);
}

.role:hover {
  background: var(--bg-hover);
}

.role.is-active {
  background: var(--accent-soft);
}

.role-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
  color: var(--text-secondary);
}

.role.is-active .role-icon {
  background: var(--accent);
  color: var(--on-accent);
}

.role-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}

.role-name {
  font-size: var(--text-base);
  font-weight: 500;
}

.role.is-active .role-name {
  color: var(--accent-text);
  font-weight: 600;
}

.role-tagline {
  font-size: var(--text-xs);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ===== 底部元信息区 ===== */
.side-bottom {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: var(--space-3);
  border-top: 1px solid var(--border);
}

.side-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-2);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  transition:
    background var(--duration-fast) var(--ease),
    color var(--duration-fast) var(--ease);
}

.side-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.count {
  margin-left: auto;
  padding: 1px 7px;
  border-radius: var(--radius-full);
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.side-session {
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* ===== 当前身份 ===== */
.side-user {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2);
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-full);
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: var(--text-xs);
  font-weight: 650;
}

.user-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}

.user-name {
  font-size: var(--text-sm);
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-role {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.side-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-muted);
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

/* ===== 收起成图标导航条 ===== */
.sidebar.is-collapsed {
  width: 64px;
  padding: var(--space-3) var(--space-2);
}

.sidebar.is-collapsed .brand-text,
.sidebar.is-collapsed .label,
.sidebar.is-collapsed .role-text,
.sidebar.is-collapsed .section-label,
.sidebar.is-collapsed .side-session,
.sidebar.is-collapsed .side-status,
.sidebar.is-collapsed .user-text,
.sidebar.is-collapsed .count {
  display: none;
}

.sidebar.is-collapsed .side-top {
  flex-direction: column;
  gap: var(--space-2);
  padding-bottom: var(--space-2);
}

.sidebar.is-collapsed .new-session,
.sidebar.is-collapsed .role,
.sidebar.is-collapsed .side-user,
.sidebar.is-collapsed .side-item {
  justify-content: center;
  padding: var(--space-2);
}

/* ===== 窄屏：侧栏变浮层 ===== */
@media (max-width: 900px) {
  .sidebar {
    position: fixed;
    inset-block: 0;
    inset-inline-start: 0;
    z-index: 60;
    width: var(--sidebar-width);
    transform: translateX(-100%);
    transition: transform var(--duration) var(--ease);
  }

  /*
   * 阴影只能挂在"展开"状态上。
   * transform 不会裁剪 box-shadow：合起来的侧栏停在 x = -268，
   * 但它的 40px 投影仍然会洒在页面最左边 —— 用户在窄屏上会看到一条
   * 没有来源的暗边（截图里采样到左边缘是 234 而不是背景的 248 就是这个）。
   */
  .sidebar.is-open {
    transform: translateX(0);
    box-shadow: var(--shadow-lg);
  }

  /* 浮层模式下没有"图标导航条"这个形态，折叠按钮没意义 */
  .rail-toggle {
    display: none;
  }
}
</style>
