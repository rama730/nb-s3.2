import { Profile, Project } from '@/lib/db/schema'
import { User } from '@supabase/supabase-js'

export type ConnectionState = 'none' | 'pending_incoming' | 'pending_outgoing' | 'accepted' | 'rejected'

export type ProfileTabKey = 'overview' | 'portfolio'

export interface ProfileStats {
    connectionsCount: number
    projectsCount: number
    followersCount: number
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
    currentUser: User | null
    connectionStatus: ConnectionState
    projects?: any[] // Project type
}

export interface ViewerContext {
    currentUser: User | null
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
