/**
 * Types for the People/Connections feature
 */

export interface Connection {
    id: string;
    user_id: string;
    connected_user_id: string;
    status: 'pending' | 'accepted' | 'rejected' | 'blocked';
    created_at: string;
    accepted_at?: string;
    updated_at?: string;

    // Joined profile data
    profiles?: ProfileSummary;
    connected_profiles?: ProfileSummary;
    otherUser?: ProfileSummary;
}

export interface ProfileSummary {
    id: string;
    username?: string;
    full_name?: string;
    avatar_url?: string;
    bio?: string;
    location?: string;
    headline?: string;
}

export interface InboxData {
    incomingConnectionRequests: any[];
    incomingProjectInvites: any[];
    sentProjectInvites: any[];
}

export interface Facets {
    projectTags: Array<{ label: string; count: number }>;
    skills: Array<{ label: string; count: number }>;
    locations: Array<{ label: string; count: number }>;
}
