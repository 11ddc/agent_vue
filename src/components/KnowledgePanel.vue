<script setup>
import { ref, computed } from 'vue'
import { useKnowledgeStore } from '@/stores/knowledge.js'
import { ACCEPT_ATTR, ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES, formatBytes } from '@/api/knowledge.js'

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

const STATUS_ICON = {
  uploading: '⬆️',
  indexing: '⚙️',
  done: '✅',
  error: '⚠️',
  canceled: '⏹️',
}
</script>

<template>
  <aside class="kb-panel">
    <header class="kb-head">
      <div>
        <h2 class="kb-title">📚 知识库</h2>
        <p class="kb-sub">上传的文档会被解析、切块、向量化后立即参与回答</p>
      </div>
    </header>

    <!-- 上传区 -->
    <div
      class="dropzone"
      :class="{ dragging, busy: kb.isBusy }"
      @click="pick"
      @dragover.prevent="dragging = true"
      @dragenter.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <div class="drop-icon">{{ kb.isBusy ? '⏳' : '📄' }}</div>
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
        @change="onPicked"
      />
    </div>

    <!-- 上传记录 -->
    <div class="kb-list-head">
      <span>本次会话上传（{{ kb.items.length }}）</span>
      <div class="list-actions">
        <button v-if="kb.isBusy" class="link-btn" @click="cancelAll">取消</button>
        <button v-if="kb.doneCount" class="link-btn" @click="kb.clearFinished()">清除已完成</button>
      </div>
    </div>

    <div class="kb-list">
      <p v-if="!kb.items.length" class="empty">还没有上传记录</p>

      <div v-for="item in kb.items" :key="item.id" class="kb-item" :class="item.status">
        <div class="item-row">
          <span class="item-icon">{{ STATUS_ICON[item.status] || '📄' }}</span>
          <div class="item-main">
            <div class="item-name" :title="item.name">{{ item.name }}</div>
            <div class="item-sub">
              <span>{{ formatBytes(item.size) }}</span>
              <span class="sep">·</span>
              <span :class="`st-${item.status}`">{{ statusText(item) }}</span>
            </div>
          </div>
          <button class="item-remove" title="从列表移除" @click="kb.remove(item.id)">×</button>
        </div>

        <!-- 进度条：上传阶段是真进度，索引阶段无法拿到进度，用流动条纹表示"在做" -->
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
      <p>上传成功后即可在左侧直接提问，例如「云枢S3 Pro 的功耗是多少？」</p>
    </footer>
  </aside>
</template>

<style scoped>
.kb-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fff;
  border-radius: var(--radius-xl);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
  overflow: hidden;
}

/* ===== 头部 ===== */
.kb-head {
  padding: 16px 18px 12px;
  border-bottom: 1px solid #f0f0f0;
}

.kb-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
}

.kb-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.5;
}

/* ===== 上传区 ===== */
.dropzone {
  margin: 14px;
  padding: 20px 16px;
  border: 1.5px dashed #dfe3e8;
  border-radius: var(--radius-lg);
  background: #fafbfc;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
}

.dropzone:hover {
  border-color: var(--color-primary);
  background: #fff8f4;
}

.dropzone.dragging {
  border-color: var(--color-primary);
  background: #fff2ea;
  transform: scale(1.01);
}

.dropzone.busy {
  cursor: progress;
  opacity: 0.75;
}

.drop-icon {
  font-size: 28px;
}

.drop-main {
  margin: 8px 0 4px;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.drop-hint {
  margin: 0 0 14px;
  font-size: 11px;
  color: #a8b0bb;
  line-height: 1.5;
}

.btn-upload {
  padding: 9px 18px;
  border: none;
  border-radius: 20px;
  background: var(--color-primary);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  transition: background 0.2s;
}

.btn-upload:hover:not(:disabled) {
  background: var(--color-primary-dark);
}

.btn-upload:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.hidden-input {
  display: none;
}

/* ===== 列表 ===== */
.kb-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 18px 8px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.list-actions {
  display: flex;
  gap: 10px;
}

.link-btn {
  border: none;
  background: none;
  padding: 0;
  font-size: 12px;
  color: var(--color-primary);
}

.link-btn:hover {
  text-decoration: underline;
}

.kb-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 14px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty {
  padding: 16px 4px;
  font-size: 12px;
  color: #b6bcc6;
  text-align: center;
}

.kb-item {
  padding: 10px 12px;
  border: 1px solid #eef0f3;
  border-radius: var(--radius-base);
  background: #fff;
}

.kb-item.done {
  border-color: #d9f0e1;
  background: #f7fdf9;
}

.kb-item.error {
  border-color: #fadcdc;
  background: #fff8f8;
}

.item-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.item-icon {
  font-size: 14px;
  line-height: 1.4;
}

.item-main {
  flex: 1;
  min-width: 0;
}

.item-name {
  font-size: 13px;
  color: var(--color-text);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-sub {
  margin-top: 2px;
  font-size: 11px;
  color: #9aa2ad;
  display: flex;
  gap: 4px;
}

.sep {
  opacity: 0.6;
}

.st-done {
  color: #1f9254;
}
.st-error {
  color: #d64545;
}
.st-indexing {
  color: #b87503;
}

.item-remove {
  border: none;
  background: none;
  color: #c8ccd3;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
}

.item-remove:hover {
  color: #d64545;
}

.bar {
  margin-top: 8px;
  height: 4px;
  border-radius: 2px;
  background: #eef0f3;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: var(--color-primary);
  border-radius: 2px;
  transition: width 0.25s ease;
}

/* 索引阶段拿不到真实进度，用流动条纹表示"正在做"而不是"卡住了" */
.bar-fill.indeterminate {
  width: 40%;
  background: repeating-linear-gradient(
    115deg,
    #f7931e 0 8px,
    #ffc891 8px 16px
  );
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
  margin: 7px 0 0;
  font-size: 11px;
  color: #8b93a1;
  line-height: 1.5;
}

.item-msg.bad {
  color: #d64545;
}

/* ===== 页脚 ===== */
.kb-foot {
  padding: 10px 18px 14px;
  border-top: 1px solid #f0f0f0;
}

.kb-foot p {
  margin: 0;
  font-size: 11px;
  color: #a8b0bb;
  line-height: 1.5;
}
</style>
