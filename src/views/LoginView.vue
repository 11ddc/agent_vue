<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import { useAuthStore } from '@/stores/auth.js'
import { useThemeStore } from '@/stores/theme.js'
import { MIN_PASSWORD_LEN, MIN_USERNAME_LEN, validateCredentials } from '@/api/auth.js'

/**
 * 登录 / 注册。
 *
 * 一个组件两个模式（而不是两个路由）：两个表单的字段、校验、提交后处理几乎重合，
 * 拆成两个组件后"注册即登录"这类共性逻辑就得复制一遍。模式写进 query（?mode=register）
 * 而不是只放本地 ref —— 这样刷新和前进后退都还在同一个标签页上，也能直接分享链接。
 *
 * 这个页面渲染在**没有侧边栏**的布局里（见 App.vue 的 meta.layout === 'auth'）：
 * 未登录时露出"新对话 / 知识库 / 会话 xxx"是没有意义的，点哪个都会 401。
 */

const auth = useAuthStore()
const theme = useThemeStore()
const route = useRoute()
const router = useRouter()

const mode = ref(route.query.mode === 'register' ? 'register' : 'login')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const displayName = ref('')
/** 本地校验的提示（还没发出请求就发现了） */
const formError = ref('')
/** 会话过期之类的一次性说明 */
const notice = ref('')

const isRegister = computed(() => mode.value === 'register')
const errorText = computed(() => formError.value || auth.lastError)
const submitText = computed(() => {
  if (auth.busy) return isRegister.value ? '正在创建…' : '正在登录…'
  return isRegister.value ? '创建账号并登录' : '登录'
})

onMounted(() => {
  // 只取一次：取完就清掉 store 里的值，否则用户手动切到注册页时
  // 这句"会话已失效"还挂在上面，看起来像注册也失败了。
  if (auth.expiredReason) {
    notice.value = `登录状态已失效（${auth.expiredReason}），请重新登录`
    auth.clearExpiredReason()
  }
})

// 浏览器前进/后退时 mode 跟着 URL 走
watch(
  () => route.query.mode,
  (m) => {
    mode.value = m === 'register' ? 'register' : 'login'
  },
)

/**
 * 记下"错误出现那一刻"的输入，用来判断用户后来有没有真的改过东西。
 *
 * 为什么不能在任何 input 上无条件清错误：提交是同步发生的，而 v-model 写入触发的
 * watcher 要等到下一个 tick 才 flush。于是"填完立刻提交"（表单自动填充、脚本化提交）
 * 会出现：onSubmit 刚设好"两次密码不一致"，紧接着 watcher 就把它清掉 —— 用户什么都没改，
 * 提示却消失了。语义上我们要的是"用户在提示之后又改了输入"，所以比一比快照。
 */
let errorSnapshot = ''

const snapshotOf = () =>
  [username.value, password.value, confirmPassword.value, displayName.value, mode.value].join(
    '\u0000',
  )

function raiseError(message) {
  formError.value = message
  errorSnapshot = snapshotOf()
}

// 一开始输入就把上一次的错误清掉：错误一直挂着会让人以为这次也不行
watch([username, password, confirmPassword, displayName, mode], () => {
  if (formError.value && snapshotOf() === errorSnapshot) return // 同一次提交带出来的事件，不算"用户改了"
  formError.value = ''
  auth.clearError()
})

function switchMode(next) {
  if (next === mode.value) return
  const query = {}
  if (next === 'register') query.mode = 'register'
  // 保留 redirect，切模式不该把"登录后要去哪"丢掉
  if (typeof route.query.redirect === 'string') query.redirect = route.query.redirect
  router.replace({ name: 'login', query })
}

async function onSubmit() {
  const local = validateCredentials({
    username: username.value,
    password: password.value,
    confirmPassword: isRegister.value ? confirmPassword.value : undefined,
    mode: mode.value,
  })
  if (local) {
    raiseError(local)
    return
  }

  const ok = isRegister.value
    ? await auth.register({
        username: username.value.trim(),
        password: password.value,
        displayName: displayName.value.trim(),
      })
    : await auth.login({ username: username.value.trim(), password: password.value })

  if (!ok) return // 具体原因在 auth.lastError 里，由 errorText 显示

  // 只接受站内路径。必须同时排除 `//evil.com` —— 浏览器把双斜杠开头的地址
  // 当成协议相对 URL，只判 startsWith('/') 就是留了一个开放重定向。
  const raw = route.query.redirect
  const target = typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
  await router.replace(target)
}
</script>

<template>
  <div class="auth-page">
    <button
      class="theme-btn"
      type="button"
      :aria-label="`主题：${theme.label}，点击切换`"
      :title="`当前：${theme.label}（点击切换）`"
      @click="theme.cycle()"
    >
      <AppIcon :name="theme.icon" :size="17" />
    </button>

    <div class="auth-card">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <AppIcon name="sparkles" :size="18" :stroke-width="2" />
        </span>
        <span class="brand-text">
          <strong>AI 对话</strong>
          <small>知识库增强</small>
        </span>
      </div>

      <div class="tabs" role="tablist" aria-label="登录或注册">
        <button
          class="tab"
          type="button"
          role="tab"
          :class="{ 'is-active': !isRegister }"
          :aria-selected="!isRegister"
          @click="switchMode('login')"
        >
          登录
        </button>
        <button
          class="tab"
          type="button"
          role="tab"
          :class="{ 'is-active': isRegister }"
          :aria-selected="isRegister"
          @click="switchMode('register')"
        >
          注册
        </button>
      </div>

      <p v-if="notice" class="notice" role="status">
        <AppIcon name="info" :size="15" />
        <span>{{ notice }}</span>
      </p>

      <form class="form" novalidate @submit.prevent="onSubmit">
        <label class="field">
          <span class="field-label">用户名</span>
          <input
            v-model="username"
            class="control"
            type="text"
            name="username"
            autocomplete="username"
            :placeholder="isRegister ? `至少 ${MIN_USERNAME_LEN} 个字符` : '请输入用户名'"
            autocapitalize="off"
            spellcheck="false"
            autofocus
          />
        </label>

        <label class="field">
          <span class="field-label">密码</span>
          <input
            v-model="password"
            class="control"
            type="password"
            name="password"
            :autocomplete="isRegister ? 'new-password' : 'current-password'"
            :placeholder="isRegister ? `至少 ${MIN_PASSWORD_LEN} 个字符` : '请输入密码'"
          />
        </label>

        <template v-if="isRegister">
          <label class="field">
            <span class="field-label">确认密码</span>
            <input
              v-model="confirmPassword"
              class="control"
              type="password"
              name="confirm-password"
              autocomplete="new-password"
              placeholder="再输入一次"
            />
          </label>

          <label class="field">
            <span class="field-label">
              显示名称
              <span class="optional">选填</span>
            </span>
            <input
              v-model="displayName"
              class="control"
              type="text"
              name="display-name"
              autocomplete="nickname"
              placeholder="界面上显示的名字"
            />
          </label>
        </template>

        <!-- aria-live：错误是异步出现的（后端返回），读屏需要被主动播报 -->
        <p v-if="errorText" class="error" role="alert" aria-live="assertive">
          <AppIcon name="alertTriangle" :size="15" />
          <span>{{ errorText }}</span>
        </p>

        <button class="submit" type="submit" :disabled="auth.busy">
          <AppIcon v-if="auth.busy" name="loader" :size="16" class="icon-spin" />
          <span>{{ submitText }}</span>
        </button>
      </form>

      <p class="foot">
        <template v-if="isRegister">
          注册得到的是<strong>普通用户</strong>角色，可以提问；要上传知识库文档需要管理员开通权限。
        </template>
        <template v-else>
          还没有账号？<button class="link" type="button" @click="switchMode('register')">
            注册一个
          </button>
        </template>
      </p>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: var(--space-6);
  background: var(--bg-app);
  overflow: auto;
}

.theme-btn {
  position: absolute;
  top: var(--space-4);
  right: var(--space-4);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
}

.theme-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.auth-card {
  width: 100%;
  max-width: 384px;
  padding: var(--space-6);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
}

/* ===== 品牌 ===== */
.brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
}

.brand-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--accent-soft);
  color: var(--accent-text);
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.brand-text strong {
  font-size: var(--text-lg);
  font-weight: 650;
  letter-spacing: -0.01em;
}

.brand-text small {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* ===== 模式切换 ===== */
.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  padding: 3px;
  margin-bottom: var(--space-4);
  background: var(--bg-subtle);
  border-radius: var(--radius-md);
}

.tab {
  padding: 7px 0;
  font-size: var(--text-sm);
  font-weight: 550;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  transition: background var(--duration-fast) var(--ease);
}

.tab:hover {
  color: var(--text-primary);
}

.tab.is-active {
  background: var(--bg-surface);
  color: var(--text-primary);
  box-shadow: var(--shadow-xs);
}

/* ===== 表单 ===== */
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: var(--text-xs);
  font-weight: 550;
  color: var(--text-secondary);
}

.optional {
  font-weight: 400;
  color: var(--text-muted);
}

.control {
  width: 100%;
  padding: 9px var(--space-3);
  background: var(--bg-app);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  transition: border-color var(--duration-fast) var(--ease);
}

.control::placeholder {
  color: var(--text-muted);
}

.control:focus {
  border-color: var(--accent);
  outline: none;
}

.control:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

/* ===== 提示 ===== */
.notice,
.error {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 9px var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}

.notice {
  margin-bottom: var(--space-3);
  background: var(--warning-bg);
  color: var(--warning);
}

.error {
  background: var(--danger-bg);
  color: var(--danger);
}

/* ===== 提交 ===== */
.submit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: var(--space-1);
  padding: 10px var(--space-4);
  background: var(--action-bg);
  color: var(--on-action);
  font-size: var(--text-base);
  font-weight: 600;
  border-radius: var(--radius-md);
  transition: background var(--duration-fast) var(--ease);
}

.submit:hover:not(:disabled) {
  background: var(--action-bg-hover);
}

.submit:disabled {
  opacity: 0.65;
}

/* ===== 页脚 ===== */
.foot {
  margin-top: var(--space-4);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  color: var(--text-muted);
}

.foot strong {
  color: var(--text-secondary);
  font-weight: 600;
}

.link {
  padding: 0;
  color: var(--accent-text);
  font-size: inherit;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
