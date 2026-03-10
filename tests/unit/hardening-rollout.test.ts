import assert from "node:assert/strict";
import test from "node:test";

import {
  hardeningFeatureFlags,
  hardeningRolloutPercents,
  isHardeningDomainEnabled,
  isInRolloutCohort,
  resolveFlagWithRollout,
} from "../../src/lib/features/hardening";

test("isInRolloutCohort is deterministic for the same seed", () => {
  const seed = "user-123";
  const first = isInRolloutCohort(seed, 25);
  const second = isInRolloutCohort(seed, 25);
  assert.equal(first, second);
});

test("resolveFlagWithRollout honors disabled base flag", () => {
  assert.equal(resolveFlagWithRollout(false, 100, "user-1"), false);
  assert.equal(resolveFlagWithRollout(false, 0, "user-1"), false);
});

test("resolveFlagWithRollout honors full and zero rollout bounds", () => {
  assert.equal(resolveFlagWithRollout(true, 100, "user-1"), true);
  assert.equal(resolveFlagWithRollout(true, 0, "user-1"), false);
});

test("resolveFlagWithRollout requires seed for partial rollout", () => {
  assert.equal(resolveFlagWithRollout(true, 25, null), false);
  assert.equal(resolveFlagWithRollout(true, 25, undefined), false);
});

test("isHardeningDomainEnabled stays aligned with mapped domain config", () => {
  const seed = "user-42";
  assert.equal(
    isHardeningDomainEnabled("workspaceV1", seed),
    resolveFlagWithRollout(
      hardeningFeatureFlags.hardeningWorkspaceV1,
      hardeningRolloutPercents.workspaceV1,
      seed,
    ),
  );
  assert.equal(
    isHardeningDomainEnabled("peopleV1", seed),
    resolveFlagWithRollout(
      hardeningFeatureFlags.hardeningPeopleV1,
      hardeningRolloutPercents.peopleV1,
      seed,
    ),
  );
});
