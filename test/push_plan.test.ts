import { describe, expect, it } from "vitest";
import { isEndpoint, looksLikeFirebaseToken, planReconcile, previousIdentity, type ReconcileInputs } from "../src/push/plan";
import { firebaseToken } from "./helpers/fake_push";

const OLD = "https://fcm.googleapis.com/fcm/send/old-endpoint-11112222";
const NEW = "https://fcm.googleapis.com/fcm/send/new-endpoint-33334444";
const FB = firebaseToken();

function inputs(over: Partial<ReconcileInputs> = {}): ReconcileInputs {
  return {
    appId: "app-1",
    permission: "granted",
    subscription: null,
    cfg: { app: "app-1", publicKey: "BACTIVEKEY00", keyId: "k2" },
    previousCfg: undefined,
    v1: undefined,
    optedOut: false,
    lastStatus: undefined,
    autoResubscribe: true,
    newRegistrations: true,
    fromFirebase: true,
    ...over,
  };
}

const ROW = { app: "app-1", publicKey: "BACTIVEKEY00", keyId: "k2", token: OLD, subscriptionId: "sub-1", deviceSecret: "secret-abcdef" };

describe("token kinds", () => {
  it("tells a Firebase token from an endpoint", () => {
    expect(looksLikeFirebaseToken(FB)).toBe(true);
    expect(looksLikeFirebaseToken(OLD)).toBe(false);
    expect(looksLikeFirebaseToken("short:token")).toBe(false);
    expect(isEndpoint(OLD)).toBe(true);
    expect(isEndpoint(FB)).toBe(false);
  });
});

describe("page-load reconcile", () => {
  it("permission granted and a current subscription: an update (registered only when something changed)", () => {
    const plan = planReconcile(inputs({ cfg: ROW, subscription: { endpoint: OLD, activeKey: true } }));
    expect(plan).toEqual({ kind: "update", move: undefined });
  });

  it("the endpoint changed: an update with the old endpoint as proof (token change)", () => {
    const plan = planReconcile(inputs({ cfg: ROW, subscription: { endpoint: NEW, activeKey: true } }));
    expect(plan).toEqual({ kind: "update", move: { kind: "openpush", previousToken: OLD } });
  });

  it("permission denied or default with a subscribed row: status 0", () => {
    expect(planReconcile(inputs({ permission: "denied", cfg: ROW, lastStatus: 1 }))).toEqual({ kind: "permission_lost", token: OLD });
    expect(planReconcile(inputs({ permission: "default", cfg: ROW, lastStatus: 1 }))).toEqual({ kind: "permission_lost", token: OLD });
  });

  it("permission gone, row already at 0 or -2, or no row: nothing", () => {
    expect(planReconcile(inputs({ permission: "denied", cfg: ROW, lastStatus: 0 })).kind).toBe("nothing");
    expect(planReconcile(inputs({ permission: "denied", cfg: ROW, lastStatus: -2 })).kind).toBe("nothing");
    expect(planReconcile(inputs({ permission: "default" })).kind).toBe("nothing");
  });
});

describe("auto resubscribe", () => {
  it("never clears an opt-out: nothing happens", () => {
    expect(planReconcile(inputs({ cfg: ROW, optedOut: true }))).toEqual({ kind: "nothing", reason: "opted out" });
    expect(planReconcile(inputs({ cfg: ROW, optedOut: true, subscription: { endpoint: OLD, activeKey: false } })).kind).toBe("nothing");
  });

  it("no subscription: subscribe again with the old endpoint and secret as proof", () => {
    expect(planReconcile(inputs({ cfg: ROW }))).toEqual({
      kind: "subscribe",
      move: { kind: "openpush", previousToken: OLD },
      unsubscribe: false,
      resubscribe: true,
    });
  });

  it("no subscription and no state (cleared site data): a new row", () => {
    expect(planReconcile(inputs())).toEqual({ kind: "subscribe", move: undefined, unsubscribe: false, resubscribe: true });
  });

  it("auto resubscribe off: a browser without a subscription is left alone", () => {
    expect(planReconcile(inputs({ cfg: ROW, autoResubscribe: false })).kind).toBe("nothing");
  });

  it("auto resubscribe off still finishes a pending move", () => {
    const cfg = { ...ROW, token: FB, move: { kind: "firebase" as const, previousToken: FB, subscriptionId: "sub-1" } };
    expect(planReconcile(inputs({ cfg, autoResubscribe: false })).kind).toBe("subscribe");
  });
});

describe("new_registrations: false", () => {
  it("makes no new subscription", () => {
    expect(planReconcile(inputs({ newRegistrations: false })).kind).toBe("nothing");
    expect(planReconcile(inputs({ newRegistrations: false, subscription: { endpoint: NEW, activeKey: true } })).kind).toBe("nothing");
  });

  it("makes no move", () => {
    const v1 = { token: FB, subscriptionId: "sub-1" };
    expect(planReconcile(inputs({ newRegistrations: false, v1, subscription: { endpoint: NEW, activeKey: false } })).kind).toBe("nothing");
    expect(planReconcile(inputs({ newRegistrations: false, cfg: ROW, subscription: { endpoint: OLD, activeKey: false } })).kind).toBe("nothing");
  });

  it("keeps an existing direct subscription current: updates, token changes and permission loss", () => {
    expect(planReconcile(inputs({ newRegistrations: false, cfg: ROW, subscription: { endpoint: OLD, activeKey: true } })).kind).toBe("update");
    expect(planReconcile(inputs({ newRegistrations: false, cfg: ROW, subscription: { endpoint: NEW, activeKey: true } }))).toEqual({
      kind: "update",
      move: { kind: "openpush", previousToken: OLD },
    });
    expect(planReconcile(inputs({ newRegistrations: false, cfg: ROW })).kind).toBe("subscribe");
    expect(planReconcile(inputs({ newRegistrations: false, cfg: ROW, permission: "denied", lastStatus: 1 })).kind).toBe("permission_lost");
  });
});

describe("silent move", () => {
  it("from Firebase: the v1 token and subscription id; unsubscribe first", () => {
    const plan = planReconcile(
      inputs({ cfg: { app: "app-1", token: FB }, v1: { token: FB, subscriptionId: "sub-1" }, subscription: { endpoint: OLD, activeKey: false } }),
    );
    expect(plan).toEqual({ kind: "subscribe", move: { kind: "firebase", previousToken: FB, subscriptionId: "sub-1" }, unsubscribe: true, resubscribe: false });
  });

  it("from Firebase without a stored subscription id: a new row", () => {
    const plan = planReconcile(inputs({ cfg: { app: "app-1", token: FB }, v1: { token: FB }, subscription: { endpoint: OLD, activeKey: false } }));
    expect(plan).toEqual({ kind: "subscribe", move: undefined, unsubscribe: true, resubscribe: false });
  });

  it("from Firebase when the browser does not say which key it used", () => {
    const plan = planReconcile(inputs({ cfg: { app: "app-1", token: FB }, v1: { token: FB, subscriptionId: "sub-1" }, subscription: { endpoint: OLD, activeKey: undefined } }));
    expect(plan.kind).toBe("subscribe");
  });

  it("from Firebase is skipped when the app has no Firebase rows left", () => {
    const plan = planReconcile(
      inputs({ fromFirebase: false, cfg: { app: "app-1", token: FB }, v1: { token: FB, subscriptionId: "sub-1" }, subscription: { endpoint: OLD, activeKey: false } }),
    );
    expect(plan).toMatchObject({ kind: "subscribe", move: undefined });
  });

  it("between OpenPush keys: the old endpoint as proof; unsubscribe first", () => {
    const plan = planReconcile(inputs({ cfg: ROW, subscription: { endpoint: OLD, activeKey: false } }));
    expect(plan).toEqual({ kind: "subscribe", move: { kind: "openpush", previousToken: OLD }, unsubscribe: true, resubscribe: false });
  });

  it("from an imported endpoint: previous_token is the current endpoint only", () => {
    const plan = planReconcile(inputs({ subscription: { endpoint: OLD, activeKey: false } }));
    expect(plan).toEqual({ kind: "subscribe", move: { kind: "imported", previousToken: OLD }, unsubscribe: true, resubscribe: false });
  });

  it("a pending move is tried again", () => {
    const move = { kind: "firebase" as const, previousToken: FB, subscriptionId: "sub-1" };
    expect(previousIdentity(inputs({ cfg: { app: "app-1", token: FB, move } }), undefined)).toEqual(move);
  });
});

describe("another app's subscription", () => {
  it("subscribes for this app as a new row, with no proof from the other app", () => {
    const previousCfg = { app: "app-0", token: OLD, subscriptionId: "sub-0", deviceSecret: "other-secret" };
    const plan = planReconcile(inputs({ previousCfg, subscription: { endpoint: OLD, activeKey: false } }));
    expect(plan).toEqual({ kind: "subscribe", move: undefined, unsubscribe: true, resubscribe: false });
  });

  it("does not send status 0 for the other app's row", () => {
    const previousCfg = { app: "app-0", token: OLD, subscriptionId: "sub-0" };
    expect(planReconcile(inputs({ permission: "denied", previousCfg, cfg: { app: "app-1", token: OLD }, lastStatus: 1 })).kind).toBe("nothing");
  });
});
