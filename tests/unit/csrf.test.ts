import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/security/csrf-constants";
import { createSignedCsrfToken, validateCsrf, verifySignedCsrfToken } from "@/lib/security/csrf";

describe("csrf protection", () => {
    it("creates verifiable signed csrf tokens", () => {
        const token = createSignedCsrfToken();
        assert.equal(verifySignedCsrfToken(token), true);
    });

    it("accepts requests with matching signed cookie and header tokens", () => {
        const token = createSignedCsrfToken();
        const request = new Request("https://app.example.test/api/v1/security", {
            method: "POST",
            headers: {
                host: "app.example.test",
                origin: "https://app.example.test",
                cookie: `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
                [CSRF_HEADER_NAME]: token,
            },
        });

        assert.equal(validateCsrf(request), null);
    });

    it("rejects requests with missing token echo", async () => {
        const token = createSignedCsrfToken();
        const request = new Request("https://app.example.test/api/v1/security", {
            method: "POST",
            headers: {
                host: "app.example.test",
                origin: "https://app.example.test",
                cookie: `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
            },
        });

        const response = validateCsrf(request);
        assert.ok(response);
        assert.equal(response.status, 403);
        const body = await response.json();
        assert.equal(body.errorCode, "FORBIDDEN");
    });
});
