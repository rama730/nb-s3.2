// Hub Types - Adapted to work with existing Drizzle schema

export interface User {
    id: string;
    email?: string;
    username?: string;
    fullName?: string;
    avatarUrl?: string;
    user_metadata?: Record<string, unknown>;
}

export interface OpenRole {
    id: string;
    projectId: string;
    role: string;
    title?: string | null;
    description?: string | null;
    count: number;
    filled: number;
    skills?: string[] | null;
}

export interface ProjectProfile {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    displayName?: string;
    isMasked?: boolean;
    canOpenProfile?: boolean;
    badgeText?: string | null;
}

export interface ProjectCollaborator {
    userId: string;
    membershipRole: 'owner' | 'admin' | 'member' | 'viewer';
    user: ProjectProfile | null;
}

export interface ProjectFollower {
    userId: string;
}

export interface ProjectConnectedFriend {
    name: string;
    role: string;
}

// Main Project type - adapted to match schema + extended fields for UI
export interface Project {
    id: string;
    key?: string | null;
    title: string;
    description?: string | null;
    shortDescription?: string | null;
    slug?: string | undefined;
    status: 'draft' | 'active' | 'completed' | 'archived';
    syncStatus?: 'pending' | 'cloning' | 'indexing' | 'ready' | 'failed';
    importSource?: any | null;
    githubRepoUrl?: string | null;
    githubDefaultBranch?: string | null;
    category?: string | null;
    coverImage?: string | null;
    tags?: string[];
    skills?: string[];
    visibility?: string;
    publicTabVisibility?: {
        dashboard: boolean;
        readme: boolean;
        updates: boolean;
        files: boolean;
        sprints: boolean;
        tasks: boolean;
        analytics: boolean;
    };
    hasPublishedReadme?: boolean;
    readmeExcerpt?: string | null;
    readmeUpdatedAt?: string | null;
    readmeVersionNumber?: number | null;
    viewCount?: number;
    followersCount?: number;
    savesCount?: number;
    rankingReasons?: string[];
    connectedFriends?: ProjectConnectedFriend[];
    additionalConnectedFriendsCount?: number;

    // Relations
    ownerId?: string;
    owner?: ProjectProfile | null;
    collaborators?: ProjectCollaborator[];
    openRoles?: OpenRole[];
    followers?: ProjectFollower[];

    // Timestamps
    createdAt?: string;
    updatedAt?: string | null;
}

// Filter types
export interface HubFilters {
    status: string;
    type: string;
    tech: string[];
    sort: string;
    search?: string;
    includedIds?: string[];
    hideOpened?: boolean;
}
