import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSprintHealthSummary,
  buildSprintPermissionSet,
  isSprintReadyToClose,
  type SprintListItem,
} from "@/lib/projects/sprint-detail";

describe("sprint permissions and summary", () => {
  it("keeps every Sprint mutation aligned with the owner-or-admin policy", () => {
    const member = buildSprintPermissionSet({
      canRead: true,
      canWrite: true,
      isOwner: false,
      isMember: true,
      memberRole: "member",
    });
    const owner = buildSprintPermissionSet({
      canRead: true,
      canWrite: true,
      isOwner: true,
      isMember: false,
      memberRole: "owner",
    });
    const admin = buildSprintPermissionSet({
      canRead: true,
      canWrite: true,
      isOwner: false,
      isMember: true,
      memberRole: "admin",
    });

    assert.equal(member.canRead, true);
    assert.equal(member.canWrite, false);
    assert.equal(member.canCreate, false);
    assert.equal(member.canStart, false);
    assert.equal(member.canComplete, false);
    assert.equal(owner.canWrite, true);
    assert.equal(owner.canCreate, true);
    assert.equal(owner.canStart, true);
    assert.equal(owner.canComplete, true);
    assert.equal(admin.canWrite, true);
    assert.equal(admin.canCreate, true);
    assert.equal(admin.canComplete, true);
  });

  it("builds the compact health summary from canonical membership counts", () => {
    const summary = buildSprintHealthSummary({
      totalTasks: 5,
      completedTasks: 2,
      blockedTasks: 1,
      linkedFileCount: 3,
      totalStoryPoints: 13,
      completedStoryPoints: 5,
    });

    assert.equal(summary.completionPercentage, 40);
    assert.equal(summary.totalTasks, 5);
    assert.equal(summary.linkedFileCount, 3);
  });

  it("only exposes close-out once an active sprint reaches its scheduled end", () => {
    const sprint = {
      status: "active",
      endDate: "2026-08-10T00:00:00.000Z",
    } as SprintListItem;
    const beforeEnd = new Date("2026-08-09T23:59:59.999Z");
    const atEnd = new Date("2026-08-10T00:00:00.000Z");

    assert.equal(isSprintReadyToClose(sprint, beforeEnd), false);
    assert.equal(isSprintReadyToClose(sprint, atEnd), true);
    assert.equal(
      isSprintReadyToClose({ ...sprint, status: "planning" }, atEnd),
      false,
    );
  });
});
