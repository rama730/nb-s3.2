import type { NotificationPreferences } from "@/lib/notifications/types";

// Settings types
export type { NotificationPreferences };

export interface Session {
  id: string;
  device_info: { userAgent: string };
  ip_address: string;
  last_active: string;
  created_at?: string;
  is_current?: boolean;
  aal?: "aal1" | "aal2" | null;
}

export interface MfaFactor {
  id: string;
  type: "totp" | "phone";
  friendly_name?: string;
  created_at?: string;
  status: "verified" | "unverified";
}

export interface LoginHistoryEntry {
  id: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  location?: string;
  aal?: "aal1" | "aal2" | null;
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
    | "authenticator_app_enabled"
    | "authenticator_app_removed"
    | "recovery_codes_generated"
    | "recovery_codes_regenerated"
    | "recovery_code_used"
    | "recovery_code_redemption_failed"
    | "password_set"
    | "password_changed"
    | "other_sessions_revoked"
    | "github_account_replacement_started"
    | "github_account_replaced";
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
    currentLevel: "aal1" | "aal2" | null;
    nextLevel: "aal1" | "aal2" | null;
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
  profileVisibility: "public" | "connections" | "private";
  messagePrivacy: "everyone" | "connections";
  connectionPrivacy: "everyone" | "mutuals_only" | "nobody";
  blockedCount: number;
}

export interface PrivacyOverview {
  profileVisibility: PrivacySettingsState["profileVisibility"];
  messagePrivacy: PrivacySettingsState["messagePrivacy"];
  connectionPrivacy: PrivacySettingsState["connectionPrivacy"];
  blockedCount: number;
  summary: string;
}

export interface PrivacyActivityEntry {
  id: string;
  eventType:
    | "profile_visibility_changed"
    | "message_privacy_changed"
    | "connection_privacy_changed"
    | "account_blocked"
    | "account_unblocked";
  createdAt: string;
  label: string;
  summary: string;
}

export interface PrivacyPreviewState {
  profileVisibility: string;
  interactionPermissions: string;
}

export interface PrivacyData {
  settings: PrivacySettingsState;
  blockedAccounts: PrivacyBlockedAccount[];
  overview: PrivacyOverview;
  privacyActivity: PrivacyActivityEntry[];
  previews: PrivacyPreviewState;
}

export type IntegrationsAuthProvider = "google" | "github" | "email";
export type IntegrationsAuthProviderState = "primary" | "linked" | "not_linked";
export type ExternalServiceStatus =
  | "connected"
  | "available"
  | "action_required"
  | "not_connected";

export type ExternalAccountHealthState =
  | "available"
  | "unavailable"
  | "unknown"
  | "not_linked";

export type ExternalAccountHealthReason =
  | "verified"
  | "not_found"
  | "rate_limited"
  | "forbidden"
  | "provider_error"
  | "network_error"
  | "invalid_response"
  | "missing_username"
  | "not_linked";

export interface ExternalAccountHealth {
  state: ExternalAccountHealthState;
  reason: ExternalAccountHealthReason;
  checkedAt: string | null;
  profile?: {
    username: string;
    fullName: string | null;
    avatarUrl: string | null;
    profileUrl: string;
  } | null;
}

export interface AuthConnectionMethod {
  provider: IntegrationsAuthProvider;
  label: string;
  state: IntegrationsAuthProviderState;
  detail: string;
  secondaryDetail?: string | null;
}

export interface GithubServiceConnection {
  status: ExternalServiceStatus;
  summary: string;
  detail: string;
  usageCount: number;
  lastUsedAt?: string | null;
  githubUsername?: string | null;
  recoveryAction?: "replace_account" | "add_fallback_sign_in" | null;
}

export interface IntegrationsData {
  summary: string;
  authConnections: AuthConnectionMethod[];
  githubService: GithubServiceConnection;
}

export interface AccountDeletionStatusData {
  pending: boolean;
  deletionId?: string;
  hardDeleteAt?: string;
  scheduledAt?: string;
}

export type ExtensionSessionAuthMethod = "web_login" | "manual_token";

export interface ExtensionSessionData {
  id: string;
  tokenPrefix?: string | null;
  deviceName: string;
  clientVersion: string;
  scopes?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  editorHost?: string | null;
  editorName?: string | null;
  editorPlatform?: string | null;
  editorVersion?: string | null;
  expiresAt: string;
  lastSeenAt: string;
  createdAt: string;
  authMethod?: ExtensionSessionAuthMethod;
}

export interface ExtensionSessionsData {
  sessions: ExtensionSessionData[];
  hasMore: boolean;
  nextCursor: string | null;
}
