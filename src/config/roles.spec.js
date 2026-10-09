import { describe, expect, it } from 'vitest'
import { DEFAULT_ROLE_ID, ROLE_IDS, ROLES, getRole, resolveActiveRole } from './roles.js'

describe('角色预设', () => {
  it('id 唯一', () => {
    expect(new Set(ROLE_IDS).size).toBe(ROLES.length)
  })

  it('默认角色必须在列表里，否则首屏欢迎语取不到', () => {
    expect(ROLE_IDS).toContain(DEFAULT_ROLE_ID)
  })

  it('默认角色必须排在第一位，且是**可用**的', () => {
    // 第一位 = 侧边栏第一个入口；available = 点下去真的能进。
    // 两者缺一个，首屏就会变成一个"看着选中了、其实点不动"的角色
    expect(ROLE_IDS[0]).toBe(DEFAULT_ROLE_ID)
    expect(getRole(DEFAULT_ROLE_ID).available).toBe(true)
  })

  it('每个角色都显式声明 available', () => {
    // 漏写一个字段就等于"悄悄多放开一个还没有后端能力的角色"，必须显式写
    for (const role of ROLES) {
      expect(typeof role.available, `${role.id}.available 必须是布尔值`).toBe('boolean')
    }
  })

  it('当前只有文档问答可用：其余两个是占位入口', () => {
    const available = ROLES.filter((role) => role.available).map((role) => role.id)
    expect(available).toEqual(['docs'])
    expect(getRole('general').available).toBe(false)
    expect(getRole('service').available).toBe(false)
  })

  it('每个角色的展示字段都齐全且非空', () => {
    // 未开放的角色也要写全：将来把 available 打开时不用回头补文案
    for (const role of ROLES) {
      expect(role.id, '角色缺 id').toBeTruthy()
      for (const field of ['name', 'icon', 'tagline', 'welcome', 'placeholder']) {
        expect(typeof role[field], `${role.id}.${field} 必须是字符串`).toBe('string')
        expect(role[field].trim(), `${role.id}.${field} 不能为空`).not.toBe('')
      }
      expect(Array.isArray(role.suggestions), `${role.id}.suggestions 必须是数组`).toBe(true)
      expect(role.suggestions.length).toBeGreaterThanOrEqual(3)
      for (const question of role.suggestions) {
        expect(String(question).trim(), `${role.id} 有空白问句`).not.toBe('')
      }
    }
  })

  it('同一角色内的引导问题不重复', () => {
    for (const role of ROLES) {
      expect(new Set(role.suggestions).size, `${role.id} 有重复问句`).toBe(role.suggestions.length)
    }
  })

  it('通用角色不引用知识库里的产品事实', () => {
    // 客服角色的那 4 条是逐条核对过知识库出处的；通用角色复用它们
    // 会让"通用"这个定位名不副实，也容易问出后端答不了的东西
    const general = getRole('general')
    const service = getRole('service')
    for (const question of general.suggestions) {
      expect(service.suggestions, `通用角色不该复用客服问句：${question}`).not.toContain(question)
    }
  })

  it('未知 id 回落到默认角色，而不是 undefined', () => {
    expect(getRole('does-not-exist')).toBe(getRole(DEFAULT_ROLE_ID))
    expect(getRole(null)).toBe(getRole(DEFAULT_ROLE_ID))
    expect(getRole(undefined)).toBe(getRole(DEFAULT_ROLE_ID))
    expect(getRole('')).toBe(getRole(DEFAULT_ROLE_ID))
  })

  it('getRole 能取回指定的角色', () => {
    expect(getRole('service').name).toBe('客服小优')
    expect(getRole('docs').id).toBe('docs')
  })
})

describe('resolveActiveRole', () => {
  it('可用的 id 原样返回', () => {
    expect(resolveActiveRole('docs')).toBe(getRole('docs'))
  })

  it('未开放的角色回落到默认角色', () => {
    // localStorage 里可能存着上一版选的"客服小优"：直接采用会让界面停在
    // 一个点一下就提示"未开放"的角色上
    expect(resolveActiveRole('service')).toBe(getRole(DEFAULT_ROLE_ID))
    expect(resolveActiveRole('general')).toBe(getRole(DEFAULT_ROLE_ID))
  })

  it('脏值回落到默认角色', () => {
    expect(resolveActiveRole('被删掉的角色')).toBe(getRole(DEFAULT_ROLE_ID))
    expect(resolveActiveRole(null)).toBe(getRole(DEFAULT_ROLE_ID))
    expect(resolveActiveRole(undefined)).toBe(getRole(DEFAULT_ROLE_ID))
  })

  it('任何输入的结果都是可用角色', () => {
    for (const id of [...ROLE_IDS, '脏值', null, undefined, '']) {
      expect(resolveActiveRole(id).available, `${String(id)} 回落到了未开放角色`).toBe(true)
    }
  })
})
