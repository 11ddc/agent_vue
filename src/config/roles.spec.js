import { describe, expect, it } from 'vitest'
import { DEFAULT_ROLE_ID, ROLE_IDS, ROLES, getRole } from './roles.js'

describe('角色预设', () => {
  it('id 唯一', () => {
    expect(new Set(ROLE_IDS).size).toBe(ROLES.length)
  })

  it('默认角色必须在列表里，否则首屏欢迎语取不到', () => {
    expect(ROLE_IDS).toContain(DEFAULT_ROLE_ID)
  })

  it('每个角色的展示字段都齐全且非空', () => {
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

  it('未知 id 回落到第一个角色，而不是 undefined', () => {
    expect(getRole('does-not-exist')).toBe(ROLES[0])
    expect(getRole(null)).toBe(ROLES[0])
    expect(getRole(undefined)).toBe(ROLES[0])
    expect(getRole('')).toBe(ROLES[0])
  })

  it('getRole 能取回指定的角色', () => {
    expect(getRole('service').name).toBe('客服小优')
    expect(getRole('docs').id).toBe('docs')
  })
})
