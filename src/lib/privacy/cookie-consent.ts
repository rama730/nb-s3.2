import { LEGAL_VERSIONS } from "@/lib/legal/versions";

export const COOKIE_CONSENT_STORAGE_KEY = "networkbase.cookie-consent";
export const COOKIE_CONSENT_COOKIE_NAME = "nb_cookie_consent";
export const COOKIE_CONSENT_CHANGED_EVENT = "networkbase:cookie-consent-changed";
export const OPEN_COOKIE_SETTINGS_EVENT = "networkbase:open-cookie-settings";

const COOKIE_CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type CookieConsentDecision = {
  version: typeof LEGAL_VERSIONS.cookies;
  essential: true;
  analytics: boolean;
  decidedAt: string;
};

export function createCookieConsentDecision(analytics: boolean): CookieConsentDecision {
  return {
    version: LEGAL_VERSIONS.cookies,
    essential: true,
    analytics,
    decidedAt: new Date().toISOString(),
  };
}

export function parseCookieConsentDecision(value: string | null): CookieConsentDecision | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<CookieConsentDecision>;
    if (
      parsed.version !== LEGAL_VERSIONS.cookies
      || parsed.essential !== true
      || typeof parsed.analytics !== "boolean"
      || typeof parsed.decidedAt !== "string"
      || Number.isNaN(Date.parse(parsed.decidedAt))
    ) {
      return null;
    }

    return parsed as CookieConsentDecision;
  } catch {
    return null;
  }
}

export function readCookieConsentDecision(): CookieConsentDecision | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = parseCookieConsentDecision(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY));
    if (stored) return stored;
  } catch {
    // Fall through to the first-party cookie when browser storage is unavailable.
  }

  const cookiePrefix = `${COOKIE_CONSENT_COOKIE_NAME}=`;
  const cookieValue = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(cookiePrefix))
    ?.slice(cookiePrefix.length);

  if (!cookieValue) return null;
  try {
    return parseCookieConsentDecision(decodeURIComponent(cookieValue));
  } catch {
    return null;
  }
}

export function writeCookieConsentDecision(decision: CookieConsentDecision) {
  if (typeof window === "undefined") return;

  const serialized = JSON.stringify(decision);
  try {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, serialized);
  } catch {
    // The first-party cookie below remains the durable fallback when storage is unavailable.
  }

  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  try {
    document.cookie = `${COOKIE_CONSENT_COOKIE_NAME}=${encodeURIComponent(serialized)}; Max-Age=${COOKIE_CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
  } catch {
    // Consent still applies to the current tab through the change event.
  }
  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_CHANGED_EVENT, { detail: decision }));
}

export function openCookieSettings() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS_EVENT));
}
