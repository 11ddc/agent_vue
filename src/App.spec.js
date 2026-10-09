import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import HomeView from './views/HomeView.vue'
import { useAuthStore } from './stores/auth.js'

/**
 * 挂载冒烟测试。
 *
 * 为什么光有 type-check + 单元测试不够：
 * 那两样只能证明"能编译、纯函数对"，证明不了**界面真的能跑起来** ——
 * store 方法名写错、模板里取了 undefined、图标名不存在这类问题，
 * 只有真正 mount 一次才会暴露。这个项目没有浏览器端到端测试，
 * 这个文件就是那道底线。
 */

/**
 * 造一个已登录的身份。
 *
 * 外壳现在按登录态分形态（见 App.vue 的 showShell）：只有已登录才渲染侧边栏。
 * 这里直接摆好 auth store 的状态，而不是去 mock 网络 —— 本文件要测的是
 * "外壳挂载后能不能正常跑"，登录流程本身由 stores/auth.spec.js 负责。
 */
function signIn() {
  const auth = useAuthStore()
  auth.user = {
    user_id: 'u-test',
    username: 'tester',
    display_name: '测试账号',
    role: 'admin',
    tenant_id: 'default',
    customer_id: null,
  }
  auth.status = 'authenticated'
  return auth
}

async function mountApp({ authenticated = true, status } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  if (authenticated) signIn()
  else if (status) useAuthStore().status = status

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: HomeView }],
  })
  router.push('/')
  await router.isReady()

  const wrapper = mount(App, { global: { plugins: [pinia, router] } })
  return wrapper
}

function roleButtons(wrapper) {
  return wrapper.findAll('.role')
}

describe('应用外壳挂载', () => {
  let errorSpy

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    // Vue 的渲染期错误都走 console.error；挂载冒烟测试必须把它当失败
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    // 用 throw 而不是 expect：oxlint 的 vitest 插件不允许 expect 出现在 afterEach 里。
    // 效果一样——afterEach 抛出的异常同样会让当前用例失败。
    const messages = errorSpy.mock.calls.flat().join('\n')
    errorSpy.mockRestore()
    if (messages) throw new Error(`挂载期间出现 console.error：\n${messages}`)
  })

  it('默认渲染通用助手：三个角色、空状态引导问题、输入框都在', async () => {
    const wrapper = await mountApp()

    const names = roleButtons(wrapper).map((b) => b.text())
    expect(names.some((t) => t.includes('通用助手'))).toBe(true)
    expect(names.some((t) => t.includes('客服小优'))).toBe(true)
    expect(names.some((t) => t.includes('文档问答'))).toBe(true)

    // 空状态：hero 标题 = 角色名，引导问题 4 条
    expect(wrapper.find('.hero-title').text()).toBe('通用助手')
    expect(wrapper.findAll('.suggestion')).toHaveLength(4)

    // 图标是自绘 SVG，不是 emoji
    expect(wrapper.findAll('svg.icon').length).toBeGreaterThan(5)

    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)
    expect(textarea.attributes('placeholder')).toContain('问点什么')
  })

  it('点击角色切换：开场白、占位文案一起换成新角色的', async () => {
    const wrapper = await mountApp()

    const serviceButton = roleButtons(wrapper).find((b) => b.text().includes('客服小优'))
    expect(serviceButton).toBeTruthy()
    await serviceButton.trigger('click')

    expect(wrapper.find('.hero-title').text()).toBe('客服小优')
    expect(wrapper.find('.hero-welcome').text()).toContain('智能客服小优')
    expect(wrapper.find('textarea').attributes('placeholder')).toContain('描述您遇到的问题')

    // 选中态要跟着走，否则界面会同时"看起来选了通用助手"
    const active = wrapper.findAll('.role').filter((b) => b.classes().includes('is-active'))
    expect(active).toHaveLength(1)
    expect(active[0].text()).toContain('客服小优')
  })

  it('知识库是抽屉：点开出现对话框，Esc 关闭', async () => {
    const wrapper = await mountApp()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

    await wrapper.findAll('.side-item')[0].trigger('click')
    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.attributes('aria-modal')).toBe('true')

    // 上传记录为空时的空状态文案
    expect(dialog.text()).toContain('还没有上传记录')

    await dialog.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('侧边栏折叠按钮切换图标导航条状态', async () => {
    const wrapper = await mountApp()
    const aside = wrapper.find('.sidebar')
    expect(aside.classes()).not.toContain('is-collapsed')

    await wrapper.find('.rail-toggle').trigger('click')
    expect(wrapper.find('.sidebar').classes()).toContain('is-collapsed')
  })

  it('未登录/登录态未知时不套外壳（侧边栏不会露出来，点哪个都会 401）', async () => {
    // ① 还没判定完（守卫在等刷新令牌）→ 给一句恢复提示，而不是先闪一下侧边栏
    const boot = await mountApp({ authenticated: false })
    expect(boot.find('.app-boot').exists()).toBe(true)
    expect(boot.find('.sidebar').exists()).toBe(false)

    // ② 明确判定为未登录 → 同样不套外壳，路由视图留给登录页
    const anonymous = await mountApp({ authenticated: false, status: 'anonymous' })
    expect(anonymous.find('.app-boot').exists()).toBe(false)
    expect(anonymous.find('.sidebar').exists()).toBe(false)
  })

  it('已登录时侧边栏底部显示身份与登出入口', async () => {
    const wrapper = await mountApp()

    expect(wrapper.find('.side-user').text()).toContain('测试账号')
    expect(wrapper.find('.side-user').text()).toContain('管理员')
    const logout = wrapper.findAll('.side-item').find((b) => b.text().includes('退出登录'))
    expect(logout).toBeTruthy()
  })

  it('主题按钮在 跟随系统 → 浅色 → 深色 之间循环，并写到 <html> 上', async () => {
    const wrapper = await mountApp()
    const themeButton = wrapper.findAll('.side-item')[1]

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)

    await themeButton.trigger('click')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    await themeButton.trigger('click')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    await themeButton.trigger('click')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('用户消息走纯文本、助手消息走 markdown 渲染', async () => {
    const wrapper = await mountApp()
    const { useChatStore } = await import('./stores/chat.js')
    const chat = useChatStore()

    // 直接构造一轮问答，避免真的发请求
    chat.messages = [
      chat.messages[0],
      { id: 'u1', role: 'user', content: '**这是用户打的星号**', time: new Date().toISOString() },
      {
        id: 'a1',
        role: 'assistant',
        content: '- 列表项\n- **加粗**',
        time: new Date().toISOString(),
        pending: false,
        mode: 'stream',
      },
    ]
    await wrapper.vm.$nextTick()

    // 用户消息：星号原样保留，没有被当成强调
    expect(wrapper.find('.bubble-user').text()).toBe('**这是用户打的星号**')
    expect(wrapper.find('.bubble-user').find('strong').exists()).toBe(false)

    // 助手消息：渲染成真正的列表和加粗
    const answer = wrapper.find('.answer')
    expect(answer.find('ul').exists()).toBe(true)
    expect(answer.find('strong').exists()).toBe(true)

    // 技术元信息默认收在折叠详情里，不铺在正文下面
    expect(wrapper.find('.details').exists()).toBe(false)
    const toggle = wrapper.find('.details-toggle')
    expect(toggle.exists()).toBe(true)
    await toggle.trigger('click')
    expect(wrapper.find('.details').text()).toContain('流式')
  })
})
