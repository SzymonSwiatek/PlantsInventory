const ENC = new TextEncoder();

function toBase64Url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", ENC.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signUnsubscribeToken(userId: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, ENC.encode(userId));
  return toBase64Url(sig);
}

export async function verifyUnsubscribeToken(userId: string, token: string, secret: string): Promise<boolean> {
  const key = await importKey(secret);
  // Re-decode the base64url token back to bytes for constant-time verify
  const padded = token.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const b64 = padded + "=".repeat(padLen);
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  return crypto.subtle.verify("HMAC", key, bytes, ENC.encode(userId));
}
