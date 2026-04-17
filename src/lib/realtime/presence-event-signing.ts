import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DEFAULT_DEV_PRESENCE_EVENT_SECRET = randomBytes(32).toString("hex");

export type SignedPresenceEventEnvelope<TPayload> = {
  payload: TPayload;
  signature: string;
};

function resolvePresenceEventSecret() {
  return process.env.PRESENCE_EVENT_SECRET?.trim() || DEFAULT_DEV_PRESENCE_EVENT_SECRET;
}

function toStableJson(value: unknown) {
  return JSON.stringify(value);
}

export function signPresenceEventEnvelope<TPayload>(payload: TPayload): SignedPresenceEventEnvelope<TPayload> {
  const serializedPayload = toStableJson(payload);
  const signature = createHmac("sha256", resolvePresenceEventSecret())
    .update(serializedPayload)
    .digest("base64url");

  return {
    payload,
    signature,
  };
}

export function verifyPresenceEventEnvelope<TPayload>(
  envelope: SignedPresenceEventEnvelope<TPayload>,
): envelope is SignedPresenceEventEnvelope<TPayload> {
  if (!envelope || typeof envelope !== "object" || typeof envelope.signature !== "string" || !("payload" in envelope)) {
    return false;
  }

  const expectedSignature = createHmac("sha256", resolvePresenceEventSecret())
    .update(toStableJson(envelope.payload))
    .digest();
  const providedSignature = Buffer.from(envelope.signature, "base64url");

  return expectedSignature.length === providedSignature.length && timingSafeEqual(expectedSignature, providedSignature);
}
