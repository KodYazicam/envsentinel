import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      thresholds: {
        statements: 75,
        branches: 60,
        functions: 75,
        lines: 75,
      },
    },
  },
});
