// Builds every output of the SDK:
//   dist/cdn/openpush.js, openpush-prompts.js, openpush-sw.js, openpush-compat.js  (IIFE, minified)
//   dist/cdn/bridge/openpush.js, bridge/openpush-sw.js                              (v1 bridge)
//   dist/npm/{index,compat,prompts}.{mjs,cjs} + shared chunks, and their .d.ts      (npm)
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const define = { __OPENPUSH_VERSION__: JSON.stringify(pkg.version) };
const banner = `/* OpenPush Web SDK ${pkg.version} */`;

const cdnEntries = [
  { file: "openpush.js", entry: "src/cdn/openpush.ts" },
  { file: "openpush-prompts.js", entry: "src/prompts/entry.ts" },
  { file: "openpush-sw.js", entry: "src/worker/entry.ts" },
  { file: "openpush-compat.js", entry: "src/compat/entry.ts" },
  { file: "bridge/openpush.js", entry: "src/bridge/openpush.ts" },
  { file: "bridge/openpush-sw.js", entry: "src/worker/entry.ts" },
];

rmSync(resolve(root, "dist"), { recursive: true, force: true });

for (const { file, entry } of cdnEntries) {
  await build({
    root,
    configFile: false,
    logLevel: "warn",
    define,
    build: {
      outDir: "dist/cdn",
      emptyOutDir: false,
      target: "es2020",
      minify: true,
      sourcemap: false,
      copyPublicDir: false,
      rolldownOptions: {
        input: resolve(root, entry),
        output: { format: "iife", entryFileNames: file, postBanner: banner },
      },
    },
  });
}

// npm: ESM and CJS, each one build with several entries, so `@openpush/web` and its subpaths share
// one SDK instance through shared chunks. The CJS entries export only a default (`require` returns
// the object itself; see src/npm/cjs).
const npmBuilds = [
  {
    ext: "mjs",
    format: "es",
    exports: "named",
    entry: { index: "src/npm/index.ts", compat: "src/compat/npm.ts", prompts: "src/npm/prompts.ts" },
  },
  {
    ext: "cjs",
    format: "cjs",
    exports: "default",
    entry: { index: "src/npm/cjs/index.ts", compat: "src/npm/cjs/compat.ts", prompts: "src/npm/cjs/prompts.ts" },
  },
];
for (const { ext, format, exports, entry } of npmBuilds) {
  await build({
    root,
    configFile: false,
    logLevel: "warn",
    define,
    build: {
      outDir: "dist/npm",
      emptyOutDir: false,
      target: "es2020",
      minify: false,
      sourcemap: true,
      copyPublicDir: false,
      lib: {
        entry: Object.fromEntries(Object.entries(entry).map(([name, file]) => [name, resolve(root, file)])),
        formats: [format],
        fileName: (_format, name) => `${name}.${ext}`,
      },
      rolldownOptions: { output: { exports, chunkFileNames: `chunks/[name]-[hash].${ext}` } },
    },
  });
}

const types = [
  { out: "dist/npm/openpush.d.ts", entry: "src/npm/index.ts" },
  { out: "dist/npm/compat.d.ts", entry: "src/compat/npm.ts" },
  { out: "dist/npm/prompts.d.ts", entry: "src/npm/prompts.ts" },
];
for (const { out, entry } of types) {
  execFileSync(
    resolve(root, "node_modules/.bin/dts-bundle-generator"),
    ["--silent", "--no-check", "--project", "tsconfig.json", "-o", out, entry],
    { cwd: root, stdio: "inherit" },
  );
}

console.log(`Built OpenPush Web SDK ${pkg.version}`);
