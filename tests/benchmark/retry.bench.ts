import { bench, describe } from "vitest";
import { withRetry, isRetryableError } from "../../packages/mcp-server/src/utils/retry";

describe("Retry operations", () => {
  bench("isRetryableError - retryable", () => {
    isRetryableError({ code: "TIMEOUT" });
  });

  bench("isRetryableError - non-retryable", () => {
    isRetryableError({ code: "ELEMENT_NOT_FOUND" });
  });

  bench("withRetry - immediate success", async () => {
    await withRetry(async () => "ok", { maxAttempts: 3 });
  });
});
