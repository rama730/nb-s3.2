import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  browserSessionCookieStore,
  clearLegacySupabaseBrowserCookies,
} from "@/lib/supabase/browser-cookie-store";

class MemoryStorage {
  private readonly store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

function installBrowserGlobals() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const sessionStorage = new MemoryStorage();
  const cookieJar = new Map<string, string>();

  const document = {
    get cookie() {
      return Array.from(cookieJar.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    },
    set cookie(value: string) {
      const [rawPair, ...attributes] = value.split(";").map((part) => part.trim());
      const separatorIndex = rawPair.indexOf("=");
      const name = separatorIndex >= 0 ? rawPair.slice(0, separatorIndex) : rawPair;
      const cookieValue = separatorIndex >= 0 ? rawPair.slice(separatorIndex + 1) : "";
      const shouldDelete = attributes.some((attribute) => {
        const [attributeName, attributeValue = ""] = attribute.split("=");
        return attributeName.toLowerCase() === "max-age" && attributeValue === "0";
      });

      if (shouldDelete) {
        cookieJar.delete(name);
        return;
      }

      cookieJar.set(name, cookieValue);
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage,
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: document,
  });

  return {
    sessionStorage,
    cookieJar,
    restore() {
      if (originalWindow === undefined) {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: originalWindow,
        });
      }

      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, "document");
      } else {
        Object.defineProperty(globalThis, "document", {
          configurable: true,
          value: originalDocument,
        });
      }
    },
  };
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "document");
});

describe("browserSessionCookieStore", () => {
  it("keeps auth session entries in session storage instead of browser cookies", () => {
    const browser = installBrowserGlobals();

    try {
      browserSessionCookieStore.setAll([
        {
          name: "sb-project-auth-token",
          value: "session-token",
          options: { maxAge: 3600 },
        },
      ]);

      assert.equal(browser.sessionStorage.getItem("supabase-browser-cookie:sb-project-auth-token"), "session-token");
      assert.equal(browser.cookieJar.has("sb-project-auth-token"), false);
    } finally {
      browser.restore();
    }
  });

  it("writes the pkce verifier to a browser cookie so the server callback can read it", () => {
    const browser = installBrowserGlobals();

    try {
      browserSessionCookieStore.setAll([
        {
          name: "sb-project-auth-token-code-verifier",
          value: "verifier-value",
          options: { maxAge: 600, path: "/", sameSite: "lax" },
        },
      ]);

      assert.equal(browser.cookieJar.get("sb-project-auth-token-code-verifier"), "verifier-value");
      assert.equal(
        browser.sessionStorage.getItem("supabase-browser-cookie:sb-project-auth-token-code-verifier"),
        null,
      );
      assert.deepEqual(browserSessionCookieStore.getAll(), [
        {
          name: "sb-project-auth-token-code-verifier",
          value: "verifier-value",
        },
      ]);
    } finally {
      browser.restore();
    }
  });

  it("ignores leaked auth cookies when reconstructing the browser session store", () => {
    const browser = installBrowserGlobals();

    try {
      browser.cookieJar.set("sb-project-auth-token", "legacy-cookie-token");
      browser.cookieJar.set("sb-project-auth-token-code-verifier", "verifier-value");
      browser.sessionStorage.setItem("supabase-browser-cookie:sb-project-auth-token", "session-token");

      assert.deepEqual(browserSessionCookieStore.getAll(), [
        {
          name: "sb-project-auth-token",
          value: "session-token",
        },
        {
          name: "sb-project-auth-token-code-verifier",
          value: "verifier-value",
        },
      ]);
    } finally {
      browser.restore();
    }
  });

  it("clears legacy auth cookies without touching the pkce verifier", () => {
    const browser = installBrowserGlobals();

    try {
      browser.cookieJar.set("sb-project-auth-token", "legacy-cookie-token");
      browser.cookieJar.set("sb-project-auth-token-code-verifier", "verifier-value");

      clearLegacySupabaseBrowserCookies();

      assert.equal(browser.cookieJar.has("sb-project-auth-token"), false);
      assert.equal(browser.cookieJar.get("sb-project-auth-token-code-verifier"), "verifier-value");
    } finally {
      browser.restore();
    }
  });
});
