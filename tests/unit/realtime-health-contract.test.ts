import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

describe("realtime health contract", () => {
  it("derives a debounced transport state from realtime and browser connectivity", () => {
    const provider = read("src/components/providers/RealtimeProvider.tsx");

    assert.match(provider, /useOnlineStatus/);
    assert.match(provider, /export type RealtimeHealthState/);
    assert.match(provider, /setTimeout\(\(\) => \{/);
    assert.match(provider, /3_000/);
    assert.match(provider, /setConnectionHealth\('offline'\)/);
    assert.match(provider, /retryRealtime/);
    assert.match(provider, /wasOnlineRef/);
  });

  it("keeps request attention separate from transport health in the header", () => {
    const nav = read("src/components/layout/header/NavLink.tsx");
    const topNav = read("src/components/layout/header/TopNav.tsx");
    const indicator = read("src/components/layout/header/ConnectionStatusIndicator.tsx");

    assert.match(nav, /connectionHealth/);
    assert.match(topNav, /ConnectionStatusIndicator/);
    assert.match(topNav, /item\.href === ROUTES\.PEOPLE \? connectionHealth : undefined/);
    assert.match(topNav, /connectionHealth=\{connectionHealth\}/);
    assert.match(indicator, /Live updates are unavailable/);
    assert.match(indicator, /You are offline/);
  });
});
