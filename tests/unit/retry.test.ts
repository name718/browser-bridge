import { describe, it, expect, vi } from "vitest";
import { withRetry, isRetryableError } from "../../packages/mcp-server/src/utils/retry";

describe("withRetry", () => {
  it("should return result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on failure and succeed", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { maxAttempts: 3, baseDelay: 10 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should throw after max attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fail"));

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelay: 10 })
    ).rejects.toThrow("always fail");

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should not retry if retryOn returns false", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("not retryable"));

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        baseDelay: 10,
        retryOn: () => false,
      })
    ).rejects.toThrow("not retryable");

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry only when retryOn returns true", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ code: "TIMEOUT" })
      .mockResolvedValue("ok");

    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelay: 10,
      retryOn: (err) => (err as { code?: string }).code === "TIMEOUT",
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should apply delay between retries", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");

    const start = Date.now();
    await withRetry(fn, { maxAttempts: 2, baseDelay: 100 });

    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90); // ~100ms + jitter
  });
});

describe("isRetryableError", () => {
  it("should return true for TIMEOUT", () => {
    expect(isRetryableError({ code: "TIMEOUT" })).toBe(true);
  });

  it("should return true for CONNECTION_LOST", () => {
    expect(isRetryableError({ code: "CONNECTION_LOST" })).toBe(true);
  });

  it("should return true for CONTENT_SCRIPT_NOT_READY", () => {
    expect(isRetryableError({ code: "CONTENT_SCRIPT_NOT_READY" })).toBe(true);
  });

  it("should return true for retryable flag", () => {
    expect(isRetryableError({ retryable: true })).toBe(true);
  });

  it("should return true for BridgeErrorPayload format", () => {
    expect(
      isRetryableError({
        error: { code: "TIMEOUT", message: "timeout" },
      })
    ).toBe(true);
  });

  it("should return false for non-retryable errors", () => {
    expect(isRetryableError({ code: "ELEMENT_NOT_FOUND" })).toBe(false);
    expect(isRetryableError({ code: "INVALID_PARAMS" })).toBe(false);
  });

  it("should return false for generic errors", () => {
    expect(isRetryableError(new Error("something"))).toBe(false);
  });

  it("should return false for null/undefined", () => {
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});
