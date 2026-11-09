/// <reference types="node" />
/**
 * npm entries: the CommonJS default export is the object itself with the named exports on it,
 * `@openpush/web/compat` shares the one SDK instance, and `@openpush/web/prompts` registers the
 * prompt UI. The built-file checks run when `npm run build` has run.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { REF_USER_ID } from "../src/compat/names";
import { withNamed } from "../src/npm/cjs/named";

const built = existsSync(new URL("../dist/npm/index.cjs", import.meta.url));
const require = createRequire(import.meta.url);

describe("CommonJS default export", () => {
  it("withNamed puts the named exports on the default object, not enumerable", () => {
    const target = { a: 1 };
    const out = withNamed(target, { default: target, Extra: "x", a: 2 });
    expect(out).toBe(target);
    expect((out as Record<string, unknown>).Extra).toBe("x");
    expect((out as Record<string, unknown>).default).toBe(out);
    expect(out.a).toBe(1);
    expect(Object.keys(out)).toEqual(["a"]);
  });

  it.skipIf(!built)('require("@openpush/web") is the OpenPush object', () => {
    const op = require("../dist/npm/index.cjs");
    expect(typeof op.initialize).toBe("function");
    expect(op.default).toBe(op);
    expect(typeof op.OpenPushError).toBe("function");
    expect(Object.keys(op)).not.toContain("OpenPushError");
  });

  it.skipIf(!built)("the compat subpath is the compat object; prompts registers the prompt UI", () => {
    const compat = require("../dist/npm/compat.cjs");
    expect(typeof compat.init).toBe("function");
    expect(typeof compat.installGlobals).toBe("function");
    require("../dist/npm/prompts.cjs");
    expect(typeof (globalThis as { OpenPushPrompts?: { create?: unknown } }).OpenPushPrompts?.create).toBe("function");
  });

  it.skipIf(!built)("package.json exports every subpath", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(Object.keys(pkg.exports)).toEqual([".", "./compat", "./prompts", "./sw", "./package.json"]);
    expect(pkg.exports["./sw"]).toBe("./dist/cdn/openpush-sw.js");
    expect(pkg.private).toBe(true);
  });
});

describe.skipIf(!built)("ESM entries share one SDK instance", () => {
  it("compat wraps the same OpenPush object as the main entry", async () => {
    const main = await import("../dist/npm/index.mjs" as string);
    const compat = await import("../dist/npm/compat.mjs" as string);
    const internal = Symbol.for("openpush.internal");
    expect(main.default[internal]).toBeDefined();
    // A compat warning reaches a log listener added on the main entry's object: one runtime.
    const lines: string[] = [];
    main.default.Debug.addLogListener((entry: { message: string }) => lines.push(entry.message));
    expect(compat.default.User[REF_USER_ID]).toBeNull();
    expect(lines.some((line) => line.includes("OpenPush.User.externalId"))).toBe(true);
  });
});
