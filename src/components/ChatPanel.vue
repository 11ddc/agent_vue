<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useChatStore } from '@/stores/chat.js'
import { useRolesStore } from '@/stores/roles.js'
import { attachCaret, renderMarkdownCached } from '@/utils/markdown.js'

const chat = useChatStore()
const roles = useRolesStore()

const role = computed(() => roles.currentRole)

const scroller = ref(null)
const composer = ref(null)
// 用户往上翻看历史时不要被自动滚动拽回底部
const stickToBottom = ref(true)
/** 每条消息"详情"折叠面板的展开状态，按消息 id 存 */
const expanded = ref({})

const MODE_LABEL = {
  stream: '流式',
  sync: '同步降级',
  failed: '失败',
}

const hasConversation = computed(() => chat.messages.some((m) => m.role === 'user'))

/**
 * 正文列表。
 *
 * 开场白（messages[0]）只在空状态下由 hero 呈现，进入正式对话后从正文里摘掉这一条，
 * 否则"发出第一句之后欢迎语会突然多冒出来一条"，阅读顺序也会错。
 */
const transcript = computed(() => {
  const list = chat.messages
  return list.length > 1 && list[0].role === 'assistant' ? list.slice(1) : []
})

/** 连续多条助手消息时只在第一条显示头像，避免整列头像刷屏 */
function showAvatar(index) {
  if (index === 0) return true
  return transcript.value[index - 1].role !== 'assistant'
}

/**
 * 助手消息渲染成 HTML。
 *
 * v-html 在这里是安全的，理由在 src/utils/markdown.js 的头部注释里：
 * 渲染器**先转义再变换**，输出里除了它自己拼出来的白名单标签之外不含任何输入内容。
 * 用户消息走纯文本插值，不受这套影响。
 */
function answerHtml(msg) {
  if (!msg.content) return ''
  const html = renderMarkdownCached(msg.content)
  // 流式进行中：末尾挂一个闪烁光标，让"还在写"有连续的视觉反馈
  return msg.pending ? attachCaret(html) : html
}

function hasDetails(msg) {
  return Boolean(msg.mode || msg.intent || msg.method || msg.elapsedMs)
}

function toggleDetails(id) {
  expanded.value[id] = !expanded.value[id]
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatElapsed(ms) {
  if (!ms) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

// ===== 滚动跟随 =====
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
watch(
  () => chat.messages.map((m) => m.content + (m.status || '')).join('|'),
  () => scrollToBottom(),
)
watch(
  () => chat.isSending,
  (value) => {
    if (value) {
      stickToBottom.value = true
      scrollToBottom(true)
    }
  },
)

// ===== 输入 =====
/**
 * 让 textarea 跟着内容长高。
 *
 * 重构前是 `rows="1"` + `max-height: 132px`，但没有任何自适应逻辑，
 * 所以输入第二行时文本只是在一个 26px 高的框里滚动，那个 max-height 从来没生效过。
 */
function autoGrow() {
  const el = composer.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`
}
// flush: 'post' —— 发完消息后输入框被清空，要等 DOM 更新完再量高度
watch(() => chat.inputText, autoGrow, { flush: 'post' })

// 切换角色后把焦点给输入框，省一次点击
watch(
  () => roles.currentId,
  () => {
    nextTick(() => composer.value?.focus())
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

function useSuggestion(question) {
  stickToBottom.value = true
  chat.send(question)
}

onMounted(() => {
  scrollToBottom(true)
  autoGrow()
})
</script>

<template>
  <section class="chat-panel">
    <div ref="scroller" class="messages" @scroll.passive="onScroll">
      <!-- 空状态：开场白 + 引导问题。原来那 4 条长问句是常驻 chip，换行后糊成一团 -->
      <div v-if="!hasConversation" class="hero">
        <span class="hero-mark" aria-hidden="true">
          <AppIcon :name="role.icon" :size="24" :stroke-width="1.6" />
        </span>
        <h2 class="hero-title">{{ role.name }}</h2>
        <p class="hero-tagline">{{ role.tagline }}</p>
        <p class="hero-welcome">{{ role.welcome }}</p>

        <ul class="suggestions">
          <li v-for="question in role.suggestions" :key="question">
            <button class="suggestion" :disabled="chat.isSending" @click="useSuggestion(question)">
              <span class="suggestion-text">{{ question }}</span>
              <AppIcon class="suggestion-go" name="send" :size="14" />
            </button>
          </li>
        </ul>
      </div>

      <template v-else>
        <article
          v-for="(msg, index) in transcript"
          :key="msg.id"
          class="msg"
          :class="`msg-${msg.role}`"
        >
          <span
            v-if="msg.role === 'assistant'"
            class="msg-avatar"
            :class="{ 'is-continuation': !showAvatar(index) }"
            aria-hidden="true"
          >
            <AppIcon :name="role.icon" :size="15" />
          </span>

          <div class="msg-body">
            <!--
              用户消息按纯文本渲染：用户自己打的星号/下划线不该被当成 markdown 吃掉。
              助手消息不带气泡（整块排版，像主流对话产品），元信息收进"详情"。
            -->
            <p v-if="msg.role === 'user'" class="bubble-user">{{ msg.content }}</p>
            <div v-else-if="msg.content" class="answer" v-html="answerHtml(msg)"></div>

            <p v-if="msg.pending && !msg.content" class="thinking" role="status">
              <span class="typing-dot" aria-hidden="true"></span>
              <span class="typing-dot" aria-hidden="true"></span>
              <span class="typing-dot" aria-hidden="true"></span>
              <span class="thinking-text">{{ msg.status || '正在思考…' }}</span>
            </p>

            <p v-if="msg.resetReason && !msg.pending" class="note">{{ msg.resetReason }}</p>
            <p v-if="msg.interrupted && !msg.pending" class="note">
              回答被中断，以上为已接收到的部分内容
            </p>
            <p v-if="msg.error && !msg.pending" class="note is-error">请求异常：{{ msg.error }}</p>

            <footer class="msg-foot">
              <time class="ts tnum">{{ formatTime(msg.time) }}</time>
              <span v-if="msg.handoff" class="badge">
                <AppIcon name="user" :size="12" />
                已转人工
              </span>
              <button
                v-if="hasDetails(msg)"
                class="details-toggle"
                :aria-expanded="!!expanded[msg.id]"
                :aria-controls="`msg-details-${msg.id}`"
                @click="toggleDetails(msg.id)"
              >
                <AppIcon
                  class="chev"
                  :class="{ 'is-open': !!expanded[msg.id] }"
                  name="chevronDown"
                  :size="13"
                />
                详情
              </button>
            </footer>

            <!--
              交付方式 / 意图 / 链路 / 耗时原本直接铺在气泡下面，
              对终端用户是纯噪音（"同步降级"只会让人以为系统坏了），收进折叠详情。
            -->
            <dl
              v-if="expanded[msg.id] && hasDetails(msg)"
              :id="`msg-details-${msg.id}`"
              class="details"
            >
              <template v-if="msg.mode">
                <dt>交付方式</dt>
                <dd>{{ MODE_LABEL[msg.mode] || msg.mode }}</dd>
              </template>
              <template v-if="msg.intent">
                <dt>意图</dt>
                <dd>{{ msg.intent }}</dd>
              </template>
              <template v-if="msg.method">
                <dt>链路</dt>
                <dd>{{ msg.method }}</dd>
              </template>
              <template v-if="msg.elapsedMs">
                <dt>耗时</dt>
                <dd class="tnum">{{ formatElapsed(msg.elapsedMs) }}</dd>
              </template>
            </dl>
          </div>
        </article>
      </template>
    </div>

    <div class="composer">
      <div class="composer-box">
        <textarea
          ref="composer"
          v-model="chat.inputText"
          class="composer-input"
          rows="1"
          :placeholder="role.placeholder"
          aria-label="输入消息"
          @keydown="onKeydown"
        ></textarea>

        <button
          v-if="chat.isSending"
          class="send-btn is-stop"
          aria-label="停止生成"
          @click="chat.stop()"
        >
          <AppIcon name="stop" :size="16" />
        </button>
        <button
          v-else
          class="send-btn"
          :disabled="!chat.canSend"
          aria-label="发送消息"
          @click="submit"
        >
          <AppIcon name="send" :size="17" />
        </button>
      </div>
      <p class="composer-note">AI 可能会出错，重要信息请核实</p>
    </div>
  </section>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--bg-app);
}

.messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-6) var(--space-5) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* ===== 空状态 ===== */
.hero {
  /* auto 上下外边距：空状态在可视区里垂直居中 */
  margin: auto 0;
  padding: var(--space-8) 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.hero-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-lg);
  background: var(--accent-soft);
  color: var(--accent-text);
}

.hero-title {
  margin-top: var(--space-4);
  font-size: var(--text-xl);
  font-weight: 650;
  letter-spacing: -0.02em;
}

.hero-tagline {
  margin-top: var(--space-1);
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.hero-welcome {
  margin-top: var(--space-4);
  max-width: 44ch;
  font-size: var(--text-base);
  line-height: var(--leading-relaxed);
  color: var(--text-secondary);
  white-space: pre-wrap;
}

.suggestions {
  list-style: none;
  margin-top: var(--space-6);
  width: 100%;
  display: grid;
  gap: var(--space-2);
}

.suggestion {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  text-align: left;
  transition:
    border-color var(--duration-fast) var(--ease),
    background var(--duration-fast) var(--ease),
    color var(--duration-fast) var(--ease);
}

.suggestion:hover:not(:disabled) {
  border-color: var(--accent-soft-border);
  background: var(--accent-soft);
  color: var(--text-primary);
}

.suggestion:disabled {
  opacity: 0.5;
}

.suggestion-text {
  flex: 1;
  min-width: 0;
}

/* 复用"发送"箭头图标，转 45° 变成向右上——省一个图标 */
.suggestion-go {
  color: var(--text-muted);
  transform: rotate(45deg);
}

.suggestion:hover:not(:disabled) .suggestion-go {
  color: var(--accent-text);
}

/* ===== 消息 ===== */
.msg {
  display: flex;
  gap: var(--space-3);
}

.msg-user {
  justify-content: flex-end;
}

.msg-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  margin-top: 2px;
  border-radius: var(--radius-full);
  background: var(--accent-soft);
  color: var(--accent-text);
}

/* 连续消息用 visibility 而不是 display：占位还在，左边线不会错开 */
.msg-avatar.is-continuation {
  visibility: hidden;
}

.msg-body {
  flex: 1;
  min-width: 0;
}

.msg-user .msg-body {
  flex: 0 1 auto;
  max-width: 84%;
}

.bubble-user {
  padding: 9px var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--bubble-user-bg);
  color: var(--bubble-user-fg);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.answer {
  font-size: var(--text-md);
  line-height: var(--leading-relaxed);
  color: var(--text-primary);
  word-break: break-word;
  overflow-wrap: anywhere;
}

/*
 * ===== markdown 正文样式 =====
 * 必须用 :deep()：v-html 注入的节点上没有 scoped 属性，
 * 普通后代选择器（比如 .answer p）匹配不到它们。
 */
.answer :deep(p) {
  margin: 0 0 0.7em;
}

.answer :deep(> *:last-child) {
  margin-bottom: 0;
}

.answer :deep(strong) {
  font-weight: 650;
}

.answer :deep(em) {
  font-style: italic;
}

.answer :deep(del) {
  opacity: 0.6;
}

.answer :deep(a) {
  color: var(--accent-text);
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
}

.answer :deep(a:hover) {
  color: var(--accent-hover);
}

.answer :deep(ul),
.answer :deep(ol) {
  margin: 0 0 0.7em;
  padding-left: 1.4em;
}

.answer :deep(li) {
  margin-bottom: 0.3em;
}

.answer :deep(li::marker) {
  color: var(--text-muted);
}

.answer :deep(h1),
.answer :deep(h2),
.answer :deep(h3),
.answer :deep(h4),
.answer :deep(h5),
.answer :deep(h6) {
  margin: 1em 0 0.5em;
  font-size: var(--text-md);
  font-weight: 650;
  line-height: var(--leading-tight);
}

.answer :deep(> h1:first-child),
.answer :deep(> h2:first-child),
.answer :deep(> h3:first-child),
.answer :deep(> h4:first-child) {
  margin-top: 0;
}

.answer :deep(code) {
  padding: 0.12em 0.38em;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  font-family: var(--font-mono);
  font-size: 0.88em;
}

.answer :deep(pre) {
  margin: 0 0 0.7em;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-subtle);
  overflow-x: auto;
}

/* pre 里的 code 不能再来一层底色和边框，否则是双层框 */
.answer :deep(pre code) {
  padding: 0;
  border: none;
  background: none;
  font-size: 0.86em;
  line-height: var(--leading-normal);
}

.answer :deep(blockquote) {
  margin: 0 0 0.7em;
  padding-left: var(--space-3);
  border-left: 2px solid var(--border-strong);
  color: var(--text-secondary);
}

.answer :deep(hr) {
  margin: var(--space-4) 0;
  border: none;
  border-top: 1px solid var(--border);
}

/* 流式光标：由 markdown.js 的 attachCaret 插到最后一个段落内部 */
.answer :deep(.md-caret) {
  display: inline-block;
  width: 2px;
  height: 1.05em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: var(--accent);
  animation: caret-blink 1s step-end infinite;
}

@keyframes caret-blink {
  50% {
    opacity: 0;
  }
}

/* ===== 阶段提示 ===== */
.thinking {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-top: 3px;
}

.typing-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--border-strong);
  animation: bounce 1.4s infinite ease-in-out both;
}

.typing-dot:nth-child(2) {
  animation-delay: -0.16s;
}

.typing-dot:nth-child(3) {
  animation-delay: -0.32s;
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

.thinking-text {
  margin-left: 6px;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.note {
  margin-top: var(--space-2);
  padding: 6px var(--space-3);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
}

.note.is-error {
  background: var(--danger-bg);
  color: var(--danger);
}

/* ===== 元信息 ===== */
.msg-foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.msg-user .msg-foot {
  justify-content: flex-end;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: var(--warning-bg);
  color: var(--warning);
  font-size: var(--text-xs);
}

.details-toggle {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--text-muted);
  font-size: var(--text-xs);
  transition: color var(--duration-fast) var(--ease);
}

.details-toggle:hover {
  color: var(--text-secondary);
}

.chev {
  transition: transform var(--duration-fast) var(--ease);
}

.chev.is-open {
  transform: rotate(180deg);
}

.details {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px var(--space-3);
  margin-top: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
  font-size: var(--text-xs);
}

.details dt {
  color: var(--text-muted);
}

.details dd {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  word-break: break-all;
}

/* ===== 输入区 ===== */
.composer {
  flex-shrink: 0;
  padding: var(--space-3) var(--space-5) var(--space-4);
  border-top: 1px solid var(--border);
  background: var(--bg-surface);
}

.composer-box {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-surface);
  box-shadow: var(--shadow-xs);
  transition: border-color var(--duration-fast) var(--ease);
}

/* 焦点指示画在外框上：内层 textarea 自己的 outline 会在框里再套一层，很脏 */
.composer-box:focus-within {
  border-color: var(--focus-ring);
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.composer-input {
  flex: 1;
  min-width: 0;
  min-height: 26px;
  max-height: 200px;
  padding: 6px 0;
  border: none;
  background: none;
  font-size: var(--text-md);
  line-height: var(--leading-normal);
  resize: none;
  outline: none;
  overflow-y: auto;
}

.composer-input:focus-visible {
  outline: none;
}

.composer-input::placeholder {
  color: var(--text-muted);
}

.send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-full);
  background: var(--action-bg);
  color: var(--on-action);
  transition:
    background var(--duration-fast) var(--ease),
    opacity var(--duration-fast) var(--ease);
}

.send-btn:hover:not(:disabled) {
  background: var(--action-bg-hover);
}

.send-btn:disabled {
  opacity: 0.32;
}

.send-btn.is-stop {
  background: var(--bg-active);
  color: var(--text-primary);
}

.send-btn.is-stop:hover {
  background: var(--border-strong);
}

.composer-note {
  margin-top: var(--space-2);
  text-align: center;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

@media (max-width: 640px) {
  .messages {
    padding: var(--space-5) var(--space-4) var(--space-3);
  }

  .composer {
    padding: var(--space-3) var(--space-4) var(--space-4);
  }

  .msg-user .msg-body {
    max-width: 88%;
  }

  /* 窄屏优先把垂直空间让给对话 */
  .composer-note {
    display: none;
  }
}
</style>
