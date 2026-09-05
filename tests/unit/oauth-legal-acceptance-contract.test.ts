import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("new OAuth accounts accept legal terms before onboarding", () => {
  const callback = readFileSync(resolve(process.cwd(), "src/app/auth/callback/route.ts"), "utf8");
  assert.match(callback, /requestedUrl\.pathname === '\/legal\/accept'/);
  assert.match(callback, /requestedUrl\.searchParams\.get\('context'\) === 'oauth_signup'/);
  assert.match(callback, /legalUrl\.searchParams\.set\('next', `\$\{onboardingUrl\.pathname\}/);
  assert.ok(callback.indexOf("if (isLegalAcceptance)") < callback.indexOf("destinationPath = `${onboardingUrl.pathname}"));
});
