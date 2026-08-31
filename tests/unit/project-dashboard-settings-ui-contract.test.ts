import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getJourneyStageWindow, getStageCompletionTooltip, JOURNEY_VISIBLE_STAGE_COUNT } from "../../src/components/projects/dashboard/JourneyTimeline";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("project dashboard keeps journey connectors, statements, and skills stable", () => {
  const journey = source("src/components/projects/dashboard/JourneyTimeline.tsx");
  const overview = source("src/components/projects/dashboard/ProjectOverviewCard.tsx");

  assert.match(journey, /left-0 right-1\/2/);
  assert.match(journey, /left-1\/2 right-0/);
  assert.match(journey, /scrollContainerRef/);
  assert.match(journey, /app-scroll-x app-scroll-hidden/);
  assert.match(journey, /data-stage-index="\$\{stageWindow\.start\}"/);
  assert.match(journey, /stages\.map/);
  assert.match(journey, /index <= safeCurrentStageIndex/);
  assert.match(journey, /index < safeCurrentStageIndex/);
  assert.doesNotMatch(journey, /progress \/ 100/);
  assert.doesNotMatch(journey, /projectUpdatedAt/);
  assert.doesNotMatch(journey, /Completed before/);

  assert.match(overview, /min-h-44/);
  assert.match(overview, /line-clamp-6/);
  assert.match(overview, /Click to read full text/);
  assert.match(overview, /<Dialog open=\{Boolean\(statement\)\}/);
  assert.match(overview, /normalizeProjectSkills/);
  assert.match(overview, /project\?\.skills/);
  assert.match(overview, /project\?\.technologies_used/);
  assert.match(overview, /project\?\.techStack/);
  assert.match(overview, /Skills & Tech/);
});

test("project journey windows around the current stage", () => {
  assert.equal(JOURNEY_VISIBLE_STAGE_COUNT, 5);
  assert.deepEqual(getJourneyStageWindow(7, 5), { start: 2, end: 7, currentStageIndex: 5 });
  assert.deepEqual(getJourneyStageWindow(7, 0), { start: 0, end: 5, currentStageIndex: 0 });
  assert.deepEqual(getJourneyStageWindow(7, 99), { start: 2, end: 7, currentStageIndex: 6 });
});

test("completed journey stages always have an honest hover label", () => {
  assert.equal(
    getStageCompletionTooltip("2026-08-25T00:00:00.000Z"),
    "Finished on Aug 25, 2026",
  );
  assert.equal(
    getStageCompletionTooltip(undefined),
    "Finished — date not recorded",
  );
  assert.equal(getStageCompletionTooltip("not-a-date"), "Finished — date not recorded");
});

test("journey stage transitions record all crossed stages and lifecycle edits remap dates", () => {
  const actions = source("src/app/actions/project/_all.ts");

  assert.match(actions, /currentStageIndex: projects\.currentStageIndex/);
  assert.match(actions, /stageCompletionDates: projects\.stageCompletionDates/);
  assert.match(actions, /stageCompletionDates: normalizeJourneyCompletionDates\(/);
  assert.match(actions, /buildJourneyCompletionDates/);
  assert.match(actions, /normalizeJourneyCompletionDates/);
  assert.match(actions, /completionDatesByStage/);
  assert.match(actions, /stageCompletionDates: remappedCompletionDates/);
  assert.match(actions, /Project lifecycle stage is out of range/);
  assert.match(actions, /updateValues\.stageCompletionDates = buildJourneyCompletionDates/);
});

test("project links resolve and persist exact destination names", () => {
  const editor = source("src/components/projects/dashboard/ProjectSocialLinksCard.tsx");
  const previewRoute = source("src/app/api/v1/link-preview/route.ts");
  const normalization = source("src/lib/profile/normalization.ts");

  assert.match(editor, /useLinkPreview\(metadataUrl\)/);
  assert.match(editor, /destinationLabel: effectiveDestinationLabel/);
  assert.match(editor, /Identifying destination/);
  assert.match(previewRoute, /youtube\.com\/oembed/);
  assert.match(previewRoute, /normalizeLinkDestinationTitle/);
  assert.match(normalization, /accountLabel: item\.destinationLabel/);
});

test("integrations settings shows extension app identity before sessions", () => {
  const integrations = source("src/components/settings/IntegrationsSettings.tsx");

  assert.match(integrations, /function ExtensionAppCard/);
  assert.match(integrations, /\/icon-192\.png/);
  assert.match(integrations, /Edge editor extension/);
  assert.match(integrations, /\/ide-icons\/vscode\.png/);
  assert.match(integrations, /\/ide-icons\/cursor\.png/);
  assert.match(integrations, /\/ide-icons\/windsurf\.svg/);
  assert.match(integrations, /\/ide-icons\/antigravity\.png/);
  assert.match(integrations, /Revocable sessions/);
  assert.match(integrations, /Web login or manual token/);
  assert.match(integrations, /session\.clientVersion/);
  assert.match(integrations, /session\.editorVersion/);
});
