/** `openpush.prompts`: page views, cooldown 3/7/30 days, accepted, private mark. */
import { describe, expect, it } from "vitest";
import { LocalStore } from "../src/storage/local";
import { DAY_MS, PRIVATE_MARK_MS, PromptStore } from "../src/prompts/store";
import { FakeStorage } from "./helpers/fake_platform";

function store(allowed = true): { s: PromptStore; storage: FakeStorage } {
  const storage = new FakeStorage();
  return { s: new PromptStore(new LocalStore(storage, () => allowed)), storage };
}

describe("PromptStore", () => {
  it("counts every page load", () => {
    const { s, storage } = store();
    expect(s.views).toBe(0);
    s.countView();
    s.countView();
    expect(s.views).toBe(2);
    expect(JSON.parse(storage.map.get("openpush.prompts") ?? "{}").views).toBe(2);
  });

  it("cools down 3, 7, then 30 days after each dismiss, per type", () => {
    const { s } = store();
    const t0 = 1_000_000;
    s.dismissed("slide_in", t0);
    expect(s.coolingDown("slide_in", t0 + 3 * DAY_MS - 1)).toBe(true);
    expect(s.coolingDown("slide_in", t0 + 3 * DAY_MS)).toBe(false);
    expect(s.coolingDown("browser", t0 + 1)).toBe(false);
    const t1 = t0 + 4 * DAY_MS;
    s.dismissed("slide_in", t1);
    expect(s.coolingDown("slide_in", t1 + 7 * DAY_MS - 1)).toBe(true);
    expect(s.coolingDown("slide_in", t1 + 7 * DAY_MS)).toBe(false);
    for (const n of [3, 4]) {
      const t = t1 + n * 10 * DAY_MS;
      s.dismissed("slide_in", t);
      expect(s.coolingDown("slide_in", t + 30 * DAY_MS - 1)).toBe(true);
      expect(s.coolingDown("slide_in", t + 30 * DAY_MS)).toBe(false);
    }
  });

  it("records an accept", () => {
    const { s } = store();
    expect(s.wasAccepted("email_phone")).toBe(false);
    s.accepted("email_phone", 5);
    expect(s.wasAccepted("email_phone")).toBe(true);
  });

  it("keeps a private-window mark for the session only", () => {
    const { s } = store();
    s.markPrivate(100);
    expect(s.privateSession(100 + PRIVATE_MARK_MS - 1)).toBe(true);
    expect(s.privateSession(100 + PRIVATE_MARK_MS)).toBe(false);
  });

  it("without consent writes nothing but keeps the values for this page", () => {
    const { s, storage } = store(false);
    s.countView();
    s.dismissed("slide_in", 0);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(s.views).toBe(1);
    expect(s.coolingDown("slide_in", 1)).toBe(true);
  });

  it("reads a damaged record as empty", () => {
    const { s, storage } = store();
    storage.map.set("openpush.prompts", "[1,2]");
    expect(s.views).toBe(0);
    storage.map.set("openpush.prompts", '{"views":"x","t":{"slide_in":{"next":"soon"}}}');
    expect(s.views).toBe(0);
    expect(s.coolingDown("slide_in", 0)).toBe(false);
  });
});
