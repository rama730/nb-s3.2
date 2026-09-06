import assert from "node:assert/strict";
import test from "node:test";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";
import {
  createCookieConsentDecision,
  parseCookieConsentDecision,
} from "@/lib/privacy/cookie-consent";

test("cookie consent choices are versioned and preserve the analytics choice", () => {
  const rejected = createCookieConsentDecision(false);
  const accepted = createCookieConsentDecision(true);

  assert.equal(rejected.version, LEGAL_VERSIONS.cookies);
  assert.equal(rejected.essential, true);
  assert.equal(rejected.analytics, false);
  assert.equal(parseCookieConsentDecision(JSON.stringify(accepted))?.analytics, true);
});

test("invalid or outdated cookie consent is ignored", () => {
  assert.equal(parseCookieConsentDecision(null), null);
  assert.equal(parseCookieConsentDecision("not-json"), null);
  assert.equal(parseCookieConsentDecision(JSON.stringify({
    version: "2025-01-01",
    essential: true,
    analytics: true,
    decidedAt: new Date().toISOString(),
  })), null);
  assert.equal(parseCookieConsentDecision(JSON.stringify({
    version: LEGAL_VERSIONS.cookies,
    essential: false,
    analytics: true,
    decidedAt: new Date().toISOString(),
  })), null);
});
