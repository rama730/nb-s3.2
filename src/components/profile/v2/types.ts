import { Profile } from '@/lib/db/schema'
import type { ProfileCollaborationSummary } from '@/lib/profile/collaboration'
import type { PrivacyConnectionState, PrivacyVisibilityReason } from '@/lib/privacy/relationship-state'

export type ConnectionState = 'none' | 'pending_incoming' | 'pending_outgoing' | 'accepted' | 'rejected' | 'blocked'

export type ProfileTabKey = 'overview' | 'portfolio'

export interface ProfilePrivacyRelationship {
    canViewProfile: boolean
    canSendMessage: boolean
    canSendConnectionRequest: boolean
    blockedByViewer: boolean
    blockedByTarget: boolean
    visibilityReason: PrivacyVisibilityReason
    connectionState: PrivacyConnectionState
}

export interface ProfileStats {
    connectionsCount: number
    projectsCount: number
    followersCount: number
    mutualCount?: number
}

export interface ProfileViewerUser {
    id: string
}

// Defines what the Client Component expects
export interface ProfilePageData {
    profile: Profile & {
        // UI fields not in schema yet
        profileStrength?: number
        // Map database snake_case if raw query used, but Drizzle uses camelCase
    }
    stats: ProfileStats
    isOwner: boolean
    currentUser: ProfileViewerUser | null
    connectionStatus: ConnectionState
    privacyRelationship: ProfilePrivacyRelationship
    lockedShell?: boolean
    collaborationSummary?: ProfileCollaborationSummary
}

export interface ViewerContext {
    currentUser: ProfileViewerUser | null
    isAuthenticated: boolean
    isOwner: boolean
    connectionStatus: ConnectionState
    connectionPromise?: Promise<ConnectionState>
}

export interface ProfileViewModel {
    profile: Profile & {
        profileStrength?: number
    }
    stats: ProfileStats
    statsPromise?: Promise<ProfileStats>
    detailsPromise?: Promise<any>
    data?: any
    viewer: ViewerContext
}
