import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeAndValidateMimeType,
  validateUploadedFileMagicBytes,
} from "@/lib/upload/security";

describe("upload security", () => {
  it("rejects SVG uploads", () => {
    assert.throws(() => normalizeAndValidateMimeType("image/svg+xml"), /Blocked MIME type/);
  });

  it("rejects files whose contents do not match the declared MIME type", async () => {
    const fakePng = new File([Uint8Array.from([0x25, 0x50, 0x44, 0x46])], "report.png", {
      type: "image/png",
    });

    await assert.rejects(
      () => validateUploadedFileMagicBytes(fakePng, "image/png"),
      /File contents do not match the declared MIME type/,
    );
  });

  it("accepts files with matching PNG signatures", async () => {
    const png = new File(
      [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])],
      "image.png",
      { type: "image/png" },
    );

    await assert.doesNotReject(() => validateUploadedFileMagicBytes(png, "image/png"));
  });
});
