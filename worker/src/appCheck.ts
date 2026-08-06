// Verifies the X-Firebase-AppCheck token on incoming requests using
// Firebase's public JWKS - this is what actually stops arbitrary scripts
// (curl, a bot, a scraped copy of the API) from hitting the endpoint, as
// opposed to relying on the reCAPTCHA badge alone, which only proves a
// browser did *something*, not that the token attached to *this* request
// is genuine and unexpired.

interface JWK {
  kid: string;
  n: string;
  e: string;
  kty: string;
}

let cachedJWKS: { keys: JWK[]; fetchedAt: number } | null = null;
const JWKS_URL = "https://firebaseappcheck.googleapis.com/v1/jwks";
const JWKS_TTL_MS = 6 * 60 * 60 * 1000; // 6h, per Google's guidance

async function getJWKS(): Promise<JWK[]> {
  if (cachedJWKS && Date.now() - cachedJWKS.fetchedAt < JWKS_TTL_MS) return cachedJWKS.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error("Failed to fetch App Check JWKS");
  const data = await res.json<{ keys: JWK[] }>();
  cachedJWKS = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

function base64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function verifyAppCheckToken(token: string, projectNumber: string): Promise<boolean> {
  try {
    const [headerB64, payloadB64, sigB64] = token.split(".");
    if (!headerB64 || !payloadB64 || !sigB64) return false;

    const header = JSON.parse(new TextDecoder().decode(base64urlDecode(headerB64)));
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return false;
    if (payload.aud?.[0] !== `projects/${projectNumber}`) return false;
    if (!payload.iss?.includes("firebaseappcheck.googleapis.com")) return false;

    const jwks = await getJWKS();
    const jwk = jwks.find((k) => k.kid === header.kid);
    if (!jwk) return false;

    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const sig = base64urlDecode(sigB64);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
  } catch {
    return false;
  }
}
