import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateImpactReview } from "../../scripts/check-impact-review";

function write(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

describe("check-impact-review script", () => {
  it("passes in strict mode when a high-risk path is covered by a record", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "impact-review-pass-"));
    write(
      path.join(tmp, "standards/impact-reviews/example.json"),
      JSON.stringify(
        {
          id: "impact-1",
          title: "Realtime change",
          summary: "Covers realtime path changes",
          riskLevel: "high",
          runtimePlanes: ["realtime"],
          routeClasses: ["active_surface"],
          dataSourcesChanged: ["presence"],
          canonicalLogicDomains: [],
          concurrencyRisk: "Moderate",
          observability: {
            metrics: ["presence reconnect count"],
            logs: ["presence failures"],
            alerts: [],
          },
          rollback: {
            strategy: "Revert the reconnect change",
            validation: ["npm run test:unit"],
          },
          evidence: {
            commands: ["npm run test:unit"],
            reports: [],
          },
          paths: ["src/lib/realtime"],
        },
        null,
        2,
      ),
    );

    const result = validateImpactReview(tmp, {
      strict: true,
      changedPaths: ["src/lib/realtime/presence-client.ts"],
    });

    assert.equal(result.errors.length, 0, `Expected no violations, got: ${result.errors.join("\n")}`);
  });

  it("fails in strict mode when a high-risk path has no covering record", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "impact-review-fail-"));

    const result = validateImpactReview(tmp, {
      strict: true,
      changedPaths: ["src/app/api/v1/projects/route.ts"],
    });

    assert.ok(result.errors.length > 0, "Expected violations but none were reported");
    assert.ok(result.errors.some((line) => line.includes("high-risk path is missing")));
  });
});
