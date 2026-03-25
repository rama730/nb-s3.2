import { createHmac, timingSafeEqual } from "node:crypto";

import type { PresenceRoomRole, PresenceRoomType } from "./presence-types";

type PresenceTokenHeader = {
  alg: "HS256";
  typ: "PRESENCE";
};

export type PresenceTokenClaims = {
  userId: string;
  sessionId: string | null;
  roomType: PresenceRoomType;
  roomId: string;
  role: PresenceRoomRole;
  exp: number;
  iat: number;
};

const DEFAULT_PRESENCE_TOKEN_TTL_SECONDS = 60;

function toBase64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}

function resolvePresenceTokenSecret() {
  const secret = process.env.PRESENCE_TOKEN_SECRET?.trim() || "";

  if (!secret) {
    throw new Error("PRESENCE_TOKEN_SECRET is required to issue presence room tokens");
  }

  return secret;
}

export function createPresenceTokenClaims(input: {
  userId: string;
  sessionId: string | null;
  roomType: PresenceRoomType;
  roomId: string;
  role?: PresenceRoomRole;
  ttlSeconds?: number;
}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.max(
    15,
    Math.min(300, Math.trunc(input.ttlSeconds ?? DEFAULT_PRESENCE_TOKEN_TTL_SECONDS)),
  );

  return {
    userId: input.userId,
    sessionId: input.sessionId,
    roomType: input.roomType,
    roomId: input.roomId,
    role: input.role ?? "viewer",
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  } satisfies PresenceTokenClaims;
}

export function signPresenceToken(claims: PresenceTokenClaims) {
  const header: PresenceTokenHeader = {
    alg: "HS256",
    typ: "PRESENCE",
  };

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedClaims = toBase64Url(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = createHmac("sha256", resolvePresenceTokenSecret())
    .update(signingInput)
    .digest("base64url");

  return `${signingInput}.${signature}`;
}

export function verifyPresenceToken(token: string) {
  const [encodedHeader, encodedClaims, signature] = token.split(".");
  if (!encodedHeader || !encodedClaims || !signature) {
    throw new Error("Invalid presence token format");
  }

  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const expectedSignature = createHmac("sha256", resolvePresenceTokenSecret())
    .update(signingInput)
    .digest();
  const providedSignature = fromBase64Url(signature);

  if (
    expectedSignature.length !== providedSignature.length
    || !timingSafeEqual(expectedSignature, providedSignature)
  ) {
    throw new Error("Invalid presence token signature");
  }

  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as PresenceTokenHeader;
  if (header.alg !== "HS256" || header.typ !== "PRESENCE") {
    throw new Error("Unsupported presence token header");
  }

  const claims = JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8")) as PresenceTokenClaims;
  if (
    typeof claims.userId !== "string"
    || claims.userId.trim().length === 0
    || (claims.sessionId !== null && typeof claims.sessionId !== "string")
    || typeof claims.roomId !== "string"
    || claims.roomId.trim().length === 0
    || (claims.roomType !== "conversation" && claims.roomType !== "workspace")
    || (claims.role !== "viewer" && claims.role !== "editor")
    || typeof claims.exp !== "number"
    || typeof claims.iat !== "number"
  ) {
    throw new Error("Presence token claims are invalid");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (claims.exp <= nowSeconds) {
    throw new Error("Presence token has expired");
  }

  return claims;
}
