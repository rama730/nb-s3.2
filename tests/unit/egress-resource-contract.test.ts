import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("stable project media routes use version or ETag caching", () => {
  for (const path of [
    "src/app/api/v1/projects/[id]/image/route.ts",
    "src/app/api/v1/projects/[id]/doc-assets/[assetId]/route.ts",
    "src/app/api/v1/projects/[id]/update-media/route.ts",
  ]) {
    const source = read(path);
    assert.match(source, /if-none-match/);
    assert.match(source, /ETag/);
  }
  assert.match(read("src/app/api/v1/projects/[id]/image/route.ts"), /private, max-age=/);
  assert.match(read("src/app/api/v1/projects/[id]/doc-assets/[assetId]/route.ts"), /private, max-age=720/);
  assert.match(read("src/app/api/v1/projects/[id]/update-media/route.ts"), /PRIVATE_REDIRECT_MAX_AGE_SECONDS = 12 \* 60/);
});

test("profile shell and pages reuse server profile reads", () => {
  assert.match(read("src/app/(main)/layout.tsx"), /initialProfile=\{profile\}/);
  assert.match(read("src/app/(main)/u/[username]/page.tsx"), /const readPublicProfileRoute = cache/);
  assert.match(read("src/app/(main)/profile/page.tsx"), /const readOwnerProfileRoute = cache/);
});

test("avatar and onboarding writes use the shared optimized lifecycle", () => {
  const editor = read("src/components/profile/edit/EditProfileTabs.tsx");
  assert.match(editor, /compressAvatarOffMainThread/);
  assert.match(editor, /cacheProfile: "immutable"/);

  const onboarding = read("src/app/(onboarding)/onboarding/page.tsx");
  assert.doesNotMatch(onboarding, /saveOnboardingDraft/);
  assert.doesNotMatch(onboarding, /trackOnboardingEvent/);
  assert.match(onboarding, /telemetry,/);
});

test("immutable message attachments carry durable cache metadata", () => {
  const messaging = read("src/app/actions/messaging/_all.ts");
  assert.match(
    messaging,
    /\.from\(ATTACHMENTS_BUCKET\)[\s\S]*?\.upload\(storagePath, file, \{[\s\S]*?cacheControl: '31536000'/,
  );
});

test("missing message media exposes a terminal unavailable state", () => {
  const attachments = read("src/components/chat/v2/message-attachments.tsx");
  assert.match(attachments, /Media unavailable/);
  assert.doesNotMatch(attachments, /Download media/);
});

test("PDF preview reuses the stable attachment route instead of cloning a full blob", () => {
  const attachments = read("src/components/chat/v2/message-attachments.tsx");
  assert.match(attachments, /src=\{sourceUrl\}/);
  assert.doesNotMatch(attachments, /const loadPdf|res\.blob\(\)|URL\.createObjectURL\(new Blob/);
});
