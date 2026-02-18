import test from "node:test";
import assert from "node:assert/strict";
import {
  APPLICATION_BANNER_HIDE_AFTER_MS,
  shouldHideTerminalApplicationBanner,
} from "@/lib/chat/banner-lifecycle";

const BASE_TIME_MS = new Date("2026-02-17T12:00:00.000Z").getTime();

test("terminal banner hides when a later non-application message exists", () => {
  const messages = [
    {
      createdAt: new Date(BASE_TIME_MS).toISOString(),
      metadata: {
        isApplication: true,
        applicationId: "app-1",
        decisionAt: new Date(BASE_TIME_MS).toISOString(),
      },
    },
    {
      createdAt: new Date(BASE_TIME_MS + 30_000).toISOString(),
      metadata: {},
    },
  ];

  const hidden = shouldHideTerminalApplicationBanner({
    status: "accepted",
    applicationId: "app-1",
    messages,
    nowMs: BASE_TIME_MS + 60_000,
  });

  assert.equal(hidden, true);
});

test("terminal banner hides after timeout when no follow-up message exists", () => {
  const messages = [
    {
      createdAt: new Date(BASE_TIME_MS).toISOString(),
      metadata: {
        isApplication: true,
        applicationId: "app-1",
        decisionAt: new Date(BASE_TIME_MS).toISOString(),
      },
    },
  ];

  const hidden = shouldHideTerminalApplicationBanner({
    status: "rejected",
    applicationId: "app-1",
    messages,
    nowMs: BASE_TIME_MS + APPLICATION_BANNER_HIDE_AFTER_MS + 1,
  });

  assert.equal(hidden, true);
});

test("terminal banner stays visible when only system application update follows", () => {
  const messages = [
    {
      createdAt: new Date(BASE_TIME_MS).toISOString(),
      metadata: {
        isApplication: true,
        applicationId: "app-1",
        decisionAt: new Date(BASE_TIME_MS).toISOString(),
      },
    },
    {
      createdAt: new Date(BASE_TIME_MS + 1_000).toISOString(),
      metadata: {
        isApplicationUpdate: true,
        applicationId: "app-1",
        kind: "application_update",
      },
    },
  ];

  const hidden = shouldHideTerminalApplicationBanner({
    status: "accepted",
    applicationId: "app-1",
    messages,
    nowMs: BASE_TIME_MS + 2_000,
  });

  assert.equal(hidden, false);
});

test("pending banner does not auto-hide", () => {
  const messages = [
    {
      createdAt: new Date(BASE_TIME_MS).toISOString(),
      metadata: {
        isApplication: true,
        applicationId: "app-1",
      },
    },
    {
      createdAt: new Date(BASE_TIME_MS + APPLICATION_BANNER_HIDE_AFTER_MS + 60_000).toISOString(),
      metadata: {},
    },
  ];

  const hidden = shouldHideTerminalApplicationBanner({
    status: "pending",
    applicationId: "app-1",
    messages,
    nowMs: BASE_TIME_MS + APPLICATION_BANNER_HIDE_AFTER_MS + 120_000,
  });

  assert.equal(hidden, false);
});
