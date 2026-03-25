import assert from "node:assert/strict";
import test from "node:test";
import { createVisibilityAwareInterval } from "@/lib/utils/visibility";

test("visibility-aware interval supports manual stop/start without unwanted visibility restarts", () => {
  const originalDocument = globalThis.document;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;

  let hidden = false;
  let visibilityListener: ((event: Event) => void) | null = null;
  let nextTimerId = 1;
  const activeTimerIds = new Set<number>();
  let callbackCalls = 0;

  const dispatchVisibilityChange = () => {
    const listener = visibilityListener;
    if (listener) {
      listener(new Event("visibilitychange"));
    }
  };

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      get hidden() {
        return hidden;
      },
      addEventListener(type: string, listener: (event: Event) => void) {
        if (type === "visibilitychange") {
          visibilityListener = listener;
        }
      },
      removeEventListener(type: string, listener: (event: Event) => void) {
        if (type === "visibilitychange" && visibilityListener === listener) {
          visibilityListener = null;
        }
      },
    },
  });

  Object.defineProperty(globalThis, "setInterval", {
    configurable: true,
    value: ((() => {
      const id = nextTimerId;
      nextTimerId += 1;
      activeTimerIds.add(id);
      return id;
    }) as unknown) as typeof setInterval,
  });

  Object.defineProperty(globalThis, "clearInterval", {
    configurable: true,
    value: (((timerId: number) => {
      activeTimerIds.delete(timerId);
    }) as unknown) as typeof clearInterval,
  });

  try {
    const controller = createVisibilityAwareInterval(() => {
      callbackCalls += 1;
    }, 30_000);

    assert.equal(activeTimerIds.size, 1);

    controller.stop();
    assert.equal(activeTimerIds.size, 0);

    hidden = true;
    dispatchVisibilityChange();
    hidden = false;
    dispatchVisibilityChange();

    assert.equal(callbackCalls, 0);
    assert.equal(activeTimerIds.size, 0);

    controller.start();
    assert.equal(activeTimerIds.size, 1);

    hidden = true;
    dispatchVisibilityChange();
    assert.equal(activeTimerIds.size, 0);

    hidden = false;
    dispatchVisibilityChange();
    assert.equal(callbackCalls, 1);
    assert.equal(activeTimerIds.size, 1);

    controller();
    assert.equal(activeTimerIds.size, 0);
  } finally {
    if (originalDocument === undefined) {
      Reflect.deleteProperty(globalThis, "document");
    } else {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }

    Object.defineProperty(globalThis, "setInterval", {
      configurable: true,
      value: originalSetInterval,
    });
    Object.defineProperty(globalThis, "clearInterval", {
      configurable: true,
      value: originalClearInterval,
    });
  }
});
