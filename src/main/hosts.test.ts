import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostConfig } from '@shared/types'

const storeData = vi.hoisted(() => new Map<string, unknown>())

vi.mock('electron-store', () => ({
  default: class MockStore {
    constructor(options: { defaults: Record<string, unknown> }) {
      for (const [key, value] of Object.entries(options.defaults)) {
        if (!storeData.has(key)) storeData.set(key, structuredClone(value))
      }
    }

    get(key: string) {
      return structuredClone(storeData.get(key))
    }

    set(key: string, value: unknown) {
      storeData.set(key, structuredClone(value))
    }
  }
}))

import { deleteGroup, listGroups, renameGroup, reorderGroups } from './hosts'

function host(id: string, group?: string): HostConfig {
  return {
    id,
    label: id,
    host: '192.0.2.1',
    port: 22,
    username: 'root',
    ...(group ? { group } : {}),
    auth: { type: 'password', password: 'secret' }
  }
}

describe('主机分组持久化', () => {
  beforeEach(() => {
    storeData.set('hosts', [])
    storeData.set('groups', [])
  })

  it('从旧主机记录迁移独立分组并保留空分组', () => {
    storeData.set('groups', [{ name: '空分组', order: 0 }])
    storeData.set('hosts', [host('one', '生产'), host('two', '生产')])

    expect(listGroups()).toEqual([
      { name: '空分组', order: 0 },
      { name: '生产', order: 1 }
    ])
  })

  it('重命名分组时同步更新关联主机', () => {
    storeData.set('groups', [{ name: '生产', order: 0 }])
    storeData.set('hosts', [host('one', '生产'), host('two')])

    expect(renameGroup('生产', '线上')).toEqual({ name: '线上', order: 0 })
    expect(storeData.get('hosts')).toEqual([host('one', '线上'), host('two')])
  })

  it('删除分组时保留主机并移入未分组', () => {
    storeData.set('groups', [{ name: '临时', order: 0 }])
    storeData.set('hosts', [host('one', '临时')])

    deleteGroup('临时')

    expect(storeData.get('groups')).toEqual([])
    expect(storeData.get('hosts')).toEqual([host('one')])
  })

  it('按传入名称顺序持久化排序', () => {
    storeData.set('groups', [
      { name: '生产', order: 0 },
      { name: '测试', order: 1 }
    ])

    expect(reorderGroups(['测试', '生产'])).toEqual([
      { name: '测试', order: 0 },
      { name: '生产', order: 1 }
    ])
  })
})
