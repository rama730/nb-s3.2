import crypto from "crypto";

const CODE_PREFIX = "nb_auth_";
const AUTH_CODE_VERSION = 1;
const DEFAULT_AUTH_CODE_TTL_MS = 5 * 60 * 1000;

type AuthCodePayload = {
  v: number;
  sid: string;
  uid: string;
  cid: string;
  exp: number;
  iv: string;
  tag: string;
  ct: string;
};

function base64UrlEncode(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string) {
  return Buffer.from(input, "base64url");
}

function getAuthCodeSecret() {
  const secret = process.env.EXTENSION_AUTH_CODE_SECRET
    || process.env.AUTH_SECRET
    || process.env.NEXTAUTH_SECRET
    || process.env.SUPABASE_JWT_SECRET
    || (process.env.NODE_ENV === "production" ? "" : "nb-extension-auth-code-local-development-secret");

  if (!secret) {
    throw new Error("EXTENSION_AUTH_CODE_SECRET is required for extension browser authorization.");
  }

  return crypto.createHash("sha256").update(secret).digest();
}

function sign(payload: string) {
  return crypto.createHmac("sha256", getAuthCodeSecret()).update(payload).digest("base64url");
}

function timingSafeEqualString(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function encryptionAad(payload: Pick<AuthCodePayload, "sid" | "uid" | "cid" | "exp">) {
  return Buffer.from(`${payload.sid}.${payload.uid}.${payload.cid}.${payload.exp}`, "utf8");
}

export function hashExtensionAuthCode(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function issueExtensionAuthCode(params: {
  rawToken: string;
  sessionId: string;
  userId: string;
  ttlMs?: number;
}) {
  const expiresAt = new Date(Date.now() + Math.max(30_000, params.ttlMs ?? DEFAULT_AUTH_CODE_TTL_MS));
  const cid = crypto.randomBytes(16).toString("base64url");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getAuthCodeSecret(), iv);
  cipher.setAAD(encryptionAad({
    sid: params.sessionId,
    uid: params.userId,
    cid,
    exp: expiresAt.getTime(),
  }));

  const encrypted = Buffer.concat([
    cipher.update(params.rawToken, "utf8"),
    cipher.final(),
  ]);

  const payload: AuthCodePayload = {
    v: AUTH_CODE_VERSION,
    sid: params.sessionId,
    uid: params.userId,
    cid,
    exp: expiresAt.getTime(),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ct: encrypted.toString("base64url"),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  const code = `${CODE_PREFIX}${encodedPayload}.${signature}`;

  return {
    code,
    codeHash: hashExtensionAuthCode(code),
    expiresAt,
    codeId: cid,
  };
}

export function verifyExtensionAuthCode(code: string) {
  const trimmed = code.trim();
  if (!trimmed.startsWith(CODE_PREFIX)) {
    throw new Error("Invalid authorization code.");
  }

  const compact = trimmed.slice(CODE_PREFIX.length);
  const [encodedPayload, signature] = compact.split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Invalid authorization code.");
  }

  const expectedSignature = sign(encodedPayload);
  if (!timingSafeEqualString(signature, expectedSignature)) {
    throw new Error("Invalid authorization code signature.");
  }

  let payload: AuthCodePayload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as AuthCodePayload;
  } catch {
    throw new Error("Invalid authorization code payload.");
  }

  if (payload.v !== AUTH_CODE_VERSION || !payload.sid || !payload.uid || !payload.cid || !payload.exp) {
    throw new Error("Invalid authorization code payload.");
  }
  if (Date.now() > payload.exp) {
    throw new Error("Authorization code expired. Start the connection again.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getAuthCodeSecret(),
    base64UrlDecode(payload.iv),
  );
  decipher.setAAD(encryptionAad(payload));
  decipher.setAuthTag(base64UrlDecode(payload.tag));

  const rawToken = Buffer.concat([
    decipher.update(base64UrlDecode(payload.ct)),
    decipher.final(),
  ]).toString("utf8");

  if (!rawToken.startsWith("nb_dev_")) {
    throw new Error("Invalid authorization token payload.");
  }

  return {
    sessionId: payload.sid,
    userId: payload.uid,
    codeId: payload.cid,
    codeHash: hashExtensionAuthCode(trimmed),
    expiresAt: new Date(payload.exp),
    rawToken,
  };
}
