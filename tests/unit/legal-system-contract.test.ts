import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { CURRENT_LEGAL_ACCEPTANCE, LEGAL_VERSIONS } from "@/lib/legal/versions";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("all public legal routes exist and use a versioned document surface", () => {
  const pages = [
    "privacy", "terms", "eula", "acceptable-use", "cookies", "subprocessors",
    "copyright", "grievances", "security-reporting", "dpa", "open-source",
  ];
  for (const page of pages) {
    const source = read(`src/app/${page}/page.tsx`);
    assert.match(source, /LegalDocumentPage/);
    assert.match(source, /LEGAL_VERSIONS/);
  }
});

test("public legal documents are discoverable and security reports have a standard contact", () => {
  const sitemap = read("src/app/sitemap.ts");
  const robots = read("src/app/robots.ts");
  const security = read("src/app/.well-known/security.txt/route.ts");

  for (const path of ["/privacy", "/terms", "/eula", "/security-reporting"]) {
    assert.match(sitemap, new RegExp(path.replace("/", "\\/")));
    assert.match(robots, new RegExp(path.replace("/", "\\/")));
  }
  assert.match(robots, /sitemap\.xml/);
  assert.match(security, /Contact: mailto:/);
  assert.match(security, /Expires:/);
  assert.match(security, /Canonical:/);
  assert.match(security, /Policy:/);
});

test("signup requires affirmative age, terms, EULA, and privacy acknowledgement", () => {
  const signup = read("src/app/(auth)/signup/page.tsx");
  const route = read("src/app/api/v1/auth/signup/route.ts");
  assert.match(signup, /I am at least 18/);
  assert.match(signup, /Terms of Service/);
  assert.match(signup, /EULA/);
  assert.match(signup, /Privacy Policy/);
  assert.match(route, /legalAccepted: z\.literal\(true\)/);
  assert.match(route, /recordCurrentLegalAcceptance/);
});

test("existing signed-in accounts must accept the current unexpired versions", () => {
  const layout = read("src/app/(main)/layout.tsx");
  const requestBoundary = read(existsSync(resolve(root, "proxy.ts")) ? "proxy.ts" : "middleware.ts");
  const acceptance = read("src/lib/legal/acceptance.ts");
  const page = read("src/app/legal/accept/page.tsx");

  assert.match(layout, /hasCurrentLegalAcceptance\(user\.id\)/);
  assert.match(layout, /redirect\(`\/legal\/accept\?next=/);
  assert.match(requestBoundary, /x-networkbase-request-target/);
  assert.match(acceptance, /gt\(legalAcceptances\.retentionExpiresAt, new Date\(\)\)/);
  assert.match(page, /"material_update"/);
});

test("current acceptance binds matching Terms, EULA, and privacy notice versions", () => {
  assert.equal(CURRENT_LEGAL_ACCEPTANCE.termsVersion, LEGAL_VERSIONS.terms);
  assert.equal(CURRENT_LEGAL_ACCEPTANCE.eulaVersion, LEGAL_VERSIONS.eula);
  assert.equal(CURRENT_LEGAL_ACCEPTANCE.privacyNoticeVersion, LEGAL_VERSIONS.privacy);
});

test("grievance contact falls back to the monitored privacy mailbox", () => {
  const config = read("src/lib/legal/config.ts");
  assert.match(config, /const privacyEmail = value\("LEGAL_PRIVACY_EMAIL"/);
  assert.match(config, /grievanceEmail: value\("LEGAL_GRIEVANCE_EMAIL", privacyEmail\)/);
  const readiness = read("scripts/check-legal-readiness.ts");
  const requiredContacts = readiness.match(/const REQUIRED_CONTACTS = \[[\s\S]*?\] as const;/)?.[0] ?? "";
  assert.doesNotMatch(requiredContacts, /LEGAL_GRIEVANCE_EMAIL/);
  assert.match(readiness, /const OPTIONAL_CONTACTS = \["LEGAL_GRIEVANCE_EMAIL"\] as const/);
});

test("settings and project detail expose contextual legal controls", () => {
  assert.match(read("src/components/settings/PrivacySettings.tsx"), /LegalAndDataRightsSection/);
  const layout = read("src/components/projects/dashboard/ProjectLayout.tsx");
  assert.doesNotMatch(layout, /id: "privacy", label: "Privacy & terms"/);
  const settings = read("src/components/projects/tabs/ProjectSettingsTab.tsx");
  assert.match(settings, /"privacy-terms": ShieldCheck/);
  assert.ok(settings.indexOf('activeSection === "privacy-terms"') > settings.indexOf('activeSection === "security-audit"'));
  assert.match(settings, /ProjectPrivacyTermsTab/);
  const policies = read("src/lib/projects/settings-policies.ts");
  assert.ok(policies.indexOf('"privacy-terms"') > policies.indexOf('"security-audit"'));
});

test("retention jobs expire legal evidence and anonymize deletion records", () => {
  const retention = read("src/inngest/functions/data-lifecycle-retention.ts");
  assert.match(retention, /expired_legal_acceptances/);
  assert.match(retention, /anonymized_account_deletion_records/);
  const migration = read("drizzle/0162_legal_acceptances.sql");
  assert.match(migration, /legal_retention_until/);
  assert.match(migration, /150 days/);
});

test("legal evidence uses keyed pseudonymous hashes rather than raw network metadata", () => {
  const acceptance = read("src/lib/legal/acceptance.ts");
  assert.match(acceptance, /createHmac\("sha256"/);
  assert.match(acceptance, /AUDIT_METADATA_HASH_SECRET must be configured in production/);
  assert.doesNotMatch(acceptance, /createHash\("sha256"/);
  assert.doesNotMatch(acceptance, /networkbase-development-legal-evidence/);
  assert.doesNotMatch(acceptance, /ipAddress:/);
  assert.doesNotMatch(acceptance, /userAgent:/);
});

test("legal database deployment is scoped to migration 0162", () => {
  const deployment = read("scripts/deploy-legal-acceptance.mjs");
  assert.match(deployment, /const tag = "0162_legal_acceptances"/);
  assert.match(deployment, /VERIFIED_ROLLBACK/);
  assert.match(deployment, /relrowsecurity/);
  assert.match(deployment, /historical migration entries were not changed/);
  assert.doesNotMatch(deployment, /setup-database/);
});
