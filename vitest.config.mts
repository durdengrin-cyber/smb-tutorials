import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// environment stays "node" so the existing library tests are untouched.
// Component tests opt in per file with `// @vitest-environment jsdom`.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
      // Vitest has no "react-server" export condition, so the real
      // `server-only` package throws on import outside actual RSC — the
      // same reason Next's own Jest docs alias it to an empty module.
      "server-only": resolve(import.meta.dirname, "src/test/empty.ts"),
    },
  },
});
