import test from "node:test";
import assert from "node:assert/strict";

import { buildDiscoverMatchBadges, resolveRelationshipActionModel } from "@/components/people/person-card-model";

test("buildDiscoverMatchBadges returns only backed badges in stable priority order", () => {
  const badges = buildDiscoverMatchBadges({
    profileSkills: ["React", "Next.js"],
    viewerSkills: ["TypeScript", "React"],
    profileLocation: "Andhra Pradesh, India",
    viewerLocation: "Andhra Pradesh, India",
    openTo: ["cofounder"],
    mutualConnections: 3,
  });

  assert.deepEqual(
    badges.map((badge) => badge.label),
    ["Similar stack", "Same location", "Open to collaboration", "Mutual connection"],
  );
});

test("resolveRelationshipActionModel hides message when privacy does not allow it", () => {
  const model = resolveRelationshipActionModel({
    state: "pending_received",
    canSendMessage: false,
    profileHref: "/u/example",
    messageHref: "/messages?userId=example",
    inviteHref: null,
  });

  assert.equal(model.canAccept, true);
  assert.equal(model.canSendMessage, false);
  assert.deepEqual(
    model.secondaryMenu.map((action) => action.key),
    ["view_profile"],
  );
});

test("resolveRelationshipActionModel builds connected menu with invite and disconnect", () => {
  const model = resolveRelationshipActionModel({
    state: "connected",
    canSendMessage: true,
    profileHref: "/u/example",
    messageHref: "/messages?userId=example",
    inviteHref: "/u/example#profile-collaboration",
  });

  assert.equal(model.isConnected, true);
  assert.deepEqual(
    model.connectedMenu.map((action) => action.key),
    ["message", "view_profile", "invite_to_project", "disconnect"],
  );
});

test("resolveRelationshipActionModel does not expose connect semantics for blocked state", () => {
  const model = resolveRelationshipActionModel({
    state: "blocked",
    canSendMessage: false,
    profileHref: "/u/example",
    messageHref: "/messages?userId=example",
    inviteHref: null,
  });

  assert.equal(model.canConnect, false);
  assert.equal(model.canAccept, false);
  assert.equal(model.isConnected, false);
  assert.deepEqual(
    model.secondaryMenu.map((action) => action.key),
    ["view_profile"],
  );
});
