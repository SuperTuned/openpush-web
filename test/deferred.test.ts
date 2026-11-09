import { describe, expect, it, vi } from "vitest";
import { installDeferred } from "../src/core/deferred";
import { createOpenPush, type OpenPushApi } from "../src/core/sdk";
import { Logger } from "../src/log/logger";
import { fakePlatform, flush } from "./helpers/fake_platform";

describe("OpenPushDeferred", () => {
  it("runs queued callbacks in order, later ones after initialize, and later pushes at once", async () => {
    const fake = fakePlatform();
    const { api, runtime } = createOpenPush({ platform: fake.platform });
    const order: string[] = [];
    let initDone = false;
    const target: { OpenPushDeferred?: unknown } = {
      OpenPushDeferred: [
        (sdk: OpenPushApi) => {
          order.push("init-call");
          void sdk.initialize({ appId: "app-1" }).then(() => {
            initDone = true;
          });
        },
        () => {
          order.push(`after-init:${initDone}`);
        },
        async () => {
          await flush(1);
          order.push("async");
        },
        () => {
          order.push("last-queued");
        },
      ],
    };
    const queue = installDeferred(target, api, () => runtime.initialized, runtime.log);
    expect(target.OpenPushDeferred).toBe(queue);
    await vi.waitFor(() => expect(order).toHaveLength(4), { timeout: 5_000 });
    expect(order).toEqual(["init-call", "after-init:true", "async", "last-queued"]);

    queue.push(() => {
      order.push("pushed-later");
    });
    await flush(2);
    expect(order[order.length - 1]).toBe("pushed-later");
  });

  it("logs a failing callback and keeps going", async () => {
    const lines: string[] = [];
    const log = new Logger(undefined, () => 0, "error");
    log.addListener((e) => lines.push(e.message));
    const ran: string[] = [];
    const target: { OpenPushDeferred?: unknown } = {
      OpenPushDeferred: [
        () => {
          throw new Error("site bug");
        },
        () => {
          ran.push("next");
        },
      ],
    };
    installDeferred(target, {}, () => undefined, log);
    await flush();
    expect(ran).toEqual(["next"]);
    expect(lines[0]).toContain("site bug");
  });

  it("starts empty when the page set nothing", () => {
    const target: { OpenPushDeferred?: unknown } = {};
    const queue = installDeferred(target, {}, () => undefined, new Logger(undefined, () => 0));
    expect(typeof queue.push).toBe("function");
  });
});
