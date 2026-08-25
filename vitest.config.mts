import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolves the "@/*" alias straight from tsconfig.json.
  resolve: { tsconfigPaths: true },
  test: {
    // No component tests yet, so the node environment keeps the suite fast.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      // Thresholds are scoped to the code that holds the logic. Component and
      // page coverage is deliberately out of scope for now — see README.
      include: ["src/lib/**/*.ts", "src/app/api/**/*.ts"],
      exclude: ["src/lib/**/types.ts", "src/lib/db.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
