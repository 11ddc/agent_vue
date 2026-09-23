<script setup>
import { ref, watch, nextTick, computed, onMounted } from 'vue'
import { useChatStore } from '@/stores/chat.js'

const chat = useChatStore()

const scroller = ref(null)
const composer = ref(null)
// 用户往上翻看历史时不要被自动滚动拽回底部
const stickToBottom = ref(true)

const sessionLabel = computed(() =>
  chat.sessionId ? `${chat.sessionId.slice(0, 8)}…` : '新会话',
)

function onScroll() {
  const el = scroller.value
  if (!el) return
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight
  stickToBottom.value = distance < 80
}

async function scrollToBottom(force = false) {
  if (!force && !stickToBottom.value) return
  await nextTick()
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

// 正文增量 + 阶段提示变化都要跟随滚动
watch(() => chat.messages.map((m) => m.content + (m.status || '')).join('|'), () => scrollToBottom())
watch(
  () => chat.isSending,
  (v) => {
    if (v) {
      stickToBottom.value = true
      scrollToBottom(true)
    }
  },
)

function onKeydown(e) {
  // Enter 发送，Shift+Enter 换行；输入法组合中的 Enter 不能当发送
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    submit()
  }
}

function submit() {
  if (!chat.canSend) return
  stickToBottom.value = true
  chat.send()
}

function useQuick(q) {
  stickToBottom.value = true
  chat.sendQuickQuestion(q)
}

function newSession() {
  chat.reset()
  stickToBottom.value = true
  scrollToBottom(true)
  composer.value?.focus()
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatElapsed(ms) {
  if (!ms) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

const MODE_LABEL = {
  stream: '流式',
  sync: '同步降级',
  failed: '失败',
}

onMounted(() => scrollToBottom(true))
</script>

<template>
  <section class="chat-panel">
    <!-- 头部 -->
    <header class="panel-head">
      <div class="agent">
        <div class="avatar">🤖</div>
        <div class="agent-meta">
          <div class="agent-name">
            智能客服小优
            <span class="dot-online" :class="{ busy: chat.isSending }"></span>
          </div>
          <div class="agent-sub">
            {{ chat.isSending ? chat.statusText || '正在处理…' : '在线 · 基于知识库回答' }}
          </div>
        </div>
      </div>
      <div class="head-actions">
        <span class="session-chip" :title="chat.sessionId || '尚未建立会话'">
          会话 {{ sessionLabel }}
        </span>
        <button class="ghost-btn" title="清空消息并开启新会话" @click="newSession">新会话</button>
      </div>
    </header>

    <!-- 消息区 -->
    <div ref="scroller" class="messages" @scroll.passive="onScroll">
      <div
        v-for="msg in chat.messages"
        :key="msg.id"
        class="row"
        :class="msg.role === 'user' ? 'row-user' : 'row-agent'"
      >
        <div v-if="msg.role === 'assistant'" class="bubble-avatar">🤖</div>

        <div class="stack">
          <div class="bubble" :class="msg.role === 'user' ? 'bubble-user' : 'bubble-agent'">
            <!-- 纯文本 + pre-wrap：后端返回的是 markdown 文本，这里不做 HTML 注入 -->
            <span v-if="msg.content" class="bubble-text">{{ msg.content }}</span>

            <!-- 还没吐正文时的阶段提示 -->
            <span v-if="msg.pending && !msg.content" class="pending">
              <span class="typing-dot"></span>
              <span class="typing-dot"></span>
              <span class="typing-dot"></span>
              <em class="pending-text">{{ msg.status || '正在思考…' }}</em>
            </span>
          </div>

          <div class="meta-line">
            <span class="time">{{ formatTime(msg.time) }}</span>
            <template v-if="msg.role === 'assistant' && !msg.pending">
              <span v-if="msg.mode" class="tag" :class="`tag-${msg.mode}`">
                {{ MODE_LABEL[msg.mode] || msg.mode }}
              </span>
              <span v-if="msg.intent" class="tag">意图 {{ msg.intent }}</span>
              <span v-if="msg.method" class="tag">{{ msg.method }}</span>
              <span v-if="msg.handoff" class="tag tag-warn">转人工</span>
              <span v-if="msg.elapsedMs" class="tag">{{ formatElapsed(msg.elapsedMs) }}</span>
            </template>
          </div>

          <div v-if="msg.resetReason && !msg.pending" class="note">{{ msg.resetReason }}</div>
          <div v-if="msg.error && !msg.pending" class="note note-error">
            请求异常：{{ msg.error }}
          </div>
          <div v-else-if="msg.interrupted" class="note">回答被中断，以上为已接收到的部分内容</div>
        </div>
      </div>
    </div>

    <!-- 快捷问题 -->
    <div class="quick-bar">
      <button
        v-for="q in chat.quickQuestions"
        :key="q"
        class="quick-chip"
        :disabled="chat.isSending"
        @click="useQuick(q)"
      >
        {{ q }}
      </button>
    </div>

    <!-- 输入区 -->
    <div class="composer">
      <textarea
        ref="composer"
        v-model="chat.inputText"
        class="composer-input"
        rows="1"
        placeholder="输入您的问题，Enter 发送，Shift+Enter 换行"
        @keydown="onKeydown"
      ></textarea>
      <button v-if="chat.isSending" class="btn-stop" @click="chat.stop()">停止</button>
      <button v-else class="btn-send" :disabled="!chat.canSend" @click="submit">发送</button>
    </div>
  </section>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fff;
  border-radius: var(--radius-xl);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
  overflow: hidden;
}

/* ===== 头部 ===== */
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  background: linear-gradient(135deg, #ff6b35, #f7931e);
  color: #fff;
}

.agent {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.avatar {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

.agent-meta {
  min-width: 0;
}

.agent-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
}

.dot-online {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #7dff9b;
  box-shadow: 0 0 0 3px rgba(125, 255, 155, 0.25);
}

.dot-online.busy {
  background: #ffe066;
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}

.agent-sub {
  font-size: 12px;
  opacity: 0.9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.session-chip {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.2);
  font-variant-numeric: tabular-nums;
}

.ghost-btn {
  padding: 5px 12px;
  font-size: 12px;
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 14px;
  transition: background 0.2s;
}

.ghost-btn:hover {
  background: rgba(255, 255, 255, 0.32);
}

/* ===== 消息区 ===== */
.messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
  background: #f7f8fa;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.row {
  display: flex;
  gap: 8px;
  max-width: 88%;
}

.row-user {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.row-agent {
  align-self: flex-start;
}

.bubble-avatar {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
}

.stack {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.row-user .stack {
  align-items: flex-end;
}

.bubble {
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.65;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.bubble-user {
  background: var(--color-primary);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.bubble-agent {
  background: #fff;
  color: var(--color-text);
  border-bottom-left-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* 后端答案是 markdown 文本，保留换行但不做 HTML 注入 */
.bubble-text {
  white-space: pre-wrap;
}

.pending {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.pending-text {
  margin-left: 6px;
  font-style: normal;
  font-size: 13px;
  color: var(--color-text-muted);
}

.typing-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ccc;
  animation: bounce 1.4s infinite ease-in-out both;
}

.typing-dot:nth-child(1) {
  animation-delay: -0.32s;
}
.typing-dot:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes bounce {
  0%,
  80%,
  100% {
    transform: scale(0.6);
  }
  40% {
    transform: scale(1);
  }
}

/* ===== 元信息 ===== */
.meta-line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 5px;
  padding: 0 4px;
  font-size: 11px;
  color: #b6bcc6;
}

.tag {
  padding: 1px 7px;
  border-radius: 8px;
  background: #eef0f4;
  color: #8b93a1;
}

.tag-stream {
  background: #e6f7ec;
  color: #1f9254;
}

.tag-sync {
  background: #fff4e5;
  color: #b87503;
}

.tag-failed {
  background: #fdecec;
  color: #d64545;
}

.tag-warn {
  background: #fdecec;
  color: #d64545;
}

.note {
  margin-top: 6px;
  padding: 5px 9px;
  border-radius: 8px;
  background: #f2f4f7;
  color: #8b93a1;
  font-size: 11px;
}

.note-error {
  background: #fdecec;
  color: #d64545;
}

/* ===== 快捷问题 ===== */
.quick-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 16px;
  background: #fff;
  border-top: 1px solid #f0f0f0;
}

.quick-chip {
  padding: 5px 11px;
  border: 1px solid #e8e8e8;
  border-radius: 14px;
  background: #fff;
  font-size: 12px;
  color: #666;
  transition: all 0.2s;
}

.quick-chip:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: #fff5f0;
}

.quick-chip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ===== 输入区 ===== */
.composer {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid #f0f0f0;
  background: #fff;
}

.composer-input {
  flex: 1;
  min-height: 42px;
  max-height: 132px;
  padding: 11px 14px;
  border: 1px solid #e8e8e8;
  border-radius: 12px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
  resize: none;
  outline: none;
  transition: border-color 0.2s;
}

.composer-input:focus {
  border-color: var(--color-primary);
}

.btn-send,
.btn-stop {
  flex-shrink: 0;
  padding: 11px 22px;
  border: none;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 500;
  color: #fff;
  transition: background 0.2s;
}

.btn-send {
  background: var(--color-primary);
}

.btn-send:hover:not(:disabled) {
  background: var(--color-primary-dark);
}

.btn-send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn-stop {
  background: #6b7280;
}

.btn-stop:hover {
  background: #4b5563;
}

@media (max-width: 900px) {
  .row {
    max-width: 100%;
  }
}
</style>
