import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/__tests__/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["node_modules", ".next", "dist", "cli"],
    env: {
      // Bypass ~/env zod validation for tests so importing modules that
      // pull from `~/env` doesn't require a real DATABASE_URL, etc.
      SKIP_ENV_VALIDATION: "true",
      NODE_ENV: "test",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
    },
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src"),
    },
  },
});
