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
    created_at?: string;
    is_current?: boolean;
    aal?: 'aal1' | 'aal2' | null;
}

export interface MfaFactor {
    id: string;
    type: 'totp' | 'phone';
    friendly_name?: string;
    created_at?: string;
    status: 'verified' | 'unverified';
}

export interface LoginHistoryEntry {
    id: string;
    ip_address: string;
    user_agent: string;
    created_at: string;
    location?: string;
    aal?: 'aal1' | 'aal2' | null;
}

export interface SecurityPasswordState {
    hasPassword: boolean;
    lastChangedAt?: string;
}

export interface RecoveryCodesState {
    configured: boolean;
    remainingCount: number;
    generatedAt?: string;
}

export interface SecurityActivityEntry {
    id: string;
    eventType:
        | 'authenticator_app_enabled'
        | 'authenticator_app_removed'
        | 'recovery_codes_generated'
        | 'recovery_codes_regenerated'
        | 'recovery_code_used'
        | 'recovery_code_redemption_failed'
        | 'password_set'
        | 'password_changed'
        | 'other_sessions_revoked';
    createdAt: string;
    networkFingerprint?: string;
    deviceFingerprint?: string;
    metadata: Record<string, unknown>;
}

export interface SecurityData {
    mfaFactors: MfaFactor[];
    sessions: Session[];
    loginHistory: LoginHistoryEntry[];
    password: SecurityPasswordState;
    recoveryCodes: RecoveryCodesState;
    securityActivity: SecurityActivityEntry[];
    assurance: {
        currentLevel: 'aal1' | 'aal2' | null;
        nextLevel: 'aal1' | 'aal2' | null;
    };
}

export interface PrivacyBlockedAccount {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    headline: string | null;
    blockedAt: string | null;
}

export interface PrivacySettingsState {
    profileVisibility: 'public' | 'connections' | 'private';
    messagePrivacy: 'everyone' | 'connections';
    connectionPrivacy: 'everyone' | 'mutuals_only' | 'nobody';
    blockedCount: number;
}

export interface PrivacyOverview {
    profileVisibility: PrivacySettingsState['profileVisibility'];
    messagePrivacy: PrivacySettingsState['messagePrivacy'];
    connectionPrivacy: PrivacySettingsState['connectionPrivacy'];
    blockedCount: number;
    summary: string;
}

export interface PrivacyActivityEntry {
    id: string;
    eventType:
        | 'profile_visibility_changed'
        | 'message_privacy_changed'
        | 'connection_privacy_changed'
        | 'account_blocked'
        | 'account_unblocked';
    createdAt: string;
    label: string;
    summary: string;
}

export interface PrivacyPreviewState {
    profileVisibility: string;
    interactionPermissions: string;
    visitorProfileHref?: string | null;
}

export interface PrivacyData {
    settings: PrivacySettingsState;
    blockedAccounts: PrivacyBlockedAccount[];
    overview: PrivacyOverview;
    privacyActivity: PrivacyActivityEntry[];
    previews: PrivacyPreviewState;
}

export type IntegrationsAuthProvider = 'google' | 'github' | 'email';
export type IntegrationsAuthProviderState = 'primary' | 'linked' | 'not_linked';
export type ExternalServiceStatus = 'connected' | 'available' | 'not_connected';

export interface AuthConnectionMethod {
    provider: IntegrationsAuthProvider;
    label: string;
    state: IntegrationsAuthProviderState;
    detail: string;
    secondaryDetail?: string | null;
    lastUsedAt?: string | null;
    verificationState?: 'verified' | 'not_verified' | null;
}

export interface ServiceIntegrationConnection {
    id: 'github';
    label: string;
    status: ExternalServiceStatus;
    summary: string;
    detail: string;
    usageCount: number;
    lastUsedAt?: string | null;
}

export interface IntegrationsData {
    createdWith: IntegrationsAuthProvider | null;
    createdWithLabel: string;
    emailAddress?: string | null;
    emailVerified: boolean;
    linkedCount: number;
    additionalLinkedCount: number;
    summary: string;
    recommendedNextStep: string;
    infoNote: string;
    capabilities: {
        canEnableEmailSignIn: boolean;
        canLinkAdditionalProvider: boolean;
        canUnlinkGoogle: boolean;
        canUnlinkGithub: boolean;
    };
    authConnections: AuthConnectionMethod[];
    externalServices: ServiceIntegrationConnection[];
}

export interface SecurityStepUpCapabilitiesData {
    availableMethods: Array<'totp' | 'recovery_code' | 'password'>;
    primaryTotpFactorId?: string;
}
