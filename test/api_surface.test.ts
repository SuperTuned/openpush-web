/// <reference types="node" />
/**
 * Public API surface: every public member, checked against the SDK
 * object, the built `window.OpenPush` (dist/cdn/openpush.js) and the types (dist/npm/openpush.d.ts).
 * The built-file checks run when `npm run build` has run.
 *
 * Members marked `later` would be filled by a later build step; they are listed so the table stays
 * whole, and are checked once they exist. None is left: the `Prompts` members are checked too.
 */
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createOpenPush } from "../src/core/sdk";
import { fakePlatform } from "./helpers/fake_platform";

interface Member {
  path: string;
  /** Checked once present; see the note above. */
  later?: "prompts";
}

/** The public API, one row per member (owner object, then member). */
export const API_MEMBERS: readonly Member[] = [
  ...["initialize", "init", "login", "logout", "onIdentityVerificationRequired", "setConsentRequired", "setConsentGiven", "trackEvent", "version"].map(
    (m) => ({ path: m }),
  ),
  ...[
    "externalId",
    "addTag",
    "addTags",
    "removeTag",
    "removeTags",
    "getTags",
    "addAlias",
    "addAliases",
    "removeAlias",
    "removeAliases",
    "addEmail",
    "removeEmail",
    "addSms",
    "removeSms",
    "addWhatsApp",
    "removeWhatsApp",
    "getLanguage",
    "setLanguage",
    "addObserver",
    "removeObserver",
    "pushSubscription",
  ].map((m) => ({ path: `User.${m}` })),
  ...["id", "token", "optedIn", "status", "optIn", "optOut", "snapshot", "addObserver", "addChangeObserver", "removeObserver"].map((m) => ({
    path: `PushSubscription.${m}`,
  })),
  ...[
    "permission",
    "permissionStatus",
    "canRequestPermission",
    "isPushSupported",
    "requestPermission",
    "addPermissionObserver",
    "removePermissionObserver",
    "addClickListener",
    "removeClickListener",
    "addForegroundLifecycleListener",
    "removeForegroundLifecycleListener",
    "addDismissListener",
    "removeDismissListener",
    "setDefaultUrl",
    "setDefaultTitle",
    "clearAll",
    "remove",
  ].map((m) => ({ path: `Notifications.${m}` })),
  ...["showSlideIn", "showTopics", "showEmail", "showPhone", "showEmailOrPhone", "showBell", "addListener", "removeListener"].map((m) => ({
    path: `Prompts.${m}`,
  })),
  ...["sendOutcome", "sendUniqueOutcome"].map((m) => ({ path: `Session.${m}` })),
  ...["setLogLevel", "addLogListener", "removeLogListener"].map((m) => ({ path: `Debug.${m}` })),
  ...["start", "check", "resend"].map((m) => ({ path: `Verify.${m}` })),
  // v1 names.
  ...["requestPermission", "getSubscriptionId", "onClick", "onBackground"].map((m) => ({ path: m })),
];

/** True when `path` names a member of `root` (a getter that returns null still counts). */
function has(root: unknown, path: string): boolean {
  let node: unknown = root;
  for (const part of path.split(".")) {
    if (node === null || (typeof node !== "object" && typeof node !== "function") || !(part in (node as object))) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return true;
}

const required = API_MEMBERS.filter((m) => !m.later);
const later = API_MEMBERS.filter((m) => m.later);

describe("public API surface", () => {
  it("lists every public member once", () => {
    const paths = API_MEMBERS.map((m) => m.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toHaveLength(77);
  });

  it("the SDK object has every member", () => {
    const { api } = createOpenPush({ platform: fakePlatform().platform });
    expect(required.filter((m) => !has(api, m.path)).map((m) => m.path)).toEqual([]);
    expect(api.User.pushSubscription).toBe(api.PushSubscription);
  });

  it("members filled later, when present, are complete", () => {
    const { api } = createOpenPush({ platform: fakePlatform().platform });
    const present = later.filter((m) => has(api, m.path));
    if (present.length > 0) expect(present).toHaveLength(later.length);
  });
});

const cdnFile = new URL("../dist/cdn/openpush.js", import.meta.url);
const typesFile = new URL("../dist/npm/openpush.d.ts", import.meta.url);

describe.skipIf(!existsSync(cdnFile))("built window.OpenPush (dist/cdn/openpush.js)", () => {
  it("defines window.OpenPush with every member", () => {
    const sandbox: Record<string, unknown> = { console: { error() {}, warn() {}, info() {}, debug() {} }, document: { currentScript: null } };
    sandbox.window = sandbox;
    runInNewContext(readFileSync(cdnFile, "utf8"), sandbox);
    const built = sandbox.OpenPush;
    expect(built).toBeTruthy();
    expect(required.filter((m) => !has(built, m.path)).map((m) => m.path)).toEqual([]);
  });
});

describe.skipIf(!existsSync(typesFile))("types (dist/npm/openpush.d.ts)", () => {
  it("declare every member", () => {
    const text = readFileSync(typesFile, "utf8");
    const missing = required.filter((m) => {
      const name = m.path.split(".").pop() ?? "";
      return !new RegExp(`\\b${name}\\b\\??[(:]`).test(text);
    });
    expect(missing.map((m) => m.path)).toEqual([]);
    for (const owner of ["UserApi", "SessionApi", "VerifyApi", "PushSubscriptionApi", "NotificationsApi", "DebugApi", "PromptsApi", "OpenPushApi"]) {
      expect(text).toMatch(new RegExp(`interface ${owner}\\b`));
    }
  });
});
