import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("Google and GitHub OAuth return through versioned legal acceptance", () => {
  const callback = readFileSync(resolve(process.cwd(), "src/app/auth/callback/route.ts"), "utf8");
  const login = readFileSync(resolve(process.cwd(), "src/app/(auth)/login/page.tsx"), "utf8");
  const signup = readFileSync(resolve(process.cwd(), "src/app/(auth)/signup/page.tsx"), "utf8");

  assert.match(login, /signInWithGoogle\(legalNext\)/);
  assert.match(login, /signInWithGitHub\(legalNext\)/);
  assert.match(signup, /signInWithGoogle\(legalNext\)/);
  assert.match(signup, /signInWithGitHub\(legalNext\)/);
  assert.match(callback, /requestedUrl\.pathname === '\/legal\/accept'/);
  assert.match(callback, /requestedUrl\.searchParams\.get\('context'\) === 'oauth_signup'/);
  assert.match(callback, /getLegalAcceptanceState\(data\.user\.id\)/);
  assert.match(callback, /isLegalAcceptance && !hasCurrentAcceptance/);
  assert.match(callback, /isLegalAcceptance && hasCurrentAcceptance/);
  assert.match(callback, /legalUrl\.searchParams\.set\('next', `\$\{onboardingUrl\.pathname\}/);
  assert.ok(callback.indexOf("if (isLegalAcceptance && !hasCurrentAcceptance)") < callback.indexOf("destinationPath = `${onboardingUrl.pathname}"));
});

test("cookie consent is available on authentication routes and gates optional analytics", () => {
  const layout = readFileSync(resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
  const runtime = readFileSync(resolve(process.cwd(), "src/components/privacy/CookieConsentRuntime.tsx"), "utf8");
  const legalLinks = readFileSync(resolve(process.cwd(), "src/components/legal/LegalLinks.tsx"), "utf8");

  assert.match(layout, /CookieConsentRuntime analyticsAvailable=/);
  assert.match(runtime, /new Set\(\["\/login", "\/signup"\]\)/);
  assert.match(runtime, /decision\?\.analytics \? <Analytics \/>/);
  assert.match(runtime, /Reject optional/);
  assert.match(runtime, /Accept all/);
  assert.match(runtime, /Customize cookie settings/);
  assert.match(legalLinks, /CookieSettingsButton/);
});

test("Google One Tap uses a nonce, bridges the Supabase session, and preserves legal enforcement", () => {
  const oneTap = readFileSync(resolve(process.cwd(), "src/components/auth/GoogleOneTap.tsx"), "utf8");
  const authProvider = readFileSync(resolve(process.cwd(), "src/components/providers/AuthProvider.tsx"), "utf8");
  const mainLayout = readFileSync(resolve(process.cwd(), "src/app/(main)/layout.tsx"), "utf8");

  assert.match(oneTap, /createGoogleOneTapNonce\(\)/);
  assert.match(oneTap, /use_fedcm_for_prompt: true/);
  assert.match(oneTap, /auto_select: false/);
  assert.match(oneTap, /signInWithGoogleIdToken\(credential, raw\)/);
  assert.match(oneTap, /window\.location\.assign\(normalizedNextPath\)/);
  assert.match(authProvider, /supabase\.auth\.signInWithIdToken/);
  assert.match(authProvider, /syncBrowserSessionToServer\(result\.data\.session\)/);
  assert.match(mainLayout, /hasCurrentLegalAcceptance\(user\.id\)/);
});
