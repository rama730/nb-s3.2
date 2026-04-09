import type { SerializeOptions } from "cookie";

const STORAGE_PREFIX = "supabase-browser-cookie:";
const LEGACY_AUTH_COOKIE_MARKERS = ["auth-token", "sb-access-token", "sb-refresh-token"];
const PKCE_COOKIE_SUFFIX = "-code-verifier";

const fallbackCookieStore = new Map<string, string>();
let hasClearedLegacyCookies = false;

function getStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function listStoredCookieEntries() {
  const storage = getStorage();
  if (storage) {
    const entries: Array<{ name: string; value: string }> = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      const name = key.slice(STORAGE_PREFIX.length);
      const value = storage.getItem(key);
      if (value === null) continue;
      entries.push({ name, value });
    }
    return entries;
  }

  return Array.from(fallbackCookieStore.entries()).map(([name, value]) => ({ name, value }));
}

function writeStoredCookie(name: string, value: string | null) {
  const storage = getStorage();
  const storageKey = `${STORAGE_PREFIX}${name}`;
  if (storage) {
    if (value === null) {
      storage.removeItem(storageKey);
      return;
    }
    storage.setItem(storageKey, value);
    return;
  }

  if (value === null) {
    fallbackCookieStore.delete(name);
    return;
  }
  fallbackCookieStore.set(name, value);
}

function shouldClearLegacyCookie(name: string) {
  const normalized = name.trim().toLowerCase();
  if (!normalized.includes("sb")) return false;
  if (isPkceCookie(normalized)) return false;
  return LEGACY_AUTH_COOKIE_MARKERS.some((marker) => normalized.includes(marker));
}

function isPkceCookie(name: string) {
  return name.trim().toLowerCase().endsWith(PKCE_COOKIE_SUFFIX);
}

function readBrowserCookies() {
  if (typeof document === "undefined") return [];
  return document.cookie
    .split(";")
    .map((entry) => {
      const separatorIndex = entry.indexOf("=");
      const rawName = separatorIndex >= 0 ? entry.slice(0, separatorIndex) : entry;
      const rawValue = separatorIndex >= 0 ? entry.slice(separatorIndex + 1) : "";
      return {
        name: rawName.trim(),
        value: decodeURIComponent(rawValue.trim()),
      };
    })
    .filter((entry) => entry.name.length > 0);
}

function writeBrowserCookie(
  name: string,
  value: string | null,
  options?: Partial<SerializeOptions>,
) {
  if (typeof document === "undefined") return;

  const path = options?.path ?? "/";
  const sameSite =
    options?.sameSite === "strict" || options?.sameSite === "none"
      ? options.sameSite
      : "lax";
  const shouldDelete = value === null || options?.maxAge === 0;
  const segments = [`${name}=${shouldDelete ? "" : encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];

  if (shouldDelete) {
    segments.push("Max-Age=0");
    segments.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  } else if (typeof options?.maxAge === "number") {
    segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }

  if (options?.secure) {
    segments.push("Secure");
  }

  if (options?.domain) {
    segments.push(`Domain=${options.domain}`);
  }

  document.cookie = segments.join("; ");
}

export function clearLegacySupabaseBrowserCookies() {
  if (hasClearedLegacyCookies || typeof document === "undefined") return;
  hasClearedLegacyCookies = true;

  const cookieNames = document.cookie
    .split(";")
    .map((entry) => entry.split("=")[0]?.trim() || "")
    .filter(Boolean);

  for (const name of cookieNames) {
    if (!shouldClearLegacyCookie(name)) continue;
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  }
}

export const browserSessionCookieStore = {
  getAll() {
    const storedEntries = listStoredCookieEntries();
    const entriesByName = new Map(storedEntries.map((entry) => [entry.name, entry.value]));

    for (const cookie of readBrowserCookies()) {
      if (!isPkceCookie(cookie.name)) continue;
      entriesByName.set(cookie.name, cookie.value);
    }

    return Array.from(entriesByName.entries()).map(([name, value]) => ({ name, value }));
  },
  setAll(
    cookiesToSet: Array<{
      name: string;
      value: string;
      options?: Partial<SerializeOptions>;
    }>,
  ) {
    for (const cookie of cookiesToSet) {
      const shouldDelete = !cookie.value || cookie.options?.maxAge === 0;
      if (isPkceCookie(cookie.name)) {
        writeBrowserCookie(cookie.name, shouldDelete ? null : cookie.value, cookie.options);
        continue;
      }

      writeStoredCookie(cookie.name, shouldDelete ? null : cookie.value);
    }
  },
};
