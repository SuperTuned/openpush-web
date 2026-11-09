// Fails when a built file is over its gzip budget.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KB = 1024;
const budgets = {
  "dist/cdn/openpush.js": 30 * KB,
  "dist/cdn/openpush-prompts.js": 25 * KB,
  "dist/cdn/openpush-sw.js": 15 * KB,
  "dist/cdn/openpush-compat.js": 8 * KB,
  // The v1 bridge keeps the same budgets as the files it stands in for.
  "dist/cdn/bridge/openpush.js": 30 * KB,
  "dist/cdn/bridge/openpush-sw.js": 15 * KB,
};

let failed = false;
for (const [file, budget] of Object.entries(budgets)) {
  const path = resolve(root, file);
  if (!existsSync(path)) {
    console.error(`missing  ${file}`);
    failed = true;
    continue;
  }
  const raw = readFileSync(path);
  const gz = gzipSync(raw, { level: 9 }).length;
  const ok = gz <= budget;
  if (!ok) failed = true;
  console.log(
    `${ok ? "ok  " : "OVER"}  ${file.padEnd(32)} ${(raw.length / KB).toFixed(2).padStart(7)} KB raw  ${(gz / KB).toFixed(2).padStart(6)} KB gzip  (budget ${budget / KB} KB)`,
  );
}
if (failed) {
  console.error("Size check failed.");
  process.exit(1);
}
