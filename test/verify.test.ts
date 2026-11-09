/** `OpenPush.Verify` over the public phone-code routes. */
import { describe, expect, it } from "vitest";
import { jsonResponse } from "./helpers/fake_platform";
import { start, type Request } from "./helpers/sdk_harness";

describe("Verify.start / check / resend", () => {
  it("start posts {to, channel, locale} and returns the verification without the number", async () => {
    const s = await start();
    s.reset();
    const v = await s.api.Verify.start("+1 (415) 555-0123", "sms", "fr");
    expect(s.requests()).toEqual([{ path: "/v1/apps/app-1/verify", body: { to: "+14155550123", channel: "sms", locale: "fr" } }]);
    expect(v).toEqual({ id: "ver-1", maskedNumber: "+1••••••0123", channel: "sms", status: "pending", attempts: 0, expiresAt: 1_900_000_000 });
    expect(JSON.stringify(v)).not.toContain("4155550123");
  });

  it("check and resend send the same number with the code or channel", async () => {
    const s = await start();
    const v = await s.api.Verify.start("+14155550123");
    s.reset();
    const checked = await s.api.Verify.check(v, " 482913 ");
    await s.api.Verify.resend(v, "call");
    expect(s.requests()).toEqual([
      { path: "/v1/apps/app-1/verify/ver-1/check", body: { to: "+14155550123", code: "482913" } },
      { path: "/v1/apps/app-1/verify/ver-1/resend", body: { to: "+14155550123", channel: "call" } },
    ]);
    expect(checked.status).toBe("approved");
  });

  it("start defaults to channel auto; resend defaults to a call", async () => {
    const s = await start();
    s.reset();
    const v = await s.api.Verify.start("+14155550123");
    await s.api.Verify.resend(v);
    expect(s.requests().map((r) => r.body.channel)).toEqual(["auto", "call"]);
  });

  it("an invalid number, code, channel or verification is invalid_argument with no request", async () => {
    const s = await start();
    s.reset();
    await expect(s.api.Verify.start("415")).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(s.api.Verify.start("+14155550123", "pigeon" as "sms")).rejects.toMatchObject({ code: "invalid_argument" });
    const v = await s.api.Verify.start("+14155550123");
    s.reset();
    await expect(s.api.Verify.check(v, "abc")).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(s.api.Verify.check({ ...v }, "123456")).rejects.toMatchObject({ code: "invalid_argument" });
    expect(s.requests()).toHaveLength(0);
  });

  it("server refusals keep the server's reason", async () => {
    const answers: Record<string, Response> = {
      "+14155550111": jsonResponse({ detail: { code: "opted_out", message: "This number opted out" } }, 409),
      "+14155550122": jsonResponse({ detail: { code: "rate_limited", message: "Too many codes" } }, 429),
      "+14155550133": jsonResponse({ detail: "boom" }, 503),
    };
    const s = await start({ respond: (req: Request) => (req.path.endsWith("/verify") ? answers[String(req.body.to)] : undefined) });
    await expect(s.api.Verify.start("+14155550111")).rejects.toMatchObject({ code: "invalid_argument", detail: { reason: "opted_out", status: 409 } });
    await expect(s.api.Verify.start("+14155550122")).rejects.toMatchObject({ code: "rate_limited", detail: { reason: "rate_limited" } });
    await expect(s.api.Verify.start("+14155550133")).rejects.toMatchObject({ code: "network" });
  });

  it("before initialize rejects with not_initialized", async () => {
    const s = await start({ init: false });
    await expect(s.api.Verify.start("+14155550123")).rejects.toMatchObject({ code: "not_initialized" });
  });
});
