/**
 * Web Worker for background file/blob hashing.
 * Offloads arrayBuffer load and WebCrypto digest cycles from the main thread.
 */

const CHUNK_SIZE = 32 * 1024 * 1024; // 32 MiB

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

self.onmessage = async (e: MessageEvent<{ blob: Blob }>) => {
  const { blob } = e.data;
  if (!blob) {
    self.postMessage({ error: "Missing blob parameter" });
    return;
  }

  try {
    const size = blob.size;
    const cryptoSubtle = self.crypto?.subtle;
    if (!cryptoSubtle) {
      throw new Error("SubtleCrypto is not available in worker context.");
    }

    if (size <= CHUNK_SIZE) {
      const buffer = await blob.arrayBuffer();
      const digest = await cryptoSubtle.digest("SHA-256", buffer);
      self.postMessage({
        result: { kind: "full", hashHex: bufferToHex(digest), bytes: size },
      });
    } else {
      // Large file: hash only the first CHUNK_SIZE bytes and mark as prefix.
      const slice = blob.slice(0, CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();
      const digest = await cryptoSubtle.digest("SHA-256", buffer);
      self.postMessage({
        result: {
          kind: "prefix",
          hashHex: bufferToHex(digest),
          bytes: size,
          prefixBytes: CHUNK_SIZE,
        },
      });
    }
  } catch (err) {
    self.postMessage({
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
