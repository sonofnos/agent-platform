import { describe, expect, it } from "vitest";
import { computeSignature, verifySignature } from "../../src/webhooks/signature.js";

const body = Buffer.from(JSON.stringify({ eventId: "evt-1" }));
const now = 1_790_000_000_000;
const ts = String(now / 1000);

describe("timestamped webhook signature", () => {
  it("accepts a correctly signed, fresh request", () => {
    expect(verifySignature("secret", body, ts, computeSignature("secret", ts, body), now)).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    const sig = computeSignature("secret", ts, body);
    expect(verifySignature("secret", Buffer.from('{"eventId":"evt-2"}'), ts, sig, now)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects the wrong secret", () => {
    expect(verifySignature("wrong", body, ts, computeSignature("secret", ts, body), now).ok).toBe(false);
  });

  it("rejects a replay: an old signed request, even with a valid signature", () => {
    const old = String(now / 1000 - 301);
    expect(verifySignature("secret", body, old, computeSignature("secret", old, body), now)).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects moving the timestamp forward, because the timestamp is part of what is signed", () => {
    const old = String(now / 1000 - 3600);
    const sig = computeSignature("secret", old, body);
    expect(verifySignature("secret", body, ts, sig, now)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a missing timestamp or signature", () => {
    expect(verifySignature("secret", body, undefined, "abc", now).ok).toBe(false);
    expect(verifySignature("secret", body, ts, undefined, now).ok).toBe(false);
  });
});
