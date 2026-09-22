import { describe, expect, it } from "vitest";
import { computeSignature, verifySignature } from "../../src/webhooks/signature.js";

describe("webhook signature", () => {
  it("verifies a correctly signed body", () => {
    const body = Buffer.from(JSON.stringify({ eventId: "evt-1" }));
    const signature = computeSignature("secret", body);

    expect(verifySignature("secret", body, signature)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const original = Buffer.from(JSON.stringify({ eventId: "evt-1", amount: 100 }));
    const signature = computeSignature("secret", original);
    const tampered = Buffer.from(JSON.stringify({ eventId: "evt-1", amount: 999999 }));

    expect(verifySignature("secret", tampered, signature)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const body = Buffer.from(JSON.stringify({ eventId: "evt-1" }));
    const signature = computeSignature("secret", body);

    expect(verifySignature("wrong-secret", body, signature)).toBe(false);
  });

  it("rejects a missing signature", () => {
    const body = Buffer.from(JSON.stringify({ eventId: "evt-1" }));
    expect(verifySignature("secret", body, undefined)).toBe(false);
  });
});
