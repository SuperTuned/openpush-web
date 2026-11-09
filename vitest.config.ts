import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  define: { __OPENPUSH_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    // The wrappers import the SDK by its package name; in tests that is this repo's source.
    alias: [{ find: /^@openpush\/web$/, replacement: fileURLToPath(new URL("./src/npm/index.ts", import.meta.url)) }],
  },
  test: {
    include: ["test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
  },
});
