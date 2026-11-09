/// <reference types="node" />
/** The worker CLI, run as a site owner runs it, against temp folders. */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("npx @openpush/web worker [dir]", () => {
  const cli = join(root, "bin/openpush-web.mjs");
  const line = `importScripts("https://app.openpush.ai/sdk/web/v2/openpush-sw.js");\n`;

  it("writes openpush-sw.js with one importScripts line of the v2 channel path", () => {
    const dir = mkdtempSync(join(tmpdir(), "op-site-"));
    execFileSync(process.execPath, [cli, "worker", "public"], { cwd: dir });
    expect(readFileSync(join(dir, "public/openpush-sw.js"), "utf8")).toBe(line);
  });

  it("defaults to public/ when it exists, else the current folder", () => {
    const withPublic = mkdtempSync(join(tmpdir(), "op-site-"));
    mkdirSync(join(withPublic, "public"));
    execFileSync(process.execPath, [cli, "worker"], { cwd: withPublic });
    expect(existsSync(join(withPublic, "public/openpush-sw.js"))).toBe(true);
    const bare = mkdtempSync(join(tmpdir(), "op-site-"));
    execFileSync(process.execPath, [cli, "worker"], { cwd: bare });
    expect(existsSync(join(bare, "openpush-sw.js"))).toBe(true);
  });

  it("uses --origin for a self-hosted server", () => {
    const dir = mkdtempSync(join(tmpdir(), "op-site-"));
    execFileSync(process.execPath, [cli, "worker", ".", "--origin", "https://push.example.com/anything"], { cwd: dir });
    expect(readFileSync(join(dir, "openpush-sw.js"), "utf8")).toBe(`importScripts("https://push.example.com/sdk/web/v2/openpush-sw.js");\n`);
  });

  it("does not replace a different file without --force", () => {
    const dir = mkdtempSync(join(tmpdir(), "op-site-"));
    writeFileSync(join(dir, "openpush-sw.js"), "// the site's own worker\n");
    const run = spawnSync(process.execPath, [cli, "worker", "."], { cwd: dir, encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(readFileSync(join(dir, "openpush-sw.js"), "utf8")).toBe("// the site's own worker\n");
    execFileSync(process.execPath, [cli, "worker", ".", "--force"], { cwd: dir });
    expect(readFileSync(join(dir, "openpush-sw.js"), "utf8")).toBe(line);
  });

  it("refuses an unknown command or an http origin", () => {
    expect(spawnSync(process.execPath, [cli, "build"], { encoding: "utf8" }).status).toBe(1);
    const dir = mkdtempSync(join(tmpdir(), "op-site-"));
    expect(spawnSync(process.execPath, [cli, "worker", ".", "--origin", "http://push.example.com"], { cwd: dir, encoding: "utf8" }).status).toBe(1);
  });
});
