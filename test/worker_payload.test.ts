// `fixtures/web_push_payload.json` is the push payload format the OpenPush server sends to web
// browsers. Keep it in step with the server when that format changes.
import { describe, expect, it } from "vitest";
import type { CfgRow } from "../src/storage/types";
import { displayFor, fallbackDisplay, plainDisplay, requireInteraction, SENT_AT_KEY } from "../src/worker/display";
import { buildNotification, customData, isOpenPushMap, parsePush, readButtons, titleFor, type PushMap } from "../src/worker/payload";
import { SITE } from "./helpers/fake_platform";
import { BASE_CFG, opPush } from "./helpers/fake_worker";
import fixtureJson from "./fixtures/web_push_payload.json";

const fixture = fixtureJson as PushMap;
const HOST = new URL(SITE).hostname;

function data(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { text: () => text };
}

/** FCM data values are strings. */
function asStrings(map: PushMap): Record<string, string> {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
}

function notificationOf(map: PushMap, cfg: CfgRow | undefined = BASE_CFG) {
  return buildNotification(map, cfg, SITE, HOST, 1_000);
}

describe("payload normalisation with the shared fixture", () => {
  it("reads a direct push as the map itself", () => {
    const parsed = parsePush(data(fixture));
    expect(parsed).toEqual({ kind: "map", map: fixture, envelope: "direct" });
  });

  it("unwraps a Firebase envelope (data plus from, fcmMessageId or collapse_key)", () => {
    const strings = asStrings(fixture);
    for (const extra of [{ from: "1234" }, { fcmMessageId: "abc" }, { collapse_key: "k" }]) {
      const parsed = parsePush(data({ data: strings, priority: "high", ...extra }));
      expect(parsed).toEqual({ kind: "map", map: strings, envelope: "firebase" });
    }
  });

  it("does not unwrap a direct map that only has a custom `data` key", () => {
    const map = { ...fixture, data: { a: 1 } };
    expect(parsePush(data(map))).toMatchObject({ envelope: "direct", map });
  });

  it("classifies empty, malformed and raw data", () => {
    expect(parsePush(null)).toEqual({ kind: "empty" });
    expect(parsePush(data(""))).toEqual({ kind: "empty" });
    expect(parsePush(data("{not json"))).toEqual({ kind: "malformed" });
    expect(parsePush(data("plain text"))).toEqual({ kind: "malformed" });
    expect(parsePush(data('"a string"'))).toEqual({ kind: "raw" });
    expect(parsePush(data("[1,2]"))).toEqual({ kind: "raw" });
  });

  it("treats a map as OpenPush's only with op_v or the message id key", () => {
    expect(isOpenPushMap(fixture)).toBe(true);
    expect(isOpenPushMap({ op_v: "2" })).toBe(true);
    expect(isOpenPushMap({ op_message_id: "m1" })).toBe(true);
    expect(isOpenPushMap({ title: "Hi", body: "x" })).toBe(false);
    expect(isOpenPushMap({ op_v: "" })).toBe(false);
  });

  it("builds the notification object from the fixture, direct and Firebase alike", () => {
    const expected = {
      id: "msg_fixture",
      title: "Spring sale",
      body: "Everything 20% off today",
      icon: "https://cdn.example.com/icon.png",
      image: "https://cdn.example.com/large.png",
      badge: "https://cdn.example.com/badge.png",
      url: "https://example.com/sale",
      // `op_web_buttons` items are `{id, label, url?, icon?}`: label → title, a relative url resolves on the site.
      buttons: [
        { id: "shop", title: "Shop now", url: "https://example.com/shop", icon: "https://cdn.example.com/cart.png" },
        { id: "b2", title: "Later", url: `${SITE}/later?op_open=0` },
      ],
      // `op_web_topic` wins over `op_web_tag` for the notification object.
      topic: "spring-sale",
      data: { campaign: "spring" },
      receivedAt: 1_000,
    };
    expect(notificationOf(fixture)).toEqual(expected);
    const envelope = parsePush(data({ data: asStrings(fixture), from: "1234" }));
    if (envelope.kind !== "map") throw new Error("expected a map");
    expect(notificationOf(envelope.map)).toEqual(expected);
  });

  it("keeps only non-OpenPush keys as custom data", () => {
    expect(customData({ title: "t", body: "b", deep_link: "/x", image_url: "i", op_v: "2", op_actions: "[]", level: "7", nested: { a: 1 } })).toEqual({
      level: "7",
      nested: { a: 1 },
    });
  });

  it("handles every key being absent", () => {
    // No stored cfg: the title falls back to the host. (A default parameter would turn
    // `undefined` into BASE_CFG, so this calls buildNotification directly.)
    const n = buildNotification({ op_v: "2" }, undefined, SITE, HOST, 1_000);
    expect(n).toMatchObject({ id: "", title: HOST, body: "", icon: null, image: null, badge: null, url: `${SITE}/`, buttons: [], topic: null, data: {} });
    // With a cfg that has a site name, the title is the site name.
    expect(notificationOf({ op_v: "2" }).title).toBe("Example Play");
  });
});

describe("title defaults", () => {
  it("uses the title, else defaultTitle, else the site name, else the host; never empty", () => {
    expect(titleFor({ title: "T" }, BASE_CFG, HOST)).toBe("T");
    expect(titleFor({ title: "  " }, { ...BASE_CFG, defaultTitle: "Default" }, HOST)).toBe("Default");
    expect(titleFor({}, { ...BASE_CFG, defaultTitle: "" }, HOST)).toBe("Example Play");
    expect(titleFor({}, {}, HOST)).toBe(HOST);
    expect(titleFor({}, undefined, "")).not.toBe("");
  });
});

describe("buttons", () => {
  const buttons = JSON.stringify([
    { id: "yes", label: "Yes", url: "/yes", icon: "https://cdn.example.com/yes.png" },
    { label: "Later", url: "https://example.com/later" },
    { id: "third", label: "Third" },
  ]);

  it("reads at most 2 buttons from op_web_buttons, as JSON text or a list", () => {
    expect(readButtons(buttons).map((b) => b.id)).toEqual(["yes", "b2"]);
    expect(readButtons(JSON.parse(buttons)).map((b) => b.label)).toEqual(["Yes", "Later"]);
    expect(readButtons("not json")).toEqual([]);
    expect(readButtons([{ id: "x" }, { label: "Ok" }]).map((b) => b.id)).toEqual(["b1"]);
  });

  it("ignores op_actions", () => {
    const n = notificationOf(opPush({ op_actions: JSON.stringify([{ id: "open", label: "Open", url: "/open" }]) }));
    expect(n.buttons).toEqual([]);
    expect(displayFor(opPush({ op_actions: "[]" }), n, BASE_CFG).options.actions).toBeUndefined();
  });

  it("shows buttons as actions with an icon only when set, and keeps their links in data.buttons", () => {
    const map = opPush({ op_web_buttons: buttons });
    const n = notificationOf(map);
    const { options } = displayFor(map, n, BASE_CFG);
    expect(options.actions).toEqual([
      { action: "yes", title: "Yes", icon: "https://cdn.example.com/yes.png" },
      { action: "b2", title: "Later" },
    ]);
    expect((options.data as { buttons: unknown }).buttons).toEqual([
      { id: "yes", title: "Yes", url: `${SITE}/yes`, icon: "https://cdn.example.com/yes.png" },
      { id: "b2", title: "Later", url: "https://example.com/later" },
    ]);
  });

  it("gives a button without a link the push's link", () => {
    const map = opPush({ op_web_buttons: [{ id: "a", label: "A" }] });
    expect(notificationOf(map).buttons[0]?.url).toBe(`${SITE}/sale`);
  });

  it("caps actions at the browser's maxActions", () => {
    const map = opPush({ op_web_buttons: buttons });
    expect(displayFor(map, notificationOf(map), BASE_CFG, 1).options.actions).toHaveLength(1);
    expect(displayFor(map, notificationOf(map), BASE_CFG, 0).options.actions).toBeUndefined();
  });
});

describe("display fields", () => {
  it("maps the fixture to the notification options", () => {
    const { title, options } = displayFor(fixture, notificationOf(fixture), BASE_CFG);
    expect(title).toBe("Spring sale");
    expect(options).toMatchObject({
      body: "Everything 20% off today",
      icon: "https://cdn.example.com/icon.png",
      image: "https://cdn.example.com/large.png",
      badge: "https://cdn.example.com/badge.png",
      // `op_web_tag` wins over `op_web_topic` for the display tag.
      tag: "sale",
      renotify: true,
      requireInteraction: true,
      silent: true,
      actions: [
        { action: "shop", title: "Shop now", icon: "https://cdn.example.com/cart.png" },
        { action: "b2", title: "Later" },
      ],
    });
    expect(options.data).toEqual({
      op: "openpush",
      mid: "msg_fixture",
      url: "https://example.com/sale",
      buttons: [
        { id: "shop", title: "Shop now", url: "https://example.com/shop", icon: "https://cdn.example.com/cart.png" },
        { id: "b2", title: "Later", url: `${SITE}/later?op_open=0` },
      ],
      topic: "spring-sale",
      custom: { campaign: "spring" },
      receivedAt: 1_000,
    });
  });

  it("requireInteraction: '1' → true, '0' → false, absent → the site's Keep on screen (default on)", () => {
    expect(requireInteraction({ op_web_require_interaction: "1" }, { keepOnScreen: false })).toBe(true);
    expect(requireInteraction({ op_web_require_interaction: "0" }, { keepOnScreen: true })).toBe(false);
    expect(requireInteraction({}, { keepOnScreen: false })).toBe(false);
    expect(requireInteraction({}, { keepOnScreen: true })).toBe(true);
    expect(requireInteraction({}, undefined)).toBe(true);
    expect(requireInteraction({}, {})).toBe(true);
  });

  it("tag: op_web_tag, else op_web_topic, else the message id; renotify only with a tag", () => {
    const tagOf = (map: PushMap) => displayFor(map, notificationOf(map), BASE_CFG).options;
    expect(tagOf(opPush({ op_web_tag: "t", op_web_topic: "p" })).tag).toBe("t");
    expect(tagOf(opPush({ op_web_topic: "p" })).tag).toBe("p");
    expect(tagOf(opPush()).tag).toBe("msg_1");
    const untagged = tagOf({ op_v: "2", title: "x", op_web_renotify: "1" });
    expect(untagged.tag).toBeUndefined();
    expect(untagged.renotify).toBeUndefined();
    expect(tagOf(opPush({ op_web_renotify: "1" })).renotify).toBe(true);
    expect(tagOf(opPush()).renotify).toBe(false);
  });

  it("icon falls back to the site icon; silent from op_web_silent; timestamp from the send time", () => {
    const map = opPush({ op_web_silent: "1", [SENT_AT_KEY]: "1700000000" });
    const { options } = displayFor(map, notificationOf(map), BASE_CFG);
    expect(options.icon).toBe(`${SITE}/icon.png`);
    expect(options.silent).toBe(true);
    expect(options.timestamp).toBe(1_700_000_000_000);
    expect(displayFor(opPush(), notificationOf(opPush()), BASE_CFG).options.timestamp).toBeUndefined();
  });

  it("the plain fallback drops the options a browser may refuse", () => {
    const map = opPush({ op_web_buttons: [{ label: "A" }], op_web_image: "https://cdn.example.com/i.png" });
    const plain = plainDisplay(displayFor(map, notificationOf(map), BASE_CFG));
    expect(plain.options.actions).toBeUndefined();
    expect(plain.options.image).toBeUndefined();
    expect(plain.options.data).toMatchObject({ mid: "msg_1" });
  });

  it("the site-name notification has the site name, no body and a marked data object", () => {
    const { title, options } = fallbackDisplay(BASE_CFG, SITE, HOST, 5);
    expect(title).toBe("Example Play");
    expect(options.body).toBeUndefined();
    expect(options.data).toMatchObject({ op: "openpush", mid: "", fallback: true, url: `${SITE}/` });
    expect(fallbackDisplay(undefined, SITE, HOST, 5).title).toBe(HOST);
  });
});
