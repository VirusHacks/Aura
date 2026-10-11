import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The Cloud and watch backends have their own package-level test runners.
    // Keep the root command focused on the Next.js/TypeScript test suite.
    exclude: ["node_modules", "cloud/test/**", "watch/backend/test/**"],
  },
});
