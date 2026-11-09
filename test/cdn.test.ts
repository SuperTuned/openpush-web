// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { ERROR_CODES, OpenPushError } from "../src/errors";

describe("script-tag build", () => {
  it("defines window.OpenPush and drains OpenPushDeferred with the SDK object", async () => {
    const seen: unknown[] = [];
    const w = window as unknown as { OpenPush?: { version: string; initialize: unknown; init: unknown }; OpenPushDeferred?: unknown };
    w.OpenPushDeferred = [(sdk: unknown) => seen.push(sdk)];
    await import("../src/cdn/openpush");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(typeof w.OpenPush?.initialize).toBe("function");
    // `init` is v1's name and resolves with v1's shape, so it is its own function.
    expect(typeof w.OpenPush?.init).toBe("function");
    expect(w.OpenPush?.version).toMatch(/^1\.2\./);
    expect(seen).toEqual([w.OpenPush]);
    expect(Array.isArray(w.OpenPushDeferred)).toBe(false);
  });
});

describe("errors", () => {
  it("carries code, message and detail", () => {
    const error = new OpenPushError("worker_registration_failed", "no", { reason: "not_found" });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "OpenPushError", code: "worker_registration_failed", detail: { reason: "not_found" } });
    expect(ERROR_CODES).toHaveLength(15);
  });
});
