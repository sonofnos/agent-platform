import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 over the raw body, the scheme used by Twilio, Retell, and most voice/webhook providers. */
export function computeSignature(secret: string, rawBody: Buffer): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifySignature(secret: string, rawBody: Buffer, providedSignature: string | undefined): boolean {
  if (!providedSignature) return false;

  const expected = Buffer.from(computeSignature(secret, rawBody), "utf-8");
  const provided = Buffer.from(providedSignature.toLowerCase(), "utf-8");
  if (expected.length !== provided.length) return false;

  return timingSafeEqual(expected, provided);
}
