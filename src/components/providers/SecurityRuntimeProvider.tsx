"use client";

import { createContext, useContext, useEffect, useMemo } from "react";

import { CSRF_HEADER_NAME } from "@/lib/security/csrf-constants";

const SecurityRuntimeContext = createContext<{ nonce: string | null }>({ nonce: null });
const FETCH_PATCH_SYMBOL = Symbol.for("edge.security.fetch.patch");
const CSRF_ENDPOINT = "/api/v1/security/csrf";

// SEC-C1: the CSRF cookie is now httpOnly, so we cannot read it from
// document.cookie. Instead we fetch the token from a dedicated endpoint once
// per session and cache it in memory. Same-origin requests carry the cookie
// automatically, so the endpoint can recover the signed value server-side.
let cachedCsrfTokenPromise: Promise<string | null> | null = null;

async function fetchCsrfToken(originalFetch: typeof window.fetch): Promise<string | null> {
  try {
    const response = await originalFetch(CSRF_ENDPOINT, {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { token?: string } };
    const token = body?.data?.token;
    return typeof token === "string" && token.includes(".") ? token : null;
  } catch {
    return null;
  }
}

async function resolveCsrfToken(originalFetch: typeof window.fetch): Promise<string | null> {
  if (!cachedCsrfTokenPromise) {
    cachedCsrfTokenPromise = fetchCsrfToken(originalFetch).then((token) => {
      if (!token) {
        // Allow a retry on next mutating call if this attempt failed.
        cachedCsrfTokenPromise = null;
      }
      return token;
    });
  }
  return cachedCsrfTokenPromise;
}

function isMutatingMethod(method: string | null | undefined) {
  const normalized = (method || "GET").toUpperCase();
  return normalized === "POST" || normalized === "PUT" || normalized === "PATCH" || normalized === "DELETE";
}

function isSameOriginRequest(input: RequestInfo | URL) {
  const currentOrigin = window.location.origin;
  const rawUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input instanceof Request
        ? input.url
        : String(input);

  if (rawUrl.startsWith("/")) return true;

  try {
    return new URL(rawUrl, currentOrigin).origin === currentOrigin;
  } catch {
    return false;
  }
}

export function SecurityRuntimeProvider({
  nonce,
  children,
}: {
  nonce: string | null;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const target = window as Window & { [FETCH_PATCH_SYMBOL]?: typeof window.fetch };
    if (!target[FETCH_PATCH_SYMBOL]) {
      target[FETCH_PATCH_SYMBOL] = window.fetch.bind(window);
    }
    const originalFetch = target[FETCH_PATCH_SYMBOL]!;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (!isMutatingMethod(method) || !isSameOriginRequest(input)) {
        return originalFetch(input, init);
      }

      const csrfToken = await resolveCsrfToken(originalFetch);
      if (!csrfToken) {
        // Without a token we have to let the request go out unadorned; the
        // server will reject it with 403 and the caller can retry. Failing
        // here loudly would break genuine network outages.
        return originalFetch(input, init);
      }

      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!headers.has(CSRF_HEADER_NAME)) {
        headers.set(CSRF_HEADER_NAME, csrfToken);
      }

      if (input instanceof Request) {
        return originalFetch(new Request(input, { ...init, headers }));
      }

      return originalFetch(input, { ...init, headers });
    };

    return () => {
      window.fetch = originalFetch;
      cachedCsrfTokenPromise = null;
    };
  }, []);

  const value = useMemo(() => ({ nonce }), [nonce]);

  return (
    <SecurityRuntimeContext.Provider value={value}>
      {children}
    </SecurityRuntimeContext.Provider>
  );
}

export function useSecurityRuntime() {
  return useContext(SecurityRuntimeContext);
}
