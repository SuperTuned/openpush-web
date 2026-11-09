/**
 * Starts the whole page SDK against a fake browser and a small fake OpenPush server, for the
 * user, channel, event and v1 tests. By default the browser is subscribed with a direct row.
 */
import { expect, vi } from "vitest";
import { createOpenPush, type OpenPushApi, type Runtime } from "../../src/core/sdk";
import type { PermissionValue } from "../../src/platform/types";
import { Db } from "../../src/storage/idb";
import type { CfgRow, StateRow } from "../../src/storage/types";
import { bootstrapBody, fakePlatform, flush, jsonResponse, type Fake, type FakeStorage } from "./fake_platform";
import { ACTIVE_KEY, endpoint, FakePushManager } from "./fake_push";

export type Body = Record<string, unknown>;

export interface Request {
  path: string;
  body: Body;
}

export interface StartOptions {
  /** A browser subscribed with the app's key and a direct row (default true). */
  subscribed?: boolean;
  permission?: PermissionValue;
  cfg?: Partial<CfgRow>;
  state?: Partial<StateRow>;
  /** Answers for a request; undefined falls back to the default fake server. */
  respond?: (req: Request) => Response | Promise<Response | undefined> | undefined;
  /** Runs before `initialize` (consent calls, tags set early). */
  before?: (api: OpenPushApi, runtime: Runtime) => void;
  /** Call `initialize` (default true). */
  init?: boolean;
  /** Timers run at once (default true); each asked delay is recorded in `delays`. */
  instantTimers?: boolean;
  /** localStorage shared with another "tab". */
  storage?: FakeStorage;
  dataLayer?: unknown[];
}

export interface Started {
  fake: Fake;
  api: OpenPushApi;
  runtime: Runtime;
  manager: FakePushManager;
  db: Db;
  delays: number[];
  /** Every request to the server so far, config fetches left out. */
  requests(): Request[];
  /** Bodies sent to a path ending with `suffix`, for example "/subscriptions". */
  sent(suffix: string): Body[];
  /** Push registrations (platform "web"). */
  registrations(): Body[];
  /** Forgets the requests made so far. */
  reset(): void;
  settle(): Promise<void>;
  state(): Promise<StateRow | undefined>;
}

export const ROW_ID = "sub-1";

/** The default fake server: subscriptions, events, sessions and phone codes. */
export function defaultAnswer(req: Request): Response {
  const { path, body } = req;
  if (path.endsWith("/subscriptions")) {
    return jsonResponse({ id: typeof body.subscription_id === "string" ? body.subscription_id : ROW_ID, app: "app-1", status: typeof body.status === "number" ? body.status : 1, created: false });
  }
  if (path.endsWith("/events")) {
    const events = Array.isArray(body.events) ? body.events : [];
    return jsonResponse({ accepted: events.length, inserted: events.length, duplicates: 0, dropped: 0, dropped_reasons: {} });
  }
  if (path.endsWith("/sessions")) return jsonResponse({ counted: true });
  if (path.includes("/verify")) {
    const status = path.endsWith("/check") ? "approved" : "pending";
    return jsonResponse({ id: "ver-1", to: "+1••••••0123", channel: "sms", status, attempts: 0, expires_at: 1_900_000_000 });
  }
  return jsonResponse({}, 404);
}

export async function start(o: StartOptions = {}): Promise<Started> {
  const subscribed = o.subscribed ?? true;
  const requests: Request[] = [];
  const fake = fakePlatform({
    permission: o.permission ?? (subscribed ? "granted" : "default"),
    dataLayer: o.dataLayer,
    fetch: async (url: string, init?: RequestInit) => {
      if (url.includes("/webpush-config")) {
        return jsonResponse(bootstrapBody({ web_push: { public_key: ACTIVE_KEY, key_id: "k2" } }), 200, { ETag: '"e1"' });
      }
      const path = new URL(url).pathname;
      const body = init?.body ? (JSON.parse(String(init.body)) as Body) : {};
      const req = { path, body };
      requests.push(req);
      return (await o.respond?.(req)) ?? defaultAnswer(req);
    },
  });
  if (o.storage) {
    const storage = o.storage;
    fake.platform.localStorage = () => storage;
  }
  const delays: number[] = [];
  if (o.instantTimers ?? true) {
    fake.platform.timers = {
      setTimeout: (fn, ms) => {
        delays.push(ms);
        return setTimeout(fn, 0);
      },
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
  }
  const db = new Db(fake.idb, () => true);
  const manager = new FakePushManager();
  fake.container.pushManager = manager;
  if (subscribed) {
    const ep = endpoint("row");
    manager.have(ep, ACTIVE_KEY);
    await db.mergeCfg({ app: "app-1", token: ep, subscriptionId: ROW_ID, deviceSecret: "secret-row-abcdef123", subPublicKey: ACTIVE_KEY, subKeyId: "k2", ...o.cfg });
  } else if (o.cfg) {
    await db.mergeCfg({ app: "app-1", ...o.cfg });
  }
  if (o.state) await db.mergeState(o.state);

  const { api, runtime } = createOpenPush({ platform: fake.platform });
  o.before?.(api, runtime);
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 3; round++) {
      await runtime.push.whenIdle();
      await flush(20);
      const queue = runtime.context?.queue;
      if (queue) await vi.waitFor(async () => expect(await queue.size()).toBe(0));
      await flush(20);
    }
  };
  if (o.init ?? true) {
    await api.initialize({ appId: "app-1" });
    await settle();
  }
  const sent = (suffix: string): Body[] => requests.filter((r) => r.path.endsWith(suffix)).map((r) => r.body);
  return {
    fake,
    api,
    runtime,
    manager,
    db,
    delays,
    requests: () => [...requests],
    sent,
    registrations: () => sent("/subscriptions").filter((b) => b.platform === "web"),
    reset: () => {
      requests.length = 0;
    },
    settle,
    state: () => db.readState(),
  };
}
