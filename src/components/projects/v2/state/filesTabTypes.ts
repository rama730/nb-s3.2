import type { ProjectNode } from '@/lib/db/schema'

export type PaneId = 'left' | 'right'

export type FilesWorkspaceTabState = {
  id: string
  node: ProjectNode
  content: string
  contentVersion: number
  savedSnapshot: string
  savedSnapshotVersion: number
  isDirty: boolean
  isLoading: boolean
  isSaving: boolean
  isDeleting: boolean
  hasLock: boolean
  lockInfo?: { lockedBy: string; lockedByName?: string | null; expiresAt: number } | null
  offlineQueued: boolean
  error?: string | null
  lastSavedAt?: number
  assetUrl?: string | null
  assetUrlExpiresAt?: number | null
}
