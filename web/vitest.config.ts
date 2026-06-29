import { defineConfig } from "vitest/config";
import path from "node:path";

// Test runner for the HireSignal web app. Default env is `node` (lib + API-route
// handlers are pure server logic); component tests opt into jsdom per-file with a
// `// @vitest-environment jsdom` docblock. Path alias mirrors tsconfig (@/* -> src/*).
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary", "html"],
      reportsDirectory: "./coverage",
      // Coverage targets the unit-testable LOGIC layer: lib/ + API route handlers.
      // Presentation components and RSC pages are verified by the in-browser flow,
      // not unit tests, so they're outside the coverage denominator.
      include: ["src/lib/**/*.{ts,tsx}", "src/app/api/**/*.ts"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.d.ts",
        "src/**/types.ts",
        "src/lib/fonts.ts",
        "src/lib/cn.ts",
        // Playwright browser-automation — integration/E2E territory, not unit-testable.
        "src/lib/apply/session.ts",
        "src/lib/apply/drive.ts",
        "src/lib/apply/agent-interpret.ts",
      ],
      thresholds: {
        // No-regression floors for the logic layer. Well-covered modules sit far
        // above these; the floor accounts for the CLI-orchestration routes (run,
        // assistant, explore/ai, cv/ingest, apply/*) that are integration-tested.
        statements: 60,
        branches: 55,
        functions: 62,
      },
    },
  },
});
