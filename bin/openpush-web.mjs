#!/usr/bin/env node
// `npx @openpush/web worker [dir]`: writes the site's one-line worker file, `openpush-sw.js`,
// into `dir` (default: `public` when it exists, else the current folder).
//
// Options:
//   --origin <url>   where the SDK files are served (default https://app.openpush.ai; a self-hosted
//                    OpenPush server uses its own address)
//   --force          replace an existing openpush-sw.js that has other contents
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = "openpush-sw.js";
const DEFAULT_ORIGIN = "https://app.openpush.ai";
// The moving channel path the server serves the newest release on. It is not the package's major
// version: `/sdk/web/v1/` is the earlier Firebase-based web SDK.
const CHANNEL = "v2";

/** The file's one line: `importScripts` of the moving channel path (`/sdk/web/v2/`). */
export function workerSource(origin = DEFAULT_ORIGIN) {
  const base = new URL(origin).origin;
  return `importScripts("${base}/sdk/web/${CHANNEL}/${FILE}");\n`;
}

/** Writes the file; returns what happened: "written", "unchanged" or "exists". */
export function writeWorker(dir, { origin = DEFAULT_ORIGIN, force = false } = {}) {
  const target = join(dir, FILE);
  const source = workerSource(origin);
  if (existsSync(target)) {
    const current = readFileSync(target, "utf8");
    if (current === source) return { state: "unchanged", path: target };
    if (!force) return { state: "exists", path: target };
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(target, source);
  return { state: "written", path: target };
}

function defaultDir(cwd) {
  const pub = join(cwd, "public");
  return existsSync(pub) && statSync(pub).isDirectory() ? pub : cwd;
}

function usage() {
  return "Usage: npx @openpush/web worker [dir] [--origin <url>] [--force]";
}

export function main(argv, cwd = process.cwd(), out = console) {
  const args = [...argv];
  const command = args.shift();
  if (command !== "worker") {
    out.error(usage());
    return 1;
  }
  let dir;
  let origin = DEFAULT_ORIGIN;
  let force = false;
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--force") force = true;
    else if (arg === "--origin") origin = args.shift() ?? "";
    else if (arg.startsWith("--origin=")) origin = arg.slice("--origin=".length);
    else if (arg.startsWith("--")) {
      out.error(`Unknown option ${arg}\n${usage()}`);
      return 1;
    } else dir = arg;
  }
  try {
    if (new URL(origin).protocol !== "https:" && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(new URL(origin).origin)) {
      out.error("--origin must be an https address");
      return 1;
    }
  } catch {
    out.error("--origin must be an https address");
    return 1;
  }
  const folder = resolve(cwd, dir ?? defaultDir(cwd));
  const result = writeWorker(folder, { origin, force });
  if (result.state === "exists") {
    out.error(`${result.path} already exists with other contents. Run again with --force to replace it.`);
    return 1;
  }
  out.log(result.state === "unchanged" ? `${result.path} is already up to date.` : `Wrote ${result.path}`);
  out.log("Serve it from your site's root (https://your-site/openpush-sw.js), or set serviceWorkerPath to where it is.");
  return 0;
}

function isMain() {
  try {
    // npx runs the file through a symlink in node_modules/.bin.
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = main(process.argv.slice(2));
