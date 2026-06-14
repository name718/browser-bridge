import { describe, it, expect } from "vitest";
import {
  DEFAULT_FEATURE_FLAGS,
  resolveFeatureFlagsFromEnv,
  mergeFeatureFlags,
  serializeFeatureFlags,
  deserializeFeatureFlags,
} from "../../packages/shared/src/feature-flags";

describe("DEFAULT_FEATURE_FLAGS", () => {
  it("should have all flags default to false", () => {
    for (const value of Object.values(DEFAULT_FEATURE_FLAGS)) {
      expect(value).toBe(false);
    }
  });

  it("should have all expected keys", () => {
    const keys = Object.keys(DEFAULT_FEATURE_FLAGS).sort();
    expect(keys).toEqual([
      "enableElementCache",
      "enableFormCache",
      "enableFormEngine",
      "enableSmartFill",
      "enableStructuredErrors",
      "enableToolConsolidation",
      "enableWebSocketHeartbeat",
    ]);
  });
});

describe("resolveFeatureFlagsFromEnv", () => {
  it("should return defaults when no env vars set", () => {
    const flags = resolveFeatureFlagsFromEnv({});
    expect(flags).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it("should parse 'true' string", () => {
    const flags = resolveFeatureFlagsFromEnv({
      BB_ENABLE_FORM_ENGINE: "true",
    });
    expect(flags.enableFormEngine).toBe(true);
    expect(flags.enableSmartFill).toBe(false); // others remain default
  });

  it("should parse '1' as true", () => {
    const flags = resolveFeatureFlagsFromEnv({
      BB_ENABLE_SMART_FILL: "1",
    });
    expect(flags.enableSmartFill).toBe(true);
  });

  it("should parse 'false' string as false", () => {
    const flags = resolveFeatureFlagsFromEnv({
      BB_ENABLE_FORM_ENGINE: "false",
    });
    expect(flags.enableFormEngine).toBe(false);
  });

  it("should parse '0' as false", () => {
    const flags = resolveFeatureFlagsFromEnv({
      BB_ENABLE_FORM_ENGINE: "0",
    });
    expect(flags.enableFormEngine).toBe(false);
  });

  it("should be case-insensitive", () => {
    const flags = resolveFeatureFlagsFromEnv({
      BB_ENABLE_FORM_ENGINE: "TRUE",
      BB_ENABLE_SMART_FILL: "True",
    });
    expect(flags.enableFormEngine).toBe(true);
    expect(flags.enableSmartFill).toBe(true);
  });

  it("should parse multiple flags", () => {
    const flags = resolveFeatureFlagsFromEnv({
      BB_ENABLE_FORM_ENGINE: "true",
      BB_ENABLE_SMART_FILL: "true",
      BB_ENABLE_ELEMENT_CACHE: "1",
    });
    expect(flags.enableFormEngine).toBe(true);
    expect(flags.enableSmartFill).toBe(true);
    expect(flags.enableElementCache).toBe(true);
    expect(flags.enableStructuredErrors).toBe(false);
  });
});

describe("mergeFeatureFlags", () => {
  it("should merge with defaults when no sources", () => {
    const merged = mergeFeatureFlags();
    expect(merged).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it("should override with later sources", () => {
    const merged = mergeFeatureFlags(
      { enableFormEngine: true },
      { enableSmartFill: true }
    );
    expect(merged.enableFormEngine).toBe(true);
    expect(merged.enableSmartFill).toBe(true);
    expect(merged.enableElementCache).toBe(false);
  });

  it("should give priority to later sources", () => {
    const merged = mergeFeatureFlags(
      { enableFormEngine: true },
      { enableFormEngine: false }
    );
    expect(merged.enableFormEngine).toBe(false);
  });

  it("should handle partial overrides", () => {
    const merged = mergeFeatureFlags({ enableFormEngine: true });
    expect(merged.enableFormEngine).toBe(true);
    expect(merged.enableSmartFill).toBe(false);
  });
});

describe("serializeFeatureFlags / deserializeFeatureFlags", () => {
  it("should round-trip through serialization", () => {
    const original = mergeFeatureFlags({
      enableFormEngine: true,
      enableSmartFill: true,
    });

    const serialized = serializeFeatureFlags(original);
    expect(typeof serialized).toBe("object");
    expect(serialized.enableFormEngine).toBe(true);

    const deserialized = deserializeFeatureFlags(serialized);
    expect(deserialized).toEqual(original);
  });

  it("should handle missing keys in deserialization", () => {
    const deserialized = deserializeFeatureFlags({ enableFormEngine: true });
    expect(deserialized.enableFormEngine).toBe(true);
    expect(deserialized.enableSmartFill).toBe(false); // default
  });

  it("should ignore non-boolean values", () => {
    const deserialized = deserializeFeatureFlags({
      enableFormEngine: "yes" as unknown as boolean,
      enableSmartFill: 1 as unknown as boolean,
    });
    expect(deserialized.enableFormEngine).toBe(false); // ignored, uses default
    expect(deserialized.enableSmartFill).toBe(false);
  });
});
