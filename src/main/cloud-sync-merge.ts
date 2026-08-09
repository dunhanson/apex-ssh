import type { SyncRecordKind } from './sync-record-crypto'

/**
 * 云同步三路合并（纯函数，便于测试）：
 * 以 shadow（上次同步后的双方一致状态）区分本地变更与远端变更，
 * 冲突时按记录“后写胜出”——远端记录较新则覆盖本地，并计入 conflicts。
 * shadow 的落盘更新由调用方在对应动作成功后执行，失败记录不影响其他记录。
 */
export interface LocalSyncEntry {
  recordId: string
  kind: SyncRecordKind
  /** 规范化业务数据的 SHA-256，用于识别本地是否相对上次同步发生变更 */
  hash: string
}

export interface RemoteSyncEntry {
  recordId: string
  kind: SyncRecordKind
  updatedAt: number
  deleted: boolean
}

export interface ShadowEntry {
  hash: string
  remoteUpdatedAt: number
  remoteDeleted: boolean
}

/** key 为 recordId */
export type ShadowState = Record<string, ShadowEntry>

export interface MergePlan {
  /** 本地新增或变更，需要加密上传的记录 */
  push: Array<{ recordId: string; kind: SyncRecordKind }>
  /** 本地已删除，需要上传删除墓碑的记录 */
  pushTombstone: Array<{ recordId: string; kind: SyncRecordKind }>
  /** 远端新增或变更，需要解密并写入本地的记录 */
  pull: Array<{ recordId: string; kind: SyncRecordKind }>
  /** 远端删除墓碑较新，需要删除本地的记录 */
  pullDelete: Array<{ recordId: string; kind: SyncRecordKind }>
  /** 双方同时变更（远端胜出）的记录数 */
  conflicts: number
  /** 本地与远端均已删除、可从 shadow 清理的记录 */
  prune: string[]
}

export function planMerge(
  local: LocalSyncEntry[],
  remote: RemoteSyncEntry[],
  shadow: ShadowState
): MergePlan {
  const plan: MergePlan = { push: [], pushTombstone: [], pull: [], pullDelete: [], conflicts: 0, prune: [] }
  const localById = new Map(local.map((entry) => [entry.recordId, entry]))
  const remoteById = new Map(remote.map((entry) => [entry.recordId, entry]))
  const recordIds = new Set<string>([
    ...localById.keys(),
    ...remoteById.keys(),
    ...Object.keys(shadow)
  ])

  for (const recordId of recordIds) {
    const localEntry = localById.get(recordId)
    const remoteEntry = remoteById.get(recordId)
    const shadowEntry = shadow[recordId]
    const kind = (localEntry ?? remoteEntry)?.kind
    if (!kind) {
      // shadow 中残留但双方都不存在的记录，直接清理
      plan.prune.push(recordId)
      continue
    }

    const localChanged = !!localEntry && (!shadowEntry || shadowEntry.hash !== localEntry.hash)
    const remoteChanged =
      !!remoteEntry &&
      (!shadowEntry ||
        shadowEntry.remoteUpdatedAt !== remoteEntry.updatedAt ||
        shadowEntry.remoteDeleted !== remoteEntry.deleted)

    if (localEntry && !remoteEntry) {
      // 远端没有记录：本地新建 / 本地重建，直接上传
      plan.push.push({ recordId, kind })
      continue
    }

    if (remoteEntry && !localEntry) {
      if (remoteEntry.deleted) continue // 远端墓碑且本地本就不存在，无需动作
      if (!shadowEntry || shadowEntry.remoteDeleted) {
        // 全新远端记录，或远端在墓碑之后重建
        plan.pull.push({ recordId, kind })
      } else if (remoteChanged) {
        // 本地删除与远端修改冲突：远端胜出
        plan.pull.push({ recordId, kind })
        plan.conflicts += 1
      } else {
        // 远端未变而本地删除：上传墓碑
        plan.pushTombstone.push({ recordId, kind })
      }
      continue
    }

    if (localEntry && remoteEntry) {
      if (remoteEntry.deleted) {
        if (remoteChanged) {
          // 远端删除较新：删除本地；本地同时有改动记为冲突
          plan.pullDelete.push({ recordId, kind })
          if (localChanged) plan.conflicts += 1
        } else if (localChanged) {
          // 已知墓碑之后本地重建：重新上传
          plan.push.push({ recordId, kind })
        }
        continue
      }
      if (localChanged && remoteChanged) {
        // 双方同时变更：远端较新者胜出（远端时间即远端写入时间）
        plan.pull.push({ recordId, kind })
        plan.conflicts += 1
      } else if (localChanged) {
        plan.push.push({ recordId, kind })
      } else if (remoteChanged) {
        plan.pull.push({ recordId, kind })
      }
    }
  }

  return plan
}

/** 推送成功后更新 shadow */
export function markPushed(
  shadow: ShadowState,
  recordId: string,
  hash: string,
  updatedAt: number,
  deleted: boolean
): void {
  shadow[recordId] = { hash, remoteUpdatedAt: updatedAt, remoteDeleted: deleted }
}

/** 拉取应用成功后更新 shadow（hash 为本地实际应用数据的规范化散列） */
export function markPulled(
  shadow: ShadowState,
  recordId: string,
  hash: string,
  updatedAt: number
): void {
  shadow[recordId] = { hash, remoteUpdatedAt: updatedAt, remoteDeleted: false }
}

/** 远端墓碑应用到本地后更新 shadow */
export function markDeleted(shadow: ShadowState, recordId: string, updatedAt: number): void {
  shadow[recordId] = { hash: '', remoteUpdatedAt: updatedAt, remoteDeleted: true }
}
