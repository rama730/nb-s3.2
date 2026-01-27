// Hub Types - Adapted to work with existing Drizzle schema

export interface User {
    id: string;
    email?: string;
    username?: string;
    full_name?: string;
    avatar_url?: string;
    user_metadata?: Record<string, unknown>;
}

export interface OpenRole {
    id: string;
    project_id: string;
    role: string;
    title?: string;
    description?: string | null;
    count: number;
    filled?: number;
}

export interface ProjectProfile {
    id?: string;
    username?: string | null;
    full_name?: string | null;
    avatar_url?: string | null;
}

export interface ProjectCollaborator {
    user_id: string;
    role?: string;
    profiles?: ProjectProfile;
    count?: number;
}

export interface ProjectFollower {
    user_id: string;
}

// Main Project type - adapted to match schema + extended fields for UI
export interface Project {
    id: string;
    title: string;
    description?: string | null;
    short_description?: string | null;
    slug?: string;
    status: string; // 'draft' | 'active' | 'completed' | 'archived' -> maps to IDEA/IN_PROGRESS/LAUNCHED
    category?: string | null;
    cover_image?: string | null;
    technologies_used?: string[];
    tags?: string[];
    skills?: string[];
    visibility?: string;
    view_count?: number;

    // Relations
    creator_id?: string; // maps to owner_id
    owner_id?: string;
    profiles?: ProjectProfile; // Creator/owner profile
    project_collaborators?: ProjectCollaborator[];
    project_open_roles?: OpenRole[];
    project_followers?: ProjectFollower[];

    // Timestamps
    created_at?: string;
    updated_at?: string;
    last_activity_at?: string;
}

// Collection types
export interface Collection {
    id: string;
    name: string;
    user_id: string;
    project_ids: string[];
    created_at: string;
}

// Filter types
export interface HubFilters {
    status: string;
    type: string;
    tech: string[];
    sort: string;
    search?: string;
    includedIds?: string[];
}
