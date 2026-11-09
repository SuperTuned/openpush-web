/** base64url without padding, as push keys and VAPID public keys are written. */

export function bytesToBase64url(bytes: ArrayBuffer | ArrayBufferView): string {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let binary = "";
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i] as number);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Throws on characters outside the base64url (or base64) alphabet. */
export function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Compares two base64url or base64 strings by value (padding and alphabet ignored). */
export function sameBase64(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return norm(a) === norm(b);
}
