import { describe, expect, it, vi } from "vitest";
import { retryWithBackoff } from "../../src/common/retryWithBackoff.js";

class RetryableError extends Error {}
class FatalError extends Error {}

describe("retryWithBackoff", () => {
  it("returns the result immediately on success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, () => true);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable failure and succeeds once the upstream recovers", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RetryableError("503"))
      .mockRejectedValueOnce(new RetryableError("503"))
      .mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, (err) => err instanceof RetryableError, 5);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry an error the predicate says is not retryable", async () => {
    const fn = vi.fn().mockRejectedValue(new FatalError("bad request"));

    await expect(retryWithBackoff(fn, (err) => err instanceof RetryableError, 5)).rejects.toBeInstanceOf(FatalError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the maximum number of attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new RetryableError("still down"));

    await expect(retryWithBackoff(fn, () => true, 3)).rejects.toBeInstanceOf(RetryableError);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
