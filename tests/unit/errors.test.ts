import { describe, it, expect } from "vitest";
import {
  StructuredBridgeError,
  ErrorCode,
  StructuredBridgeErrorPayload,
  normalizeBridgeError,
} from "../../packages/shared/src/errors";

describe("StructuredBridgeError", () => {
  it("should create error with code and message", () => {
    const error = new StructuredBridgeError(
      ErrorCode.ELEMENT_NOT_FOUND,
      "Element not found"
    );

    expect(error.code).toBe(ErrorCode.ELEMENT_NOT_FOUND);
    expect(error.message).toBe("Element not found");
    expect(error.name).toBe("StructuredBridgeError");
    expect(error.retryable).toBe(false);
    expect(error.fallback).toBe("none");
  });

  it("should create error with retryable and fallback options", () => {
    const error = new StructuredBridgeError(
      ErrorCode.ELEMENT_NOT_FOUND,
      "Element not found",
      { retryable: true, fallback: "visual" }
    );

    expect(error.retryable).toBe(true);
    expect(error.fallback).toBe("visual");
  });

  it("should serialize to StructuredBridgeErrorPayload", () => {
    const error = new StructuredBridgeError(
      ErrorCode.TIMEOUT,
      "Operation timed out",
      { details: { timeout: 5000 }, retryable: true }
    );

    const payload = error.toPayload();

    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe(ErrorCode.TIMEOUT);
    expect(payload.error.message).toBe("Operation timed out");
    expect(payload.error.details).toEqual({ timeout: 5000 });
    expect(payload.error.retryable).toBe(true);
  });

  it("should create from StructuredBridgeErrorPayload", () => {
    const payload: StructuredBridgeErrorPayload = {
      ok: false,
      error: {
        code: ErrorCode.CONNECTION_LOST,
        message: "Connection lost",
        retryable: true,
        fallback: "none",
      },
    };

    const error = StructuredBridgeError.fromPayload(payload);

    expect(error).toBeInstanceOf(StructuredBridgeError);
    expect(error.code).toBe(ErrorCode.CONNECTION_LOST);
    expect(error.message).toBe("Connection lost");
    expect(error.retryable).toBe(true);
  });

  it("should round-trip through payload serialization", () => {
    const original = new StructuredBridgeError(
      ErrorCode.AMBIGUOUS_TARGET,
      "Multiple matches",
      { details: { count: 3 }, fallback: "semantic" }
    );

    const payload = original.toPayload();
    const restored = StructuredBridgeError.fromPayload(payload);

    expect(restored.code).toBe(original.code);
    expect(restored.message).toBe(original.message);
    expect(restored.details).toEqual(original.details);
    expect(restored.fallback).toBe(original.fallback);
    expect(restored.retryable).toBe(original.retryable);
  });
});

describe("normalizeBridgeError", () => {
  it("should return StructuredBridgeError as-is", () => {
    const original = new StructuredBridgeError(
      ErrorCode.ELEMENT_NOT_FOUND,
      "Not found"
    );
    const normalized = normalizeBridgeError(original);
    expect(normalized).toBe(original);
  });

  it("should extract error code from message prefix", () => {
    const error = new Error("ELEMENT_NOT_FOUND: button not found");
    const normalized = normalizeBridgeError(error);

    expect(normalized.code).toBe(ErrorCode.ELEMENT_NOT_FOUND);
    expect(normalized.message).toBe("ELEMENT_NOT_FOUND: button not found");
    expect(normalized.fallback).toBe("visual");
  });

  it("should extract TIMEOUT from message", () => {
    const error = new Error("TIMEOUT: operation took too long");
    const normalized = normalizeBridgeError(error);

    expect(normalized.code).toBe(ErrorCode.TIMEOUT);
    expect(normalized.retryable).toBe(true);
  });

  it("should handle unknown Error as INTERNAL_ERROR", () => {
    const error = new Error("something weird happened");
    const normalized = normalizeBridgeError(error);

    expect(normalized.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(normalized.message).toBe("something weird happened");
  });

  it("should handle non-Error values", () => {
    const normalized = normalizeBridgeError("string error");

    expect(normalized.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(normalized.message).toBe("string error");
  });

  it("should handle null/undefined", () => {
    const normalized = normalizeBridgeError(null);
    expect(normalized.code).toBe(ErrorCode.INTERNAL_ERROR);

    const normalized2 = normalizeBridgeError(undefined);
    expect(normalized2.code).toBe(ErrorCode.INTERNAL_ERROR);
  });
});
