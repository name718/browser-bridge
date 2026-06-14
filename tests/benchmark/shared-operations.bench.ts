import { bench, describe } from "vitest";
import {
  StructuredBridgeError,
  ErrorCode,
  normalizeBridgeError,
} from "../../packages/shared/src/errors";
import {
  resolveFeatureFlagsFromEnv,
  mergeFeatureFlags,
  serializeFeatureFlags,
  deserializeFeatureFlags,
} from "../../packages/shared/src/feature-flags";
import { isRecord, isSensitive, deepMerge } from "../../packages/shared/src/utils";
import { getTimeout } from "../../packages/shared/src/config";

describe("StructuredBridgeError operations", () => {
  bench("normalizeBridgeError - known code", () => {
    const error = new Error("ELEMENT_NOT_FOUND: button not found");
    normalizeBridgeError(error);
  });

  bench("normalizeBridgeError - unknown error", () => {
    normalizeBridgeError("string error");
  });

  bench("StructuredBridgeError toPayload", () => {
    const error = new StructuredBridgeError(
      ErrorCode.ELEMENT_NOT_FOUND,
      "Not found",
      { fallback: "visual" }
    );
    error.toPayload();
  });

  bench("StructuredBridgeError fromPayload", () => {
    StructuredBridgeError.fromPayload({
      ok: false,
      error: {
        code: ErrorCode.ELEMENT_NOT_FOUND,
        message: "Not found",
        fallback: "visual",
      },
    });
  });
});

describe("Feature Flags operations", () => {
  bench("resolveFeatureFlagsFromEnv - empty", () => {
    resolveFeatureFlagsFromEnv({});
  });

  bench("resolveFeatureFlagsFromEnv - with values", () => {
    resolveFeatureFlagsFromEnv({
      BB_ENABLE_FORM_ENGINE: "true",
      BB_ENABLE_SMART_FILL: "1",
      BB_ENABLE_ELEMENT_CACHE: "false",
    });
  });

  bench("mergeFeatureFlags - 3 sources", () => {
    mergeFeatureFlags(
      { enableFormEngine: true },
      { enableSmartFill: true },
      { enableElementCache: true }
    );
  });

  bench("serializeFeatureFlags", () => {
    serializeFeatureFlags(mergeFeatureFlags({ enableFormEngine: true }));
  });

  bench("deserializeFeatureFlags", () => {
    deserializeFeatureFlags({ enableFormEngine: true, enableSmartFill: false });
  });
});

describe("Utils operations", () => {
  bench("isRecord - object", () => {
    isRecord({ a: 1, b: 2 });
  });

  bench("isRecord - null", () => {
    isRecord(null);
  });

  bench("isSensitive - password field", () => {
    isSensitive({ placeholder: "请输入密码", inputType: "password" });
  });

  bench("isSensitive - normal field", () => {
    isSensitive({ placeholder: "请输入用户名" });
  });

  bench("deepMerge - nested objects", () => {
    deepMerge(
      { a: { x: 1, y: 2 }, b: { c: 3 } },
      { a: { y: 3, z: 4 }, d: 5 }
    );
  });
});

describe("Config operations", () => {
  bench("getTimeout - default", () => {
    getTimeout("CONNECTION_WAIT", {});
  });

  bench("getTimeout - with env override", () => {
    getTimeout("CONNECTION_WAIT", { BB_TIMEOUT_CONNECTION_WAIT: "20000" });
  });
});
