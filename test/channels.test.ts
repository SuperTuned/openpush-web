/**
 * Email, SMS and WhatsApp on the user: separate registrations with the address as
 * token, owned by the user logged in at the call; removal sends `status: -2`.
 */
import { describe, expect, it } from "vitest";
import { emailAddress, phoneNumber } from "../src/user/validate";
import { jsonResponse } from "./helpers/fake_platform";
import { start, type Request } from "./helpers/sdk_harness";

const channelBodies = (bodies: Record<string, unknown>[]) => bodies.filter((b) => b.platform !== "web");

describe("addEmail / removeEmail", () => {
  it("registers platform email with the cleaned address and the logged-in user", async () => {
    const s = await start();
    await s.api.login("player-1", "hash-1");
    s.reset();
    expect(s.api.User.addEmail("  Ada@Example.COM ")).toBe(true);
    await s.settle();
    expect(channelBodies(s.sent("/subscriptions"))).toEqual([
      { platform: "email", token: "ada@example.com", external_id: "player-1", external_id_auth_hash: "hash-1" },
    ]);
  });

  it("removeEmail sends status -2", async () => {
    const s = await start();
    s.reset();
    expect(s.api.User.removeEmail("ada@example.com")).toBe(true);
    await s.settle();
    expect(channelBodies(s.sent("/subscriptions"))).toEqual([{ platform: "email", token: "ada@example.com", status: -2 }]);
  });

  it("an invalid address returns false and sends nothing", async () => {
    const s = await start();
    s.reset();
    for (const bad of ["", "no-at", "a@b", "a@@b.com", "two words@x.test", 42]) {
      expect(s.api.User.addEmail(bad as string)).toBe(false);
    }
    await s.settle();
    expect(channelBodies(s.sent("/subscriptions"))).toHaveLength(0);
  });

  it("before initialize returns false", async () => {
    const s = await start({ init: false });
    expect(s.api.User.addEmail("ada@example.com")).toBe(false);
  });

  it("carries the consent wording the person saw (prompts)", async () => {
    const s = await start();
    s.reset();
    s.api.User.addEmail("ada@example.com", { text: "Send me news", origin: "https://play.example.com" });
    await s.settle();
    expect(channelBodies(s.sent("/subscriptions"))[0]).toMatchObject({ consent: { text: "Send me news", origin: "https://play.example.com" } });
  });

  it("a suppressed address (-2) is logged without the full address", async () => {
    const s = await start({
      respond: (req: Request) => (req.body.platform === "email" ? jsonResponse({ id: "e-1", status: -2, status_name: "Unsubscribed", created: false }) : undefined),
    });
    s.fake.sink.info.mockClear();
    s.runtime.log.setLevel("info");
    s.api.User.addEmail("ada@example.com");
    await s.settle();
    const lines = s.fake.sink.info.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("unsubscribe list"))).toBe(true);
    expect(lines.join(" ")).not.toContain("ada@example.com");
  });
});

describe("addSms / addWhatsApp", () => {
  it("registers the E.164 number without a status (not verified until a phone code proves it)", async () => {
    const s = await start();
    s.reset();
    expect(s.api.User.addSms("+1 (415) 555-0123")).toBe(true);
    expect(s.api.User.addWhatsApp("0014155550123")).toBe(true);
    await s.settle();
    expect(channelBodies(s.sent("/subscriptions"))).toEqual([
      { platform: "sms", token: "+14155550123" },
      { platform: "whatsapp", token: "+14155550123" },
    ]);
  });

  it("removeSms and removeWhatsApp send status -2", async () => {
    const s = await start();
    s.reset();
    s.api.User.removeSms("+14155550123");
    s.api.User.removeWhatsApp("+14155550123");
    await s.settle();
    expect(channelBodies(s.sent("/subscriptions")).map((b) => b.status)).toEqual([-2, -2]);
  });

  it("a later write for the same number replaces one still waiting", async () => {
    const s = await start();
    s.reset();
    // Both queued before the queue sends: the remove replaces the add.
    s.runtime.context?.queue.stop();
    s.api.User.addSms("+14155550123");
    s.api.User.removeSms("+14155550123");
    await new Promise((r) => setTimeout(r, 20));
    s.runtime.context?.queue.start();
    await s.settle();
    expect(channelBodies(s.sent("/subscriptions"))).toEqual([{ platform: "sms", token: "+14155550123", status: -2 }]);
  });

  it("an invalid number returns false", async () => {
    const s = await start();
    for (const bad of ["415", "+0123456789", "+1415555012+3", "+1234567890123456"]) expect(s.api.User.addSms(bad)).toBe(false);
  });
});

describe("address rules", () => {
  it("emails are trimmed and lower-cased", () => {
    expect(emailAddress(" A.B@Example.COM ")).toBe("a.b@example.com");
    expect(emailAddress(`${"a".repeat(250)}@x.test`)).toBeUndefined();
  });

  it("numbers are normalised as the server does", () => {
    expect(phoneNumber("+1-415-555-0123")).toBe("+14155550123");
    expect(phoneNumber("0014155550123")).toBe("+14155550123");
    expect(phoneNumber("+44 20 7946 0958")).toBe("+442079460958");
    expect(phoneNumber("4155550123")).toBeUndefined();
  });
});
