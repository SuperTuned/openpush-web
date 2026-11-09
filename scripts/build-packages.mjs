// Builds the framework wrappers into packages/<name>/dist: ES modules and types, one file per
// source file, so React's "use client" stays at the top of the provider. Angular uses the Angular
// compiler in partial mode (what libraries ship). Run after scripts/build.mjs: the wrappers'
// types point at dist/npm/openpush.d.ts. Each package also gets a copy of the repository's LICENSE
// and NOTICE, so its npm tarball carries them.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name) => resolve(root, "node_modules/.bin", name);

if (!existsSync(resolve(root, "dist/npm/openpush.d.ts"))) {
  console.error("dist/npm/openpush.d.ts is missing: run scripts/build.mjs first.");
  process.exit(1);
}

const packages = [
  { name: "react", compiler: "tsc" },
  { name: "vue", compiler: "tsc" },
  { name: "angular", compiler: "ngc" },
];

for (const { name, compiler } of packages) {
  const dir = resolve(root, "packages", name);
  rmSync(resolve(dir, "dist"), { recursive: true, force: true });
  execFileSync(bin(compiler), ["-p", resolve(dir, "tsconfig.build.json")], { cwd: root, stdio: "inherit" });
  for (const file of ["LICENSE", "NOTICE"]) copyFileSync(resolve(root, file), resolve(dir, file));
  console.log(`Built @openpush/${name}`);
}
