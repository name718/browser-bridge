import { describe, it, expect } from "vitest";
import { TIMEOUTS, getTimeout } from "../../packages/shared/src/config";

describe("TIMEOUTS", () => {
  it("should have reasonable default values", () => {
    expect(TIMEOUTS.CONNECTION_WAIT).toBe(15_000);
    expect(TIMEOUTS.PAGE_LOAD_READY).toBe(15_000);
    expect(TIMEOUTS.ELEMENT_WAIT).toBe(4_000);
    expect(TIMEOUTS.DEFAULT_TOOL_TIMEOUT).toBe(10_000);
  });

  it("should have all values as positive numbers", () => {
    for (const [key, value] of Object.entries(TIMEOUTS)) {
      expect(value, `${key} should be positive`).toBeGreaterThan(0);
    }
  });
});

describe("getTimeout", () => {
  it("should return default value when no env var", () => {
    expect(getTimeout("CONNECTION_WAIT", {})).toBe(15_000);
  });

  it("should override from env var", () => {
    expect(
      getTimeout("CONNECTION_WAIT", { BB_TIMEOUT_CONNECTION_WAIT: "20000" })
    ).toBe(20_000);
  });

  it("should ignore invalid env var values", () => {
    expect(
      getTimeout("CONNECTION_WAIT", { BB_TIMEOUT_CONNECTION_WAIT: "abc" })
    ).toBe(15_000);
  });

  it("should ignore negative values", () => {
    expect(
      getTimeout("CONNECTION_WAIT", { BB_TIMEOUT_CONNECTION_WAIT: "-1000" })
    ).toBe(15_000);
  });

  it("should ignore zero values", () => {
    expect(
      getTimeout("CONNECTION_WAIT", { BB_TIMEOUT_CONNECTION_WAIT: "0" })
    ).toBe(15_000);
  });

  it("should handle all timeout keys", () => {
    for (const key of Object.keys(TIMEOUTS) as Array<keyof typeof TIMEOUTS>) {
      const result = getTimeout(key, {});
      expect(result).toBe(TIMEOUTS[key]);
    }
  });
});
