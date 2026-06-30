import { createHmac, timingSafeEqual } from "node:crypto";

import {
  buildDocCollaborationDocumentName,
  parseDocCollaborationDocumentName,
} from "./doc-collaboration-document";

type DocCollaborationTokenHeader = {
  alg: "HS256";
  typ: "DOC_COLLABORATION";
};

export type DocCollaborationTokenClaims = {
  userId: string;
  sessionId: string | null;
  projectId: string;
  documentName: string;
  role: "editor";
  exp: number;
  iat: number;
};

const DEFAULT_DOC_COLLABORATION_TOKEN_TTL_SECONDS = 120;
export const MISSING_DOC_COLLABORATION_SECRET_ERROR_CODE = "MISSING_DOC_COLLABORATION_SECRET";

export class MissingDocCollaborationSecretError extends Error {
  readonly code = MISSING_DOC_COLLABORATION_SECRET_ERROR_CODE;

  constructor() {
    super("Doc collaboration service is not configured for this environment.");
    this.name = "MissingDocCollaborationSecretError";
  }
}

function toBase64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}

function resolveDocCollaborationTokenSecret() {
  const secret =
    process.env.DOC_COLLABORATION_TOKEN_SECRET?.trim()
    || process.env.PRESENCE_TOKEN_SECRET?.trim()
    || "";
  if (secret) return secret;
  throw new MissingDocCollaborationSecretError();
}

export function createDocCollaborationTokenClaims(input: {
  userId: string;
  sessionId: string | null;
  projectId: string;
  docSlug?: string;
  ttlSeconds?: number;
}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.max(
    30,
    Math.min(600, Math.trunc(input.ttlSeconds ?? DEFAULT_DOC_COLLABORATION_TOKEN_TTL_SECONDS)),
  );

  return {
    userId: input.userId,
    sessionId: input.sessionId,
    projectId: input.projectId,
    documentName: buildDocCollaborationDocumentName(input.projectId, input.docSlug || "readme"),
    role: "editor",
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  } satisfies DocCollaborationTokenClaims;
}

export function signDocCollaborationToken(claims: DocCollaborationTokenClaims) {
  const header: DocCollaborationTokenHeader = {
    alg: "HS256",
    typ: "DOC_COLLABORATION",
  };

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedClaims = toBase64Url(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = createHmac("sha256", resolveDocCollaborationTokenSecret())
    .update(signingInput)
    .digest("base64url");

  return `${signingInput}.${signature}`;
}

export function verifyDocCollaborationToken(token: string) {
  const [encodedHeader, encodedClaims, signature] = token.split(".");
  if (!encodedHeader || !encodedClaims || !signature) {
    throw new Error("Invalid Doc collaboration token format");
  }

  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const expectedSignature = createHmac("sha256", resolveDocCollaborationTokenSecret())
    .update(signingInput)
    .digest();
  const providedSignature = fromBase64Url(signature);

  if (
    expectedSignature.length !== providedSignature.length
    || !timingSafeEqual(expectedSignature, providedSignature)
  ) {
    throw new Error("Invalid Doc collaboration token signature");
  }

  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as DocCollaborationTokenHeader;
  if (header.alg !== "HS256" || header.typ !== "DOC_COLLABORATION") {
    throw new Error("Unsupported Doc collaboration token header");
  }

  const claims = JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8")) as DocCollaborationTokenClaims;
  const parsed =
    typeof claims.documentName === "string"
      ? parseDocCollaborationDocumentName(claims.documentName)
      : null;
  if (
    typeof claims.userId !== "string"
    || claims.userId.trim().length === 0
    || (claims.sessionId !== null && typeof claims.sessionId !== "string")
    || typeof claims.projectId !== "string"
    || claims.projectId.trim().length === 0
    || !parsed
    || parsed.projectId !== claims.projectId
    || claims.documentName !== buildDocCollaborationDocumentName(claims.projectId, parsed.docSlug)
    || claims.role !== "editor"
    || typeof claims.exp !== "number"
    || typeof claims.iat !== "number"
  ) {
    throw new Error("Doc collaboration token claims are invalid");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (claims.exp <= nowSeconds) {
    throw new Error("Doc collaboration token has expired");
  }

  return claims;
}
