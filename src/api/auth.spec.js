import { describe, expect, it } from 'vitest'

import { MIN_PASSWORD_LEN, MIN_USERNAME_LEN, roleLabel, validateCredentials } from './auth.js'

/**
 * 本地预检与后端 `auth/security.py::password_problems` 的规则必须一致。
 *
 * 这里的断言不是"重新实现一遍规则"，而是钉住**两边不能漂移**：
 * 后端注册/建号会对密码做长度、首尾空白、重复字符三项检查（AUTH_MIN_PASSWORD_LEN 默认 8）。
 * 前端不提前拦，用户就会填完整张表单、等一个来回，再收到一句 422。
 */

describe('validateCredentials', () => {
  it('登录模式只要求两项非空（密码强度是注册才管的事）', () => {
    expect(validateCredentials({ username: '', password: 'x', mode: 'login' })).toBe('请输入用户名')
    expect(validateCredentials({ username: 'a', password: '', mode: 'login' })).toBe('请输入密码')
    // 登录时密码可以是 1 个字符 —— 老账号的密码未必符合现在的注册策略
    expect(validateCredentials({ username: 'a', password: 'x', mode: 'login' })).toBe(null)
  })

  it('注册模式要求用户名至少 3 个字符（后端 RegisterRequest 的 min_length=3）', () => {
    expect(MIN_USERNAME_LEN).toBe(3)
    expect(
      validateCredentials({ username: 'ab', password: 'Passw0rdLong', mode: 'register' }),
    ).toBe('用户名至少 3 个字符')
  })

  it('注册模式要求密码达到最小长度', () => {
    expect(MIN_PASSWORD_LEN).toBe(8)
    expect(validateCredentials({ username: 'abcd', password: 'short12', mode: 'register' })).toBe(
      `密码至少 ${MIN_PASSWORD_LEN} 个字符`,
    )
  })

  it('注册模式拒绝首尾空白（后端会判"首尾不要留空白字符"）', () => {
    expect(
      validateCredentials({ username: 'abcd', password: ' passw0rd ', mode: 'register' }),
    ).toBe('密码首尾不要留空格')
  })

  it('注册模式拒绝只有 1~2 种字符的弱口令（后端 len(set(pwd)) <= 2）', () => {
    expect(validateCredentials({ username: 'abcd', password: 'aaaaaaaa', mode: 'register' })).toBe(
      '密码不要用重复字符组成',
    )
  })

  it('注册模式校验两次输入是否一致', () => {
    expect(
      validateCredentials({
        username: 'abcd',
        password: 'Passw0rdLong',
        confirmPassword: 'Passw0rdLonger',
        mode: 'register',
      }),
    ).toBe('两次输入的密码不一致')
  })

  it('通过时返回 null（不是空串、不是 false）', () => {
    expect(
      validateCredentials({
        username: 'probe_user',
        password: 'ProbePassw0rd123',
        confirmPassword: 'ProbePassw0rd123',
        mode: 'register',
      }),
    ).toBe(null)
  })
})

describe('roleLabel', () => {
  it('四种后端角色都有中文名', () => {
    expect(roleLabel('admin')).toBe('管理员')
    expect(roleLabel('kb_admin')).toBe('知识库管理员')
    expect(roleLabel('operator')).toBe('坐席')
    expect(roleLabel('user')).toBe('普通用户')
  })

  it('认不出来的角色不显示空白', () => {
    expect(roleLabel('')).toBe('未知角色')
    expect(roleLabel(undefined)).toBe('未知角色')
  })
})
