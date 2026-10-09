import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative paths so the build works from any folder, such as a GitHub Pages project site.
  base: "./",
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
