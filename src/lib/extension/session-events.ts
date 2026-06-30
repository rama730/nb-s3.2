export const EXTENSION_DEVICE_SESSION_EVENT_TYPES = [
  "login",
  "file_write",
  "lock_acquire",
  "logout",
  "revocation",
  "auth_code_issued",
  "auth_code_consumed",
] as const;

export type ExtensionDeviceSessionEventType = typeof EXTENSION_DEVICE_SESSION_EVENT_TYPES[number];

export const EXTENSION_DEVICE_SESSION_EVENTS = {
  login: "login",
  fileWrite: "file_write",
  lockAcquire: "lock_acquire",
  logout: "logout",
  revocation: "revocation",
  authCodeIssued: "auth_code_issued",
  authCodeConsumed: "auth_code_consumed",
} as const satisfies Record<string, ExtensionDeviceSessionEventType>;

