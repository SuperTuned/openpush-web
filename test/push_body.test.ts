import { describe, expect, it } from "vitest";
import {
  errorName,
  fingerprint,
  localeFields,
  moveFailedBody,
  REGISTRATION_KEYS,
  reportedBrowserName,
  subscriptionBody,
  subscriptionJson,
  tokenBody,
  type DeviceFields,
  type SubscriptionJson,
} from "../src/push/body";
import { AUTH, P256DH } from "./helpers/fake_push";

const SUB: SubscriptionJson = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc-12345678",
  expirationTime: null,
  keys: { p256dh: P256DH, auth: AUTH },
};

const DEVICE: DeviceFields = {
  browser: { name: "chrome", version: "131.0.0.0", os: "windows", os_version: "10.0", standalone: false },
  language: "en-GB",
  timezone: "Europe/London",
};

/** What actually goes on the wire. */
const wire = (body: Record<string, unknown>) => JSON.parse(JSON.stringify(body)) as Record<string, unknown>;

describe("registration body", () => {
  it("carries exactly the registration keys and nothing else, even with every option and contributor", () => {
    const body = wire(
      subscriptionBody({
        subscription: SUB,
        vapidKeyId: "k1",
        status: 1,
        device: { ...DEVICE, sdkWrapper: "react/2.0.0" },
        previous: { token: "https://fcm.googleapis.com/fcm/send/old-11112222", subscriptionId: "sub-1", deviceSecret: "secret-abcdef" },
        optIn: true,
        welcome: { enabled: true, title: "Site", message: "Thanks for subscribing", url: "https://site.example" },
        contributors: [
          () => ({ external_id: "user-1", tags: { level: "3" }, aliases: { crm: "c-1" }, verify_code: "123456" }),
          () => ({ ip: "1.2.3.4", location: "x" }) as never,
        ],
      }),
    );
    for (const key of Object.keys(body)) expect(REGISTRATION_KEYS as readonly string[]).toContain(key);
    expect(body).not.toHaveProperty("ip");
    expect(body).not.toHaveProperty("location");
    expect(body).not.toHaveProperty("token");
    expect(body).toMatchObject({
      platform: "web",
      subscription: SUB,
      vapid_key_id: "k1",
      browser: { name: "chrome", version: "131.0.0.0", os: "windows", os_version: "10.0", standalone: false },
      language: "en",
      timezone: "Europe/London",
      country: "GB",
      sdk_version: expect.stringMatching(/^web\/1\.1\./),
      sdk_wrapper: "react/2.0.0",
      status: 1,
      external_id: "user-1",
      tags: { level: "3" },
      aliases: { crm: "c-1" },
      verify_code: "123456",
      previous_token: "https://fcm.googleapis.com/fcm/send/old-11112222",
      subscription_id: "sub-1",
      device_secret: "secret-abcdef",
      opt_in: true,
      welcome: { enabled: true, title: "Site", message: "Thanks for subscribing", url: "https://site.example" },
    });
  });

  it("leaves the optional fields out when not given", () => {
    const body = wire(subscriptionBody({ subscription: SUB, status: 1, device: DEVICE }));
    expect(Object.keys(body).sort()).toEqual(
      ["browser", "country", "language", "platform", "sdk_version", "status", "subscription", "timezone"].sort(),
    );
  });

  it("sends opt_in only as true", () => {
    expect(subscriptionBody({ subscription: SUB, status: 1, device: DEVICE, optIn: false })).not.toHaveProperty("opt_in");
    expect(subscriptionBody({ subscription: SUB, status: 1, device: DEVICE, optIn: true }).opt_in).toBe(true);
  });

  it("sends the device secret for the row when there is no move", () => {
    expect(subscriptionBody({ subscription: SUB, status: 1, device: DEVICE, deviceSecret: "s3cret-value" }).device_secret).toBe("s3cret-value");
  });

  it("names other Chromium browsers chrome", () => {
    expect(reportedBrowserName("opera")).toBe("chrome");
    expect(reportedBrowserName("samsung")).toBe("chrome");
    expect(reportedBrowserName("edge")).toBe("edge");
    expect(reportedBrowserName("firefox")).toBe("firefox");
    expect(reportedBrowserName("safari")).toBe("safari");
  });

  it("reads language and country from the language tag, as v1 did", () => {
    expect(localeFields("en-GB")).toEqual({ language: "en", country: "GB" });
    expect(localeFields("pt_br")).toEqual({ language: "pt", country: "BR" });
    expect(localeFields("zh-Hant-TW")).toEqual({ language: "zh", country: "TW" });
    expect(localeFields("es-419")).toEqual({ language: "es", country: "419" });
    expect(localeFields("fr")).toEqual({ language: "fr" });
    expect(localeFields("")).toEqual({});
  });

  it("builds the subscription from toJSON and refuses one without keys", () => {
    expect(subscriptionJson({ toJSON: () => ({ endpoint: SUB.endpoint, keys: { p256dh: P256DH, auth: AUTH } }) })).toEqual(SUB);
    expect(() => subscriptionJson({ toJSON: () => ({ endpoint: SUB.endpoint }) })).toThrow();
  });
});

describe("token and move_failed bodies", () => {
  it("permission lost is {token, status: 0} with no opt_in and no subscription", () => {
    const body = wire(tokenBody(SUB.endpoint, 0, DEVICE, "secret-abcdef"));
    expect(body).toMatchObject({ platform: "web", token: SUB.endpoint, status: 0, device_secret: "secret-abcdef" });
    expect(body).not.toHaveProperty("opt_in");
    expect(body).not.toHaveProperty("subscription");
  });

  it("move_failed carries the proof and an error name the server accepts", () => {
    const body = moveFailedBody({ token: "fb:token", subscriptionId: "sub-1" }, "AbortError");
    expect(body).toEqual({
      platform: "web",
      previous_token: "fb:token",
      subscription_id: "sub-1",
      move_failed: { error: "AbortError" },
      sdk_version: expect.stringMatching(/^web\//),
    });
    expect(errorName(Object.assign(new Error("x"), { name: "Not Allowed Error!" }))).toBe("NotAllowedError");
    expect(errorName("")).toBe("UnknownError");
    expect(errorName("a".repeat(100))).toHaveLength(64);
  });
});

describe("fingerprint", () => {
  it("changes with the endpoint, keys, status or sent fields, not with opt_in or the proof", () => {
    const base = subscriptionBody({ subscription: SUB, status: 1, device: DEVICE });
    const same = subscriptionBody({ subscription: SUB, status: 1, device: DEVICE, optIn: true, previous: { token: "old" } });
    expect(fingerprint(same)).toBe(fingerprint(base));
    expect(fingerprint(subscriptionBody({ subscription: SUB, status: -2, device: DEVICE }))).not.toBe(fingerprint(base));
    expect(fingerprint(subscriptionBody({ subscription: { ...SUB, endpoint: `${SUB.endpoint}x` }, status: 1, device: DEVICE }))).not.toBe(
      fingerprint(base),
    );
    expect(fingerprint(subscriptionBody({ subscription: SUB, status: 1, device: { ...DEVICE, language: "fr-FR" } }))).not.toBe(fingerprint(base));
  });
});
