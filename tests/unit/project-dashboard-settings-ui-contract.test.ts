import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getJourneyStageWindow, JOURNEY_VISIBLE_STAGE_COUNT } from "../../src/components/projects/dashboard/JourneyTimeline";

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
