import { describe, expect, it, vi } from "vitest";
import { allows, levelFromQuery } from "../src/log/levels";
import { Logger, LOG_PREFIX } from "../src/log/logger";
import { maskEmail, maskEndpoint, maskPhone, scrub } from "../src/log/redact";

describe("redaction", () => {
  const endpoint = "https://fcm.googleapis.com/fcm/send/dAbCdEfGh:APA91bHk-very-long-token-ending12345678";

  it("masks endpoints to host plus the last 8 characters", () => {
    expect(maskEndpoint(endpoint)).toBe("fcm.googleapis.com/…12345678");
  });

  it("masks emails to the first letter and domain, phones to the last 4 digits", () => {
    expect(maskEmail("jane.doe@example.com")).toBe("j…@example.com");
    expect(maskPhone("+44 7700 900123")).toBe("…0123");
  });

  it("scrubs secrets, endpoints, emails, phones and long tokens from a line", () => {
    const line = scrub(
      `key sdk_key_abcdef123456 sent ${endpoint} for jane.doe@example.com and +447700900123 with ${"A".repeat(64)}`,
      ["sdk_key_abcdef123456"],
    );
    expect(line).not.toContain("sdk_key_abcdef123456");
    expect(line).not.toContain("APA91b");
    expect(line).not.toContain("jane.doe");
    expect(line).not.toContain("7700900");
    expect(line).not.toContain("A".repeat(64));
    expect(line).toContain("fcm.googleapis.com/…12345678");
    expect(line).toContain("j…@example.com");
    expect(line).toContain("…0123");
  });

  it("leaves ordinary URLs and paths alone", () => {
    expect(scrub("registered /openpush/openpush-sw.js at https://play.example.com/openpush/")).toBe(
      "registered /openpush/openpush-sw.js at https://play.example.com/openpush/",
    );
  });
});

describe("Logger", () => {
  it("prefixes lines, filters by level and redacts what listeners get", () => {
    const sink = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const log = new Logger(sink, () => 42, "warn");
    log.addSecret("device-secret-value");
    const entries: unknown[] = [];
    log.addListener((e) => entries.push(e));

    log.info("hidden at warn");
    log.warn("secret device-secret-value here");
    expect(sink.info).not.toHaveBeenCalled();
    expect(sink.warn).toHaveBeenCalledWith(`${LOG_PREFIX} secret [hidden] here`);
    expect(entries).toEqual([{ level: "warn", message: "secret [hidden] here", at: 42 }]);

    log.setLevel("trace");
    log.trace("a request");
    expect(sink.debug).toHaveBeenCalledWith(`${LOG_PREFIX} a request`);
  });

  it("writes a once line only once", () => {
    const sink = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const log = new Logger(sink, () => 0);
    log.once("k", "warn", "first");
    log.once("k", "warn", "second");
    expect(sink.warn).toHaveBeenCalledTimes(1);
  });

  it("never throws when a listener throws", () => {
    const log = new Logger(undefined, () => 0, "error");
    log.addListener(() => {
      throw new Error("site bug");
    });
    expect(() => log.error("x")).not.toThrow();
  });
});

describe("levels", () => {
  it("reads ?openpush_debug=trace", () => {
    expect(levelFromQuery("?a=1&openpush_debug=trace")).toBe("trace");
    expect(levelFromQuery("?openpush_debug=loud")).toBeUndefined();
    expect(levelFromQuery("")).toBeUndefined();
  });

  it("orders levels", () => {
    expect(allows("warn", "error")).toBe(true);
    expect(allows("warn", "info")).toBe(false);
    expect(allows("none", "error")).toBe(false);
  });
});
