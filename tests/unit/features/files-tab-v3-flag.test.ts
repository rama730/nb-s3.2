import assert from "node:assert/strict";
import test from "node:test";

import {
    hardeningFeatureFlags,
    hardeningRolloutPercents,
    isInRolloutCohort,
    resolveFlagWithRollout,
} from "@/lib/features/hardening";
import { isFilesTabV3Enabled } from "@/lib/features/files";

const ENV_KEY = "NEXT_PUBLIC_FILES_TAB_V3";

function setEnv(value: string | undefined) {
    if (value === undefined) {
        delete process.env[ENV_KEY];
    } else {
        process.env[ENV_KEY] = value;
    }
}

function withEnv<T>(value: string | undefined, fn: () => T): T {
    const original = process.env[ENV_KEY];
    setEnv(value);
    try {
        return fn();
    } finally {
        if (original === undefined) {
            delete process.env[ENV_KEY];
        } else {
            process.env[ENV_KEY] = original;
        }
    }
}

test("isFilesTabV3Enabled defaults off when no env override is present", () => {
    withEnv(undefined, () => {
        // The underlying hardening flag is asEnabledOff — unset env means off.
        assert.equal(hardeningFeatureFlags.hardeningFilesV3, false);
        // Default-off for any userId shape.
        assert.equal(isFilesTabV3Enabled(), false);
        assert.equal(isFilesTabV3Enabled(null), false);
        assert.equal(isFilesTabV3Enabled(undefined), false);
        assert.equal(isFilesTabV3Enabled("user-default-off"), false);
    });
});

test("isFilesTabV3Enabled honors NEXT_PUBLIC_FILES_TAB_V3 env override (on)", () => {
    for (const onValue of ["1", "true"] as const) {
        withEnv(onValue, () => {
            // Env override turns the flag on; default rollout percent is 100.
            assert.equal(
                isFilesTabV3Enabled("user-env-override"),
                true,
                `expected true for env value ${onValue}`,
            );
            // Still true even without a seed when rollout is at 100%.
            assert.equal(isFilesTabV3Enabled(), true);
            assert.equal(isFilesTabV3Enabled(null), true);
        });
    }
});

test("isFilesTabV3Enabled treats NEXT_PUBLIC_FILES_TAB_V3 override off values as disabled", () => {
    for (const offValue of ["0", "false", "", "anything-else"] as const) {
        withEnv(offValue, () => {
            assert.equal(
                isFilesTabV3Enabled("user-env-off"),
                false,
                `expected false for env value "${offValue}"`,
            );
        });
    }
});

test("isFilesTabV3Enabled userId-hash gating aligns with the shared rollout resolver", () => {
    // Whatever the currently resolved base state is (env-respecting), the
    // function must agree with resolveFlagWithRollout using the same inputs.
    const seeds = ["user-A", "user-B", "user-C", "seed-with-ünicode"];
    for (const envValue of [undefined, "1", "0"] as const) {
        withEnv(envValue, () => {
            // Reconstruct the "enabled" base bit the same way the SUT does.
            const explicit = process.env[ENV_KEY];
            const enabledBase =
                explicit !== undefined
                    ? explicit === "1" || explicit === "true"
                    : hardeningFeatureFlags.hardeningFilesV3;

            for (const seed of seeds) {
                const expected = resolveFlagWithRollout(
                    enabledBase,
                    hardeningRolloutPercents.filesV3,
                    seed,
                );
                assert.equal(
                    isFilesTabV3Enabled(seed),
                    expected,
                    `mismatch for env=${String(envValue)} seed=${seed}`,
                );
            }
        });
    }
});

test("isFilesTabV3Enabled is deterministic for the same userId across calls", () => {
    withEnv("1", () => {
        const seed = "user-deterministic";
        const first = isFilesTabV3Enabled(seed);
        const second = isFilesTabV3Enabled(seed);
        const third = isFilesTabV3Enabled(seed);
        assert.equal(first, second);
        assert.equal(second, third);
    });
});

test("isFilesTabV3Enabled returns false for missing seed when hashed cohort gating would be required", () => {
    // Demonstrate the seed-required branch of resolveFlagWithRollout: when the
    // base flag is on, rollout is partial (<100), and no seed is provided, the
    // resolver returns false. Sanity-check this here with a synthetic call to
    // resolveFlagWithRollout so the test locks the gating contract the SUT
    // relies on, regardless of the runtime rollout percent.
    assert.equal(resolveFlagWithRollout(true, 25, null), false);
    assert.equal(resolveFlagWithRollout(true, 25, undefined), false);
    // And a matching seed-provided call must be deterministic.
    assert.equal(
        resolveFlagWithRollout(true, 25, "user-partial"),
        resolveFlagWithRollout(true, 25, "user-partial"),
    );
});

test("isFilesTabV3Enabled hash gating produces different cohorts at partial rollout", () => {
    // Use the underlying hash directly to prove the gating is a function of
    // userId — different seeds can land in different cohorts.
    const percent = 25;
    const results = new Set<boolean>();
    for (const seed of ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"]) {
        results.add(isInRolloutCohort(seed, percent));
    }
    // Over 8 seeds at 25% we expect both outcomes to appear.
    assert.equal(results.size, 2, "expected both in- and out-of-cohort seeds at 25% rollout");
});
