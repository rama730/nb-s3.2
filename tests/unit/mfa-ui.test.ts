import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    getTotpVerificationErrorMessage,
    normalizeTotpQrCodeSource,
} from "@/lib/auth/mfa-ui";

describe("mfa ui helpers", () => {
    it("normalizes supabase qr data urls into a browser-safe data url", () => {
        const value = 'data:image/svg+xml;utf-8,<?xml version=\"1.0\"?><svg></svg>';
        assert.equal(
            normalizeTotpQrCodeSource(value),
            "data:image/svg+xml;utf-8,%3C%3Fxml%20version%3D%221.0%22%3F%3E%3Csvg%3E%3C%2Fsvg%3E"
        );
    });

    it("wraps raw svg qr payloads into a data url", () => {
        const value = '<?xml version=\"1.0\"?><svg></svg>';
        const normalized = normalizeTotpQrCodeSource(value);
        assert.ok(normalized?.startsWith("data:image/svg+xml;utf-8,"));
    });

    it("maps invalid totp codes to a clearer user message", () => {
        assert.equal(
            getTotpVerificationErrorMessage({ message: "Invalid TOTP code entered" }),
            "That code did not match. Use the current 6-digit code from your authenticator app."
        );
    });
});
