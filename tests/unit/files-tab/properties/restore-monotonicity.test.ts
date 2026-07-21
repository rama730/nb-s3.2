// Property 4 — Restore Monotonicity
//
// **Validates: Requirements 10.6**
//
// Task-Files Version Control V3 spec, Task 13.4. See design.md § Correctness
// Properties / Property 4 for the prose statement.
//
// Invariant (design.md § Property 4):
//   For any sequence of `restoreVersion` calls, the resulting `currentVersion`
//   on the node is strictly greater than the `currentVersion` before the
//   restore. Formally: `restoreVersion(v) => node.currentVersion' > node.currentVersion`.
//
// The server action `restoreFileVersion` appends through the canonical revision
// service. Allocation uses the highest retained history row, not merely the
// active pointer, and updates the node's currentVersion to that new row.
// This property verifies that the monotonicity invariant holds for arbitrary
// sequences of restore operations starting from any valid initial version.

import test from "node:test";
import fc from "fast-check";
import assert from "node:assert/strict";

import { nextFileRevisionNumber } from "../../../../src/lib/files/revision-policy";

// ---------------------------------------------------------------------------
// Model of restoreVersion logic (mirrors src/app/actions/files/versions.ts)
// ---------------------------------------------------------------------------

/**
 * Models the core version-bumping logic of `restoreFileVersion`:
 *   nextVersion = (currentVersion ?? 1) + 1
 *
 * Returns the new currentVersion after the restore.
 */
function modelRestoreVersion(currentVersion: number, highestVersion: number): number {
  return nextFileRevisionNumber(currentVersion, highestVersion);
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// Starting currentVersion: 1..100 (realistic range for file versions)
const startingVersionArb = fc.integer({ min: 1, max: 100 });

// A valid target version to restore: must be between 1 and the currentVersion
// (you can only restore a version that exists, i.e. <= currentVersion).
// We generate the target relative to the current version at each step.
const restoreSequenceLengthArb = fc.integer({ min: 1, max: 20 });

// ---------------------------------------------------------------------------
// Property assertion — design.md § Property 4
// ---------------------------------------------------------------------------

test("Property 4: Restore Monotonicity — restoreVersion(v) => node.currentVersion' > node.currentVersion", () => {
  // **Validates: Requirements 10.6**
  fc.assert(
    fc.property(
      startingVersionArb,
      restoreSequenceLengthArb,
      fc.infiniteStream(fc.integer({ min: 1, max: 100 })),
      (startVersion, seqLength, targetVersionStream) => {
        let currentVersion = startVersion;

        // Execute a sequence of restore operations
        for (let i = 0; i < seqLength; i++) {
          const previousVersion = currentVersion;

          // Pick a valid target version (clamp to [1, currentVersion] since
          // you can only restore versions that exist)
          const rawTarget = targetVersionStream.next().value;
          const targetVersion = ((rawTarget - 1) % currentVersion) + 1;

          // Apply the restore model
          const newVersion = modelRestoreVersion(currentVersion, currentVersion);

          // Assert strict monotonicity: new version > previous version
          assert.ok(
            newVersion > previousVersion,
            `Restore monotonicity violated: restoreVersion(${targetVersion}) ` +
              `produced currentVersion=${newVersion} which is not > previous=${previousVersion}`,
          );

          currentVersion = newVersion;
        }

        return true;
      },
    ),
    { numRuns: 100 },
  );
});

test("Property 4 regression: restoring from a legacy lower active pointer appends after retained history", () => {
  assert.equal(modelRestoreVersion(1, 10), 11);
});
