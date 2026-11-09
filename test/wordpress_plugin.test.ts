/// <reference types="node" />
/**
 * The WordPress plugin: its worker file is the line the SDK's worker CLI writes for the
 * OpenPush server, its PHP builds the same line and the same SDK paths, and the zip holds only the
 * plugin's runtime files.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PRODUCTION_API_ORIGIN } from "../src/config/build";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = join(root, "integrations", "wordpress", "openpush");
const php = (file: string) => readFileSync(join(plugin, "includes", file), "utf8");

function cliWorker(origin: string): string {
  const dir = mkdtempSync(join(tmpdir(), "op-wp-worker-"));
  const run = spawnSync(process.execPath, [join(root, "bin", "openpush-web.mjs"), "worker", dir, "--origin", origin], { encoding: "utf8" });
  expect(run.status).toBe(0);
  return readFileSync(join(dir, "openpush-sw.js"), "utf8");
}

/** File names in a zip, read from its central directory. */
function zipEntries(archive: Buffer): Map<string, Buffer> {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const size = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const dataStart = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    entries.set(name, inflateRawSync(archive.subarray(dataStart, dataStart + size)));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

describe("WordPress plugin", () => {
  it("ships the worker file the CLI writes for the OpenPush server", () => {
    const shipped = readFileSync(join(plugin, "worker", "openpush-sw.js"), "utf8");
    expect(shipped).toBe(cliWorker(PRODUCTION_API_ORIGIN));
  });

  it("builds the same worker line in PHP for any server, and uses the SDK's v2 paths", () => {
    const worker = php("class-openpush-worker.php");
    expect(worker).toContain(`const SDK_PATH = '/sdk/web/v2/openpush-sw.js';`);
    expect(worker).toContain(`return 'importScripts("' . $server . self::SDK_PATH . '");' . "\\n";`);
    // The PHP body for a self-hosted server equals the CLI's output for it.
    const body = (server: string) => `importScripts("${server}/sdk/web/v2/openpush-sw.js");\n`;
    expect(body("https://push.example.org")).toBe(cliWorker("https://push.example.org"));
    expect(php("class-openpush-snippet.php")).toContain(`const SDK_PATH = '/sdk/web/v2/openpush.js';`);
  });

  it("defaults to the production API origin", () => {
    expect(php("class-openpush-settings.php")).toContain(`const DEFAULT_SERVER = '${PRODUCTION_API_ORIGIN}';`);
  });

  it("zips only the runtime files under openpush/", async () => {
    // @ts-expect-error -- a plain .mjs script without types.
    const { buildZip } = await import("../scripts/build-wordpress.mjs");
    const target = join(mkdtempSync(join(tmpdir(), "op-wp-zip-")), "openpush-wordpress.zip");
    const result = buildZip(plugin, target) as { files: number };
    const entries = zipEntries(readFileSync(target));
    const names = [...entries.keys()];
    expect(names.length).toBe(result.files);
    expect(names).toContain("openpush/openpush.php");
    expect(names).toContain("openpush/uninstall.php");
    expect(names).toContain("openpush/readme.txt");
    expect(names).toContain("openpush/LICENSE");
    expect(names).toContain("openpush/worker/openpush-sw.js");
    expect(names.every((name) => name.startsWith("openpush/"))).toBe(true);
    expect(names.some((name) => /\/(tests|vendor)\/|composer\.|phpcs|phpunit/.test(name))).toBe(false);
    expect(entries.get("openpush/worker/openpush-sw.js")?.toString("utf8")).toBe(cliWorker(PRODUCTION_API_ORIGIN));
  });

  it("names no other push product", () => {
    const sources = ["openpush.php", "uninstall.php", "readme.txt"].map((file) => readFileSync(join(plugin, file), "utf8"));
    for (const file of ["class-openpush-admin.php", "class-openpush-connection.php", "class-openpush-frontend.php", "class-openpush-publish.php", "class-openpush-push-payload.php", "class-openpush-settings.php", "class-openpush-snippet.php", "class-openpush-worker.php"]) {
      sources.push(php(file));
    }
    for (const text of sources) expect(text).not.toMatch(/one\s?signal/i);
  });
});
