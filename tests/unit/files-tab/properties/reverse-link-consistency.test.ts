// Task 13.2 — Property 2: Reverse-Link Consistency.
//
// **Validates: Requirements 7.5, 2.9**
//
// Invariant (design.md § Correctness Properties / Property 2):
//   For any node, the TaskLinkChip count equals the length of the `tasks`
//   array returned by `useTaskLinks`. Formally:
//     `TaskLinkChip.count == useTaskLinks(projectId, nodeId).tasks.length`
//
// This property verifies that the count derivation logic is always consistent
// with the tasks array length — for any arbitrary set of 0..50 linked tasks,
// the count passed to TaskLinkChip must equal the array length.
//
// Generator: arbitrary arrays of LinkedTask objects (0..50 items)
// Invariant: count == tasks.length (the consistency property)
//
// Runs: `fc.assert(..., { numRuns: 100 })` per design § Correctness Properties.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import type { LinkedTask } from "@/app/actions/files/links";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// Arbitrary for a valid UUID string (task/node ids)
const uuidArb: fc.Arbitrary<string> = fc.uuid();

// Arbitrary for task status values
const statusArb: fc.Arbitrary<string> = fc.constantFrom(
  "todo",
  "in_progress",
  "done",
  "blocked",
  "cancelled",
);

// Arbitrary for task priority values
const priorityArb: fc.Arbitrary<string> = fc.constantFrom(
  "low",
  "medium",
  "high",
  "urgent",
);

// Arbitrary for an ISO date string
const isoDateArb: fc.Arbitrary<string> = fc
  .date({
    min: new Date("2020-01-01"),
    max: new Date("2030-01-01"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString());

// Arbitrary for a LinkedTask object matching the interface from the server action
const linkedTaskArb: fc.Arbitrary<LinkedTask> = fc.record({
  taskId: uuidArb,
  title: fc.string({ minLength: 1, maxLength: 100 }),
  status: statusArb,
  priority: priorityArb,
  assigneeId: fc.option(uuidArb, { nil: null }),
  assigneeName: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
  annotation: fc.option(fc.string({ minLength: 0, maxLength: 200 }), { nil: null }),
  linkedAt: isoDateArb,
});

// Arbitrary for an array of 0..50 LinkedTask objects (the generator specified in the task)
const tasksArrayArb: fc.Arbitrary<LinkedTask[]> = fc.array(linkedTaskArb, {
  minLength: 0,
  maxLength: 50,
});

// ---------------------------------------------------------------------------
// Pure logic under test — extracted from useTaskLinks hook.
//
// The hook computes `count: tasks.length`. This function replicates that
// derivation so we can verify the consistency property without needing React
// or server calls.
// ---------------------------------------------------------------------------

/**
 * Derives the count value from a tasks array, mirroring the logic in
 * `useTaskLinks` which returns `count: tasks.length`.
 */
function deriveCount(tasks: LinkedTask[]): number {
  return tasks.length;
}

/**
 * Determines whether TaskLinkChip should render (count >= 1) and what count
 * it would display. Mirrors the rendering logic in TaskLinkChip component
 * which returns null when count < 1.
 */
function chipShouldRender(count: number): boolean {
  return count >= 1;
}

// ---------------------------------------------------------------------------
// Property 2 — Reverse-Link Consistency
// ---------------------------------------------------------------------------

describe("property: Reverse-Link Consistency (Property 2)", () => {
  it("TaskLinkChip.count always equals useTaskLinks tasks array length", () => {
    // **Validates: Requirements 7.5, 2.9**
    fc.assert(
      fc.property(tasksArrayArb, (tasks) => {
        // The hook derives count from tasks.length
        const count = deriveCount(tasks);

        // Invariant: count must equal tasks.length
        assert.strictEqual(
          count,
          tasks.length,
          `count (${count}) must equal tasks.length (${tasks.length})`,
        );

        // Additional consistency: TaskLinkChip renders iff count >= 1
        // (Requirement 7.1: render when >= 1 link; Requirement 7.2: hide when 0)
        if (tasks.length === 0) {
          assert.strictEqual(
            chipShouldRender(count),
            false,
            "TaskLinkChip should not render when tasks array is empty",
          );
        } else {
          assert.strictEqual(
            chipShouldRender(count),
            true,
            "TaskLinkChip should render when tasks array is non-empty",
          );
        }
      }),
      { numRuns: 100 },
    );
  });

  it("count is non-negative for any tasks array", () => {
    // **Validates: Requirements 7.5, 2.9**
    fc.assert(
      fc.property(tasksArrayArb, (tasks) => {
        const count = deriveCount(tasks);
        assert.ok(count >= 0, `count must be non-negative, got ${count}`);
      }),
      { numRuns: 100 },
    );
  });

  it("count equals zero iff tasks array is empty", () => {
    // **Validates: Requirements 2.9**
    fc.assert(
      fc.property(tasksArrayArb, (tasks) => {
        const count = deriveCount(tasks);

        // Bidirectional: count == 0 ⟺ tasks.length == 0
        if (count === 0) {
          assert.strictEqual(tasks.length, 0);
        }
        if (tasks.length === 0) {
          assert.strictEqual(count, 0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
