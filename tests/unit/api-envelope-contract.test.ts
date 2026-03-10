import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateApiEnvelopeContract } from "../../scripts/check-api-envelope-contract";

function write(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

describe("check-api-envelope-contract script", () => {
  it("passes when route uses shared envelope helpers", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "api-envelope-pass-"));
    write(
      path.join(tmp, "src/app/api/v1/foo/route.ts"),
      `
        import { jsonSuccess, jsonError } from "@/app/api/v1/_shared";
        export async function GET() {
          if (Math.random() > 2) return jsonError("bad", 400, "BAD_REQUEST");
          return jsonSuccess({ ok: true });
        }
      `,
    );

    const result = validateApiEnvelopeContract(tmp);
    assert.equal(result.errors.length, 0, `Expected no violations, got: ${result.errors.join("\n")}`);
  });

  it("fails when route uses direct NextResponse.json", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "api-envelope-fail-"));
    write(
      path.join(tmp, "src/app/api/v1/foo/route.ts"),
      `
        import { NextResponse } from "next/server";
        export async function GET() {
          return NextResponse.json({ ok: true });
        }
      `,
    );

    const result = validateApiEnvelopeContract(tmp);
    assert.ok(result.errors.length > 0, "Expected violations but none were reported");
    assert.ok(result.errors.some((line) => line.includes("direct NextResponse.json")));
    assert.ok(result.errors.some((line) => line.includes("must use jsonSuccess/jsonError")));
  });
});
