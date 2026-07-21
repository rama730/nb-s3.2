import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { isLeakedPassword } from "@/lib/security/leaked-password";

describe("leaked-password protection", () => {
  it("uses a padded k-anonymity range request and detects a leaked password", async () => {
    const password = "CorrectHorseBatteryStaple42";
    const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
    let requestedUrl = "";
    let requestedHeaders: HeadersInit | undefined;

    const leaked = await isLeakedPassword(password, async (input, init) => {
      requestedUrl = String(input);
      requestedHeaders = init?.headers;
      return new Response(`${hash.slice(5)}:42\r\n${"0".repeat(35)}:0`, { status: 200 });
    });

    assert.equal(leaked, true);
    assert.equal(requestedUrl, `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    assert.equal(new Headers(requestedHeaders).get("Add-Padding"), "true");
    assert.doesNotMatch(requestedUrl, new RegExp(password, "i"));
    assert.doesNotMatch(requestedUrl, new RegExp(hash, "i"));
  });

  it("ignores padding entries and rejects an unavailable range service", async () => {
    assert.equal(
      await isLeakedPassword("UniquePassword42", async () => new Response(`${"0".repeat(35)}:0`, { status: 200 })),
      false,
    );
    await assert.rejects(
      isLeakedPassword("UniquePassword42", async () => new Response("unavailable", { status: 503 })),
      /returned 503/,
    );
  });

  it("covers signup, password changes, and recovery resets", () => {
    const source = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
    assert.match(source("src/app/api/v1/auth/signup/route.ts"), /isLeakedPassword/);
    assert.match(source("src/app/api/v1/auth/change-password/route.ts"), /isLeakedPassword/);
    assert.match(source("src/app/(auth)/reset-password/page.tsx"), /\/api\/v1\/auth\/password-safety/);
  });
});
