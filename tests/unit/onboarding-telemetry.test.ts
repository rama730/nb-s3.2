import assert from "node:assert/strict";
import test from "node:test";

import { ONBOARDING_TELEMETRY_BATCH_LIMIT, sanitizeOnboardingTelemetryBatch } from "../../src/lib/onboarding/events";

test("onboarding telemetry accepts valid events and caps a boundary batch", () => {
  const events = Array.from({ length: ONBOARDING_TELEMETRY_BATCH_LIMIT + 5 }, (_, index) => ({
    eventType: "step_view",
    step: (index % 4) + 1,
    metadata: { index },
  }));
  const sanitized = sanitizeOnboardingTelemetryBatch([...events, { eventType: "not-real" }]);
  assert.equal(sanitized.length, ONBOARDING_TELEMETRY_BATCH_LIMIT);
  assert.deepEqual(sanitizeOnboardingTelemetryBatch({}), []);
});
