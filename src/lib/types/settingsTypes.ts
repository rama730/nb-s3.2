// Settings types
export interface NotificationPreferences {
    email: boolean;
    push: boolean;
    projects: boolean;
    messages: boolean;
    mentions: boolean;
}

export interface Session {
    id: string;
    device_info: { userAgent: string };
    ip_address: string;
    last_active: string;
    is_current?: boolean;
}

export interface MfaFactor {
    id: string;
    type: 'totp' | 'phone';
    friendly_name?: string;
    created_at: string;
    status: 'verified' | 'unverified';
}

export interface Passkey {
    id: string;
    name: string;
    created_at: string;
    last_used?: string;
}

export interface LoginHistoryEntry {
    id: string;
    ip_address: string;
    user_agent: string;
    created_at: string;
    success: boolean;
    location?: string;
}

export interface SecurityData {
    mfaFactors: MfaFactor[];
    passkeys: Passkey[];
    sessions: Session[];
    loginHistory: LoginHistoryEntry[];
}

export interface PrivacySettings {
    is_private: boolean;
    connection_privacy: 'public' | 'connections_only' | 'nobody';
}
