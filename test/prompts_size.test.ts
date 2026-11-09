/// <reference types="node" />
/** Size budgets: the prompt file ≤ 25 KB gzip; `openpush.js` keeps only a small loader (≤ 30 KB). */
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const prompts = new URL("../dist/cdn/openpush-prompts.js", import.meta.url);
const core = new URL("../dist/cdn/openpush.js", import.meta.url);
const gz = (file: URL): number => gzipSync(readFileSync(file), { level: 9 }).length;

describe.skipIf(!existsSync(prompts) || !existsSync(core))("built sizes", () => {
  it("openpush-prompts.js is within 25 KB gzip", () => {
    expect(gz(prompts)).toBeLessThanOrEqual(25 * 1024);
  });
  it("openpush.js is within 30 KB gzip and has no prompt UI in it", () => {
    expect(gz(core)).toBeLessThanOrEqual(30 * 1024);
    const text = readFileSync(core, "utf8");
    expect(text).not.toContain("Notification settings");
    expect(text).not.toContain("--op-ink");
  });
  it("the prompt file uses no eval and no inline handlers", () => {
    const text = readFileSync(prompts, "utf8");
    expect(text).not.toMatch(/\beval\(|new Function\(|innerHTML|insertAdjacentHTML|setAttribute\(["'`]on/);
  });
});
