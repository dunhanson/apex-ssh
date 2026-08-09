import { describe, expect, it } from 'vitest'
import {
  markDeleted,
  markPulled,
  markPushed,
  planMerge,
  type ShadowState
} from './cloud-sync-merge'

const local = (recordId: string, hash = 'h1') => ({ recordId, kind: 'host' as const, hash })
const remote = (recordId: string, updatedAt: number, deleted = false) => ({
  recordId,
  kind: 'host' as const,
  updatedAt,
  deleted
})

describe('cloud-sync-merge planMerge', () => {
  it('首次启用：本地全部上传，无拉取', () => {
    const plan = planMerge([local('a'), local('b')], [], {})
    expect(plan.push.map((r) => r.recordId).sort()).toEqual(['a', 'b'])
    expect(plan.pull).toHaveLength(0)
    expect(plan.conflicts).toBe(0)
  })

  it('新设备接入：远端记录全部拉取', () => {
    const plan = planMerge([], [remote('a', 100), remote('b', 200)], {})
    expect(plan.pull.map((r) => r.recordId).sort()).toEqual(['a', 'b'])
    expect(plan.push).toHaveLength(0)
  })

  it('双方一致：无任何动作', () => {
    const shadow: ShadowState = { a: { hash: 'h1', remoteUpdatedAt: 100, remoteDeleted: false } }
    const plan = planMerge([local('a', 'h1')], [remote('a', 100)], shadow)
    expect(plan.push).toHaveLength(0)
    expect(plan.pull).toHaveLength(0)
    expect(plan.pushTombstone).toHaveLength(0)
    expect(plan.pullDelete).toHaveLength(0)
  })

  it('仅本地变更：上传', () => {
    const shadow: ShadowState = { a: { hash: 'h1', remoteUpdatedAt: 100, remoteDeleted: false } }
    const plan = planMerge([local('a', 'h2')], [remote('a', 100)], shadow)
    expect(plan.push.map((r) => r.recordId)).toEqual(['a'])
    expect(plan.pull).toHaveLength(0)
  })

  it('仅远端变更：拉取', () => {
    const shadow: ShadowState = { a: { hash: 'h1', remoteUpdatedAt: 100, remoteDeleted: false } }
    const plan = planMerge([local('a', 'h1')], [remote('a', 200)], shadow)
    expect(plan.pull.map((r) => r.recordId)).toEqual(['a'])
    expect(plan.push).toHaveLength(0)
  })

  it('本地删除：上传墓碑', () => {
    const shadow: ShadowState = { a: { hash: 'h1', remoteUpdatedAt: 100, remoteDeleted: false } }
    const plan = planMerge([], [remote('a', 100)], shadow)
    expect(plan.pushTombstone.map((r) => r.recordId)).toEqual(['a'])
    expect(plan.pull).toHaveLength(0)
  })

  it('远端删除墓碑较新：删除本地', () => {
    const shadow: ShadowState = { a: { hash: 'h1', remoteUpdatedAt: 100, remoteDeleted: false } }
    const plan = planMerge([local('a', 'h1')], [remote('a', 200, true)], shadow)
    expect(plan.pullDelete.map((r) => r.recordId)).toEqual(['a'])
    expect(plan.conflicts).toBe(0)
  })

  it('远端删除与本地变更冲突：远端胜出并计冲突', () => {
    const shadow: ShadowState = { a: { hash: 'h1', remoteUpdatedAt: 100, remoteDeleted: false } }
    const plan = planMerge([local('a', 'h2')], [remote('a', 200, true)], shadow)
    expect(plan.pullDelete.map((r) => r.recordId)).toEqual(['a'])
    expect(plan.conflicts).toBe(1)
  })

  it('双方同时变更：远端胜出并计冲突', () => {
    const shadow: ShadowState = { a: { hash: 'h1', remoteUpdatedAt: 100, remoteDeleted: false } }
    const plan = planMerge([local('a', 'h2')], [remote('a', 200)], shadow)
    expect(plan.pull.map((r) => r.recordId)).toEqual(['a'])
    expect(plan.push).toHaveLength(0)
    expect(plan.conflicts).toBe(1)
  })

  it('本地删除与远端修改冲突：远端胜出并拉取', () => {
    const shadow: ShadowState = { a: { hash: 'h1', remoteUpdatedAt: 100, remoteDeleted: false } }
    const plan = planMerge([], [remote('a', 200)], shadow)
    expect(plan.pull.map((r) => r.recordId)).toEqual(['a'])
    expect(plan.pushTombstone).toHaveLength(0)
    expect(plan.conflicts).toBe(1)
  })

  it('双方均删除：清理 shadow', () => {
    const shadow: ShadowState = { a: { hash: '', remoteUpdatedAt: 200, remoteDeleted: true } }
    const plan = planMerge([], [remote('a', 200, true)], shadow)
    expect(plan.push).toHaveLength(0)
    expect(plan.pull).toHaveLength(0)
    expect(plan.pushTombstone).toHaveLength(0)
    expect(plan.pullDelete).toHaveLength(0)
  })

  it('双方均不存在：shadow 残留被清理', () => {
    const shadow: ShadowState = { a: { hash: 'h1', remoteUpdatedAt: 100, remoteDeleted: false } }
    const plan = planMerge([], [], shadow)
    expect(plan.prune).toEqual(['a'])
  })

  it('已知墓碑之后本地重建：重新上传', () => {
    const shadow: ShadowState = { a: { hash: '', remoteUpdatedAt: 200, remoteDeleted: true } }
    const plan = planMerge([local('a', 'h3')], [remote('a', 200, true)], shadow)
    expect(plan.push.map((r) => r.recordId)).toEqual(['a'])
  })
})

describe('cloud-sync-merge shadow 更新', () => {
  it('markPushed / markPulled / markDeleted 维护 shadow 条目', () => {
    const shadow: ShadowState = {}
    markPushed(shadow, 'a', 'h1', 100, false)
    expect(shadow.a).toEqual({ hash: 'h1', remoteUpdatedAt: 100, remoteDeleted: false })
    markPulled(shadow, 'a', 'h2', 200)
    expect(shadow.a).toEqual({ hash: 'h2', remoteUpdatedAt: 200, remoteDeleted: false })
    markDeleted(shadow, 'a', 300)
    expect(shadow.a).toEqual({ hash: '', remoteUpdatedAt: 300, remoteDeleted: true })
  })
})
