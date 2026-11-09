/**
 * The call-shape fixture: one row per reference call the layer maps, each with the call made
 * on the compat object and what OpenPush must receive. Event rows are in compat.test.ts, which
 * fires the OpenPush side and checks the payload the site's listener gets.
 */
import { expect } from "vitest";
import type { CompatSdk } from "../../src/compat/facade";
import type { FakeApi } from "./fake_api";

export interface CallShape {
  /** The reference call, as a migrating site writes it. */
  ref: string;
  call(sdk: CompatSdk): unknown;
  check(fake: FakeApi, result: unknown): void;
}

export const CALL_SHAPES: readonly CallShape[] = [
  { ref: "login(externalId)", call: (s) => s.login("user-7"), check: (f) => expect(f.api.login).toHaveBeenCalledWith("user-7") },
  { ref: "logout()", call: (s) => s.logout(), check: (f) => expect(f.api.logout).toHaveBeenCalledWith() },
  { ref: "setConsentRequired(b)", call: (s) => s.setConsentRequired(true), check: (f) => expect(f.api.setConsentRequired).toHaveBeenCalledWith(true) },
  { ref: "setConsentGiven(b)", call: (s) => s.setConsentGiven(false), check: (f) => expect(f.api.setConsentGiven).toHaveBeenCalledWith(false) },
  {
    ref: "User.externalId",
    call: (s) => s.User.externalId,
    check: (f, r) => {
      expect(r).toBe("user-7");
      void f;
    },
  },
  { ref: "User.addAlias", call: (s) => s.User.addAlias("crm", "c-1"), check: (f) => expect(f.api.User.addAlias).toHaveBeenCalledWith("crm", "c-1") },
  { ref: "User.addAliases", call: (s) => s.User.addAliases({ crm: "c-1" }), check: (f) => expect(f.api.User.addAliases).toHaveBeenCalledWith({ crm: "c-1" }) },
  { ref: "User.removeAlias", call: (s) => s.User.removeAlias("crm"), check: (f) => expect(f.api.User.removeAlias).toHaveBeenCalledWith("crm") },
  { ref: "User.removeAliases", call: (s) => s.User.removeAliases(["crm"]), check: (f) => expect(f.api.User.removeAliases).toHaveBeenCalledWith(["crm"]) },
  { ref: "User.addTag", call: (s) => s.User.addTag("level", "7"), check: (f) => expect(f.api.User.addTag).toHaveBeenCalledWith("level", "7") },
  { ref: "User.addTags", call: (s) => s.User.addTags({ level: "7" }), check: (f) => expect(f.api.User.addTags).toHaveBeenCalledWith({ level: "7" }) },
  { ref: "User.removeTag", call: (s) => s.User.removeTag("level"), check: (f) => expect(f.api.User.removeTag).toHaveBeenCalledWith("level") },
  { ref: "User.removeTags", call: (s) => s.User.removeTags(["level"]), check: (f) => expect(f.api.User.removeTags).toHaveBeenCalledWith(["level"]) },
  { ref: "User.getTags", call: (s) => s.User.getTags(), check: (_f, r) => expect(r).toEqual({ level: "7" }) },
  { ref: "User.getLanguage", call: (s) => s.User.getLanguage(), check: (_f, r) => expect(r).toBe("fr") },
  { ref: "User.setLanguage", call: (s) => s.User.setLanguage("de"), check: (f) => expect(f.api.User.setLanguage).toHaveBeenCalledWith("de") },
  { ref: "User.addEmail", call: (s) => s.User.addEmail("a@example.com"), check: (f) => expect(f.api.User.addEmail).toHaveBeenCalledWith("a@example.com") },
  { ref: "User.removeEmail", call: (s) => s.User.removeEmail("a@example.com"), check: (f) => expect(f.api.User.removeEmail).toHaveBeenCalledWith("a@example.com") },
  { ref: "User.addSms", call: (s) => s.User.addSms("+15555550100"), check: (f) => expect(f.api.User.addSms).toHaveBeenCalledWith("+15555550100") },
  { ref: "User.removeSms", call: (s) => s.User.removeSms("+15555550100"), check: (f) => expect(f.api.User.removeSms).toHaveBeenCalledWith("+15555550100") },
  {
    ref: "User.trackEvent(name, props)",
    call: (s) => s.User.trackEvent("level_up", { level: 7 }),
    check: (f) => expect(f.api.trackEvent).toHaveBeenCalledWith("level_up", { level: 7 }),
  },
  { ref: "User.PushSubscription.id", call: (s) => s.User.PushSubscription.id, check: (_f, r) => expect(r).toBe("sub-1") },
  { ref: "User.PushSubscription.token", call: (s) => s.User.PushSubscription.token, check: (_f, r) => expect(r).toBe("https://fcm.googleapis.com/fcm/send/x") },
  { ref: "User.PushSubscription.optedIn", call: (s) => s.User.PushSubscription.optedIn, check: (_f, r) => expect(r).toBe(true) },
  { ref: "User.PushSubscription.optIn()", call: (s) => s.User.PushSubscription.optIn(), check: (f) => expect(f.api.PushSubscription.optIn).toHaveBeenCalled() },
  { ref: "User.PushSubscription.optOut()", call: (s) => s.User.PushSubscription.optOut(), check: (f) => expect(f.api.PushSubscription.optOut).toHaveBeenCalled() },
  { ref: "Notifications.permission", call: (s) => s.Notifications.permission, check: (_f, r) => expect(r).toBe(true) },
  { ref: "Notifications.permissionNative", call: (s) => s.Notifications.permissionNative, check: (_f, r) => expect(r).toBe("granted") },
  { ref: "Notifications.isPushSupported()", call: (s) => s.Notifications.isPushSupported(), check: (_f, r) => expect(r).toBe(true) },
  {
    ref: "Notifications.requestPermission()",
    call: (s) => s.Notifications.requestPermission(),
    check: (f) => expect(f.api.Notifications.requestPermission).toHaveBeenCalled(),
  },
  {
    ref: "Notifications.setDefaultUrl",
    call: (s) => s.Notifications.setDefaultUrl("https://play.example.com/"),
    check: (f) => expect(f.api.Notifications.setDefaultUrl).toHaveBeenCalledWith("https://play.example.com/"),
  },
  {
    ref: "Notifications.setDefaultTitle",
    call: (s) => s.Notifications.setDefaultTitle("Play"),
    check: (f) => expect(f.api.Notifications.setDefaultTitle).toHaveBeenCalledWith("Play"),
  },
  { ref: "Slidedown.promptPush(opts)", call: (s) => s.Slidedown.promptPush({ force: true }), check: (f) => expect(f.api.Prompts.showSlideIn).toHaveBeenCalledWith({ force: true }) },
  {
    ref: "Slidedown.promptPushCategories(opts)",
    call: (s) => s.Slidedown.promptPushCategories(),
    check: (f) => expect(f.api.Prompts.showTopics).toHaveBeenCalledWith({ force: false }),
  },
  { ref: "Slidedown.promptEmail", call: (s) => s.Slidedown.promptEmail(), check: (f) => expect(f.api.Prompts.showEmail).toHaveBeenCalledWith({ force: false }) },
  { ref: "Slidedown.promptSms", call: (s) => s.Slidedown.promptSms({ force: true }), check: (f) => expect(f.api.Prompts.showPhone).toHaveBeenCalledWith({ force: true }) },
  {
    ref: "Slidedown.promptSmsAndEmail",
    call: (s) => s.Slidedown.promptSmsAndEmail(),
    check: (f) => expect(f.api.Prompts.showEmailOrPhone).toHaveBeenCalledWith({ force: false }),
  },
  { ref: "Session.sendOutcome(name, value)", call: (s) => s.Session.sendOutcome("purchase", 5), check: (f) => expect(f.api.Session.sendOutcome).toHaveBeenCalledWith("purchase", 5) },
  { ref: "Session.sendUniqueOutcome(name)", call: (s) => s.Session.sendUniqueOutcome("signup"), check: (f) => expect(f.api.Session.sendUniqueOutcome).toHaveBeenCalledWith("signup") },
  { ref: "Debug.setLogLevel(level)", call: (s) => s.Debug.setLogLevel("trace"), check: (f) => expect(f.api.Debug.setLogLevel).toHaveBeenCalledWith("trace") },
];
