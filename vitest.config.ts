import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    clearMocks: true,
    globalSetup: ["tests/helpers/tempRoot.ts"],
    setupFiles: ["tests/helpers/orphan.ts"],
  },
});
