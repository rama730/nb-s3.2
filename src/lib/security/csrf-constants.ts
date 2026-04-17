export const CSRF_COOKIE_NAME = "edge-csrf-token";
export const CSRF_HEADER_NAME = "x-csrf-token";

// Shared by the edge middleware that issues the cookie AND the node runtime that
// validates it. Must be a single constant so dev/CI signing matches verification.
// Production must set CSRF_TOKEN_SECRET; see SEC-C2.
export const DEV_CSRF_SECRET_FALLBACK = "nb-dev-csrf-secret-do-not-use-in-prod";
export const MINIMUM_CSRF_SECRET_LENGTH = 32;
