let fallbackClientIdCounter = 0;

export function newClientId(prefix = "") {
  const id =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${(fallbackClientIdCounter++).toString(36)}`;
  return `${prefix}${id}`;
}
