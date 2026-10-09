<script setup>
import { ref, computed } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useAuthStore } from '@/stores/auth.js'
import { useKnowledgeStore } from '@/stores/knowledge.js'
import { ACCEPT_ATTR, ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES, formatBytes } from '@/api/knowledge.js'

const auth = useAuthStore()
const kb = useKnowledgeStore()

const fileInput = ref(null)
const dragging = ref(false)
let queueToken = 0

const hint = computed(
  () => `支持 ${ALLOWED_EXTENSIONS.join(' / ')}，单个文件不超过 ${formatBytes(MAX_UPLOAD_BYTES)}`,
)

function pick() {
  if (kb.isBusy) return // 正在处理时不再弹选择框，避免一次排进一堆重活
  fileInput.value?.click()
}

async function onPicked(e) {
  const files = Array.from(e.target.files || [])
  // 清空 value：否则连续选同一个文件不会触发 change
  e.target.value = ''
  await runQueue(files)
}

async function onDrop(e) {
  dragging.value = false
  const files = Array.from(e.dataTransfer?.files || [])
  await runQueue(files)
}

/**
 * 顺序上传。为什么串行而不是 Promise.all 并发：
 * 后端每次上传都会同步跑一遍「解析 → 切块 → embedding → 入库」，
 * 并发提交只会让多份重活挤在一起抢 CPU 和向量库，整体更慢，进度也更难看懂。
 */
async function runQueue(files) {
  if (!files.length) return
  const token = ++queueToken
  for (const file of files) {
    if (token !== queueToken) return // 期间用户点了取消/清空
    await kb.upload(file)
  }
}

function cancelAll() {
  queueToken += 1
  kb.cancel()
}

function statusText(item) {
  switch (item.status) {
    case 'uploading':
      return `上传中 ${item.percent}%`
    case 'indexing':
      return '服务端索引中…'
    case 'done':
      return '已入库'
    case 'canceled':
      return '已取消'
    default:
      return '失败'
  }
}

// emoji 换成矢量图标：跨平台渲染一致、能跟随主题色，也不会像 📄/⚙️ 那样字形大小不一
const STATUS_ICON = {
  uploading: 'loader',
  indexing: 'loader',
  done: 'checkCircle',
  error: 'alertTriangle',
  canceled: 'xCircle',
}

// 这两个状态是"进行中"，图标要转起来
const SPINNING = new Set(['uploading', 'indexing'])
</script>

<template>
  <div class="kb-panel">
    <!-- 上传区 -->
    <div
      v-if="auth.canManageKb"
      class="dropzone"
      :class="{ dragging, busy: kb.isBusy }"
      @click="pick"
      @dragover.prevent="dragging = true"
      @dragenter.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <span class="drop-icon" aria-hidden="true">
        <AppIcon
          :name="kb.isBusy ? 'loader' : 'uploadCloud'"
          :size="24"
          :stroke-width="1.6"
          :class="{ 'icon-spin': kb.isBusy }"
        />
      </span>
      <p class="drop-main">
        {{ kb.isBusy ? '正在处理，请稍候…' : '点击选择文件，或把文件拖到这里' }}
      </p>
      <p class="drop-hint">{{ hint }}</p>

      <button class="btn-upload" type="button" :disabled="kb.isBusy" @click.stop="pick">
        {{ kb.isBusy ? '上传中…' : '上传文件到知识库' }}
      </button>

      <input
        ref="fileInput"
        class="hidden-input"
        type="file"
        :accept="ACCEPT_ATTR"
        multiple
        aria-label="选择要上传的文档"
        @change="onPicked"
      />
    </div>

    <!--
      权限不足时**换掉整个上传区**，而不是让它渲染出来再报 403。
      后端 /api/upload 挂的是 require_roles("kb_admin")，普通 user 角色必然 403；
      给一个"点了才知道不行"的入口比没有入口更糟。
      注意这里只是隐藏入口，真正的边界仍是后端那道 403。
    -->
    <div v-else class="kb-gate" role="note">
      <span class="gate-icon" aria-hidden="true">
        <AppIcon name="lock" :size="22" :stroke-width="1.6" />
      </span>
      <p class="gate-title">没有上传知识库的权限</p>
      <p class="gate-desc">
        当前角色是<strong>{{ auth.roleText || '未登录' }}</strong
        >。上传文档需要<strong>知识库管理员</strong>（kb_admin）或管理员权限，请联系管理员开通账号。
      </p>
    </div>

    <!-- 上传记录 -->
    <div v-if="auth.canManageKb" class="kb-list-head">
      <span>本次会话上传（{{ kb.items.length }}）</span>
      <div class="list-actions">
        <button v-if="kb.isBusy" class="link-btn" @click="cancelAll">取消</button>
        <button v-if="kb.doneCount" class="link-btn" @click="kb.clearFinished()">清除已完成</button>
      </div>
    </div>

    <div v-if="auth.canManageKb" class="kb-list">
      <p v-if="!kb.items.length" class="empty">还没有上传记录</p>

      <div v-for="item in kb.items" :key="item.id" class="kb-item" :class="item.status">
        <div class="item-row">
          <span class="item-icon" :class="`st-${item.status}`" aria-hidden="true">
            <AppIcon
              :name="STATUS_ICON[item.status] || 'fileText'"
              :size="15"
              :class="{ 'icon-spin': SPINNING.has(item.status) }"
            />
          </span>
          <div class="item-main">
            <div class="item-name" :title="item.name">{{ item.name }}</div>
            <div class="item-sub">
              <span>{{ formatBytes(item.size) }}</span>
              <span class="sep">·</span>
              <span :class="`st-${item.status}`">{{ statusText(item) }}</span>
            </div>
          </div>
          <button
            class="item-remove"
            :aria-label="`从列表移除 ${item.name}`"
            @click="kb.remove(item.id)"
          >
            <AppIcon name="x" :size="14" />
          </button>
        </div>

        <!-- 进度条：上传阶段是真进度，索引阶段拿不到进度，用流动条纹表示"在做" -->
        <div v-if="item.status === 'uploading'" class="bar">
          <div class="bar-fill" :style="{ width: `${item.percent}%` }"></div>
        </div>
        <div v-else-if="item.status === 'indexing'" class="bar">
          <div class="bar-fill indeterminate"></div>
        </div>

        <p v-if="item.message" class="item-msg" :class="{ bad: item.status === 'error' }">
          {{ item.message }}
        </p>
      </div>
    </div>

    <footer class="kb-foot">
      <!--
        原来写的是"上传成功后即可在左侧直接提问"，但 <860px 时知识库会被堆到聊天下方，
        文案和布局自相矛盾。现在知识库是抽屉，指向"关掉面板"才是永远成立的说法。
      -->
      <p v-if="auth.canManageKb">
        上传成功后关掉这个面板直接提问即可，例如「云枢 S3 Pro 的功耗是多少？」
      </p>
      <p v-else>上传权限由管理员在后台开通，开通后刷新页面即可使用。</p>
    </footer>
  </div>
</template>

<style scoped>
.kb-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* ===== 权限不足的提示（替代整个上传区）===== */
.kb-gate {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-4);
  padding: var(--space-5) var(--space-4);
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--bg-app);
  text-align: center;
}

.gate-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-full);
  background: var(--bg-subtle);
  color: var(--text-muted);
}

.gate-title {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-primary);
}

.gate-desc {
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--text-muted);
}

.gate-desc strong {
  color: var(--text-secondary);
  font-weight: 600;
}

/* ===== 上传区 ===== */
.dropzone {
  margin: var(--space-4);
  padding: var(--space-5) var(--space-4);
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--bg-app);
  text-align: center;
  cursor: pointer;
  transition:
    border-color var(--duration) var(--ease),
    background var(--duration) var(--ease);
}

.dropzone:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.dropzone.dragging {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.dropzone.busy {
  cursor: progress;
  opacity: 0.75;
}

.drop-icon {
  display: flex;
  justify-content: center;
  color: var(--text-muted);
}

.drop-main {
  margin: var(--space-2) 0 var(--space-1);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.drop-hint {
  margin: 0 0 var(--space-4);
  font-size: var(--text-xs);
  color: var(--text-muted);
  line-height: var(--leading-normal);
}

.btn-upload {
  padding: 8px var(--space-4);
  border-radius: var(--radius-full);
  background: var(--action-bg);
  color: var(--on-action);
  font-size: var(--text-sm);
  font-weight: 500;
  transition: background var(--duration-fast) var(--ease);
}

.btn-upload:hover:not(:disabled) {
  background: var(--action-bg-hover);
}

.btn-upload:disabled {
  opacity: 0.5;
}

.hidden-input {
  display: none;
}

/* ===== 列表 ===== */
.kb-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 0 var(--space-4) var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.list-actions {
  display: flex;
  gap: var(--space-3);
}

.link-btn {
  color: var(--accent-text);
  font-size: var(--text-xs);
}

.link-btn:hover {
  text-decoration: underline;
}

.kb-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--space-4) var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.empty {
  padding: var(--space-4);
  font-size: var(--text-xs);
  color: var(--text-muted);
  text-align: center;
}

.kb-item {
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}

.kb-item.done {
  border-color: var(--success-bg);
  background: var(--success-bg);
}

.kb-item.error {
  border-color: var(--danger-bg);
  background: var(--danger-bg);
}

.item-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}

.item-icon {
  line-height: 1.4;
  color: var(--text-muted);
}

.item-main {
  flex: 1;
  min-width: 0;
}

.item-name {
  font-size: var(--text-sm);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-sub {
  display: flex;
  gap: var(--space-1);
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.sep {
  opacity: 0.6;
}

.st-done {
  color: var(--success);
}

.st-error {
  color: var(--danger);
}

.st-indexing,
.st-uploading {
  color: var(--warning);
}

.st-canceled {
  color: var(--text-muted);
}

.item-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  transition:
    background var(--duration-fast) var(--ease),
    color var(--duration-fast) var(--ease);
}

.item-remove:hover {
  background: var(--bg-hover);
  color: var(--danger);
}

.bar {
  height: 4px;
  margin-top: var(--space-2);
  border-radius: var(--radius-full);
  background: var(--bg-active);
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--accent);
  transition: width 0.25s ease;
}

/* 索引阶段拿不到真实进度，用流动条纹表示"正在做"而不是"卡住了" */
.bar-fill.indeterminate {
  width: 40%;
  background: repeating-linear-gradient(115deg, var(--accent) 0 8px, var(--accent-300) 8px 16px);
  animation: slide 1.1s linear infinite;
}

@keyframes slide {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}

.item-msg {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
  line-height: var(--leading-normal);
}

.item-msg.bad {
  color: var(--danger);
}

/* ===== 页脚 ===== */
.kb-foot {
  flex-shrink: 0;
  padding: var(--space-3) var(--space-4) var(--space-4);
  border-top: 1px solid var(--border);
}

.kb-foot p {
  font-size: var(--text-xs);
  color: var(--text-muted);
  line-height: var(--leading-normal);
}
</style>
