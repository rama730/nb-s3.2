export type GoogleOneTapNonce = {
  raw: string;
  hashed: string;
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function getGoogleOneTapClientId(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || "";
}

export async function createGoogleOneTapNonce(): Promise<GoogleOneTapNonce> {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = toBase64Url(randomBytes);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );

  return { raw, hashed: toHex(digest) };
}
