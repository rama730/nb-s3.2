import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProjectDetailMetadataInput,
  getProjectTitleFromSlug,
} from "@/lib/projects/project-detail-metadata";

test("getProjectTitleFromSlug normalizes slugs and hides UUIDs", () => {
  assert.equal(getProjectTitleFromSlug("network-for-builders"), "network for builders");
  assert.equal(getProjectTitleFromSlug("550e8400-e29b-41d4-a716-446655440000"), "Project");
  assert.equal(getProjectTitleFromSlug("%E0%A4%A"), "%E0%A4%A");
});

test("buildProjectDetailMetadataInput trims project title and descriptions", () => {
  assert.deepEqual(
    buildProjectDetailMetadataInput("network-for-builders", {
      slug: "network-for-builders ",
      title: "Network for builders ",
      shortDescription: "  Learn and build together.  ",
      description: "Longer description",
    }),
    {
      title: "Network for builders | Edge",
      description: "Learn and build together.",
      path: "/projects/network-for-builders",
      image: "/api/og/project/network-for-builders",
    },
  );
});
