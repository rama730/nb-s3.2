import test from "node:test";
import assert from "node:assert/strict";
import { validateAndSanitizeLifecycleStages } from "@/lib/validations/project";

test("validateAndSanitizeLifecycleStages allows valid characters", () => {
    const valid = [
        "Discovery",
        "MVP Build",
        "Alpha & Beta",
        "Design 2",
        "Müller Release", // Unicode letters (German umlaut)
        "Mañana",          // Unicode Spanish ñ
    ];
    const result = validateAndSanitizeLifecycleStages(valid);
    assert.deepEqual(result, [
        "Discovery",
        "MVP Build",
        "Alpha & Beta",
        "Design 2",
        "Müller Release",
        "Mañana",
    ]);
});

test("validateAndSanitizeLifecycleStages normalizes whitespace", () => {
    const spaces = [
        "  Design  ",
        "MVP   Build",
    ];
    const result = validateAndSanitizeLifecycleStages(spaces);
    assert.deepEqual(result, ["Design", "MVP Build"]);
});

test("validateAndSanitizeLifecycleStages rejects invalid characters", () => {
    // Dot
    assert.throws(() => {
        validateAndSanitizeLifecycleStages(["Design 1.0"]);
    }, /contains invalid characters/);

    // Hyphen
    assert.throws(() => {
        validateAndSanitizeLifecycleStages(["MVP-Build"]);
    }, /contains invalid characters/);

    // Question mark
    assert.throws(() => {
        validateAndSanitizeLifecycleStages(["Beta?"]);
    }, /contains invalid characters/);

    // Under score
    assert.throws(() => {
        validateAndSanitizeLifecycleStages(["Stage_1"]);
    }, /contains invalid characters/);
});

test("validateAndSanitizeLifecycleStages enforces length limits", () => {
    // Too short
    assert.throws(() => {
        validateAndSanitizeLifecycleStages(["A"]);
    }, /must be between 2 and 35 characters/);

    // Too long
    const tooLong = "A".repeat(36);
    assert.throws(() => {
        validateAndSanitizeLifecycleStages([tooLong]);
    }, /must be between 2 and 35 characters/);
});

test("validateAndSanitizeLifecycleStages rejects duplicates", () => {
    assert.throws(() => {
        validateAndSanitizeLifecycleStages(["Beta", "beta"]);
    }, /Duplicate stage name "beta" is not allowed/);
});
