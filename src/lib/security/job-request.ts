import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

type SignedJobRequestPayload = {
  kind: string;
  actorId: string;
  subjectId: string;
  nonce: string;
  issuedAt: number;
  exp: number;
};

let devJobRequestSecret: string | null = null;

function resolveJobRequestSecret() {
  const configuredSecret = process.env.JOB_REQUEST_SECRET?.trim();
  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Missing JOB_REQUEST_SECRET");
  }

  if (!devJobRequestSecret) {
    devJobRequestSecret = `development-job-request-${randomUUID()}`;
  }
  return devJobRequestSecret;
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string) {
  return createHmac("sha256", resolveJobRequestSecret()).update(payload).digest("base64url");
}

export function createSignedJobRequestToken(input: {
  kind: string;
  actorId: string;
  subjectId: string;
  ttlSeconds?: number;
}) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const exp = issuedAt + Math.max(60, Math.min(3600, input.ttlSeconds ?? 300));
  const payload: SignedJobRequestPayload = {
    kind: input.kind,
    actorId: input.actorId,
    subjectId: input.subjectId,
    nonce: randomUUID(),
    issuedAt,
    exp,
  };

  const serializedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signPayload(serializedPayload);
  return `${serializedPayload}.${signature}`;
}

function parseSignedJobRequestToken(token: string | null | undefined): SignedJobRequestPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [serializedPayload, providedSignature] = parts;
  if (!serializedPayload || !providedSignature) return null;

  const expectedSignature = Buffer.from(signPayload(serializedPayload));
  const actualSignature = Buffer.from(providedSignature);
  if (expectedSignature.length !== actualSignature.length) return null;
  if (!timingSafeEqual(expectedSignature, actualSignature)) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(serializedPayload)) as SignedJobRequestPayload;
    if (
      !payload
      || typeof payload.kind !== "string"
      || typeof payload.actorId !== "string"
      || typeof payload.subjectId !== "string"
      || typeof payload.nonce !== "string"
      || typeof payload.issuedAt !== "number"
      || typeof payload.exp !== "number"
    ) {
      return null;
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function verifySignedJobRequestToken(
  token: string | null | undefined,
  expected: { kind: string; actorId: string; subjectId: string },
) {
  const payload = parseSignedJobRequestToken(token);
  if (!payload) return { ok: false as const };
  if (payload.kind !== expected.kind) return { ok: false as const };
  if (payload.actorId !== expected.actorId) return { ok: false as const };
  if (payload.subjectId !== expected.subjectId) return { ok: false as const };
  return { ok: true as const, payload };
}
