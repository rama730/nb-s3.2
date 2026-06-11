import { createHmac, timingSafeEqual } from "node:crypto";

import {
  buildReadmeCollaborationDocumentName,
  parseReadmeCollaborationDocumentName,
} from "./readme-collaboration-document";

type ReadmeCollaborationTokenHeader = {
  alg: "HS256";
  typ: "README_COLLABORATION";
};

export type ReadmeCollaborationTokenClaims = {
  userId: string;
  sessionId: string | null;
  projectId: string;
  documentName: string;
  role: "editor";
  exp: number;
  iat: number;
};

const DEFAULT_README_COLLABORATION_TOKEN_TTL_SECONDS = 120;
export const MISSING_README_COLLABORATION_SECRET_ERROR_CODE = "MISSING_README_COLLABORATION_SECRET";

export class MissingReadmeCollaborationSecretError extends Error {
  readonly code = MISSING_README_COLLABORATION_SECRET_ERROR_CODE;

  constructor() {
    super("README collaboration service is not configured for this environment.");
    this.name = "MissingReadmeCollaborationSecretError";
  }
}

function toBase64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}

function resolveReadmeCollaborationTokenSecret() {
  const secret =
    process.env.README_COLLABORATION_TOKEN_SECRET?.trim()
    || process.env.PRESENCE_TOKEN_SECRET?.trim()
    || "";
  if (secret) return secret;
  throw new MissingReadmeCollaborationSecretError();
}

export function createReadmeCollaborationTokenClaims(input: {
  userId: string;
  sessionId: string | null;
  projectId: string;
  ttlSeconds?: number;
}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.max(
    30,
    Math.min(600, Math.trunc(input.ttlSeconds ?? DEFAULT_README_COLLABORATION_TOKEN_TTL_SECONDS)),
  );

  return {
    userId: input.userId,
    sessionId: input.sessionId,
    projectId: input.projectId,
    documentName: buildReadmeCollaborationDocumentName(input.projectId),
    role: "editor",
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  } satisfies ReadmeCollaborationTokenClaims;
}

export function signReadmeCollaborationToken(claims: ReadmeCollaborationTokenClaims) {
  const header: ReadmeCollaborationTokenHeader = {
    alg: "HS256",
    typ: "README_COLLABORATION",
  };

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedClaims = toBase64Url(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = createHmac("sha256", resolveReadmeCollaborationTokenSecret())
    .update(signingInput)
    .digest("base64url");

  return `${signingInput}.${signature}`;
}

export function verifyReadmeCollaborationToken(token: string) {
  const [encodedHeader, encodedClaims, signature] = token.split(".");
  if (!encodedHeader || !encodedClaims || !signature) {
    throw new Error("Invalid README collaboration token format");
  }

  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const expectedSignature = createHmac("sha256", resolveReadmeCollaborationTokenSecret())
    .update(signingInput)
    .digest();
  const providedSignature = fromBase64Url(signature);

  if (
    expectedSignature.length !== providedSignature.length
    || !timingSafeEqual(expectedSignature, providedSignature)
  ) {
    throw new Error("Invalid README collaboration token signature");
  }

  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as ReadmeCollaborationTokenHeader;
  if (header.alg !== "HS256" || header.typ !== "README_COLLABORATION") {
    throw new Error("Unsupported README collaboration token header");
  }

  const claims = JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8")) as ReadmeCollaborationTokenClaims;
  const parsedDocumentProjectId =
    typeof claims.documentName === "string"
      ? parseReadmeCollaborationDocumentName(claims.documentName)
      : null;
  if (
    typeof claims.userId !== "string"
    || claims.userId.trim().length === 0
    || (claims.sessionId !== null && typeof claims.sessionId !== "string")
    || typeof claims.projectId !== "string"
    || claims.projectId.trim().length === 0
    || parsedDocumentProjectId !== claims.projectId
    || claims.documentName !== buildReadmeCollaborationDocumentName(claims.projectId)
    || claims.role !== "editor"
    || typeof claims.exp !== "number"
    || typeof claims.iat !== "number"
  ) {
    throw new Error("README collaboration token claims are invalid");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (claims.exp <= nowSeconds) {
    throw new Error("README collaboration token has expired");
  }

  return claims;
}
