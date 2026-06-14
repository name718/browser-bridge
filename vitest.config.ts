import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    // 测试文件匹配模式
    include: [
      "tests/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
    ],

    // Benchmark 文件
    benchmark: {
      include: ["tests/benchmark/**/*.bench.ts"],
    },

    // 全局设置
    globals: true,
    environment: "node",

    // 覆盖率配置
    coverage: {
      provider: "v8",
      include: [
        "packages/shared/src/**/*.ts",
        "packages/mcp-server/src/**/*.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.bench.ts",
        "**/dist/**",
        "**/node_modules/**",
      ],
    },

    // 测试超时
    testTimeout: 10_000,
  },

  resolve: {
    alias: {
      "@majuntao-1/browser-bridge-shared": resolve(
        __dirname,
        "packages/shared/src/index.ts"
      ),
    },
  },
});
