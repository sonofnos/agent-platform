import { createHmac, timingSafeEqual } from "node:crypto";

export const REPLAY_TOLERANCE_SECONDS = 300;

/**
 * HMAC-SHA256 over `${timestamp}.${rawBody}` (the Stripe-style scheme). Signing the
 * timestamp with the body means a captured request can't be replayed later with a
 * fresh timestamp; the event-id dedupe in WebhookEventStore catches replays inside
 * the tolerance window.
 */
export function computeSignature(secret: string, timestamp: string, rawBody: Buffer): string {
  return createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
}

export type SignatureCheck = { ok: true } | { ok: false; reason: "missing" | "stale" | "invalid" };

export function verifySignature(
  secret: string,
  rawBody: Buffer,
  timestamp: string | undefined,
  providedSignature: string | undefined,
  nowMs = Date.now(),
  toleranceSeconds = REPLAY_TOLERANCE_SECONDS,
): SignatureCheck {
  if (!timestamp || !providedSignature || !/^\d+$/.test(timestamp)) return { ok: false, reason: "missing" };
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > toleranceSeconds) return { ok: false, reason: "stale" };

  const expected = Buffer.from(computeSignature(secret, timestamp, rawBody), "utf-8");
  const provided = Buffer.from(providedSignature.toLowerCase(), "utf-8");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return { ok: false, reason: "invalid" };
  return { ok: true };
}
