import { OpenPushError } from "../errors";
import type { Logger } from "../log/logger";
import type { HttpClient } from "../net/http";
import type { CachedBootstrap, CfgRow, WorkerState } from "../storage/types";
import { VERSION } from "../version";
import { parseBootstrap, type Bootstrap } from "./bootstrap";

export interface ConfigStore {
  readCfg(): Promise<CfgRow | undefined>;
  mergeCfg(patch: Partial<CfgRow>): Promise<CfgRow>;
}

export interface LoadedConfig {
  bootstrap: Bootstrap;
  fromCache: boolean;
  /**
   * When the cached config was used: resolves with a fresh config once it arrives, or undefined
   * when the cache was still current (304) or the refresh failed.
   */
  refresh?: Promise<Bootstrap | undefined>;
}

type FetchOutcome =
  | { kind: "fresh"; bootstrap: Bootstrap }
  | { kind: "not_modified" }
  | { kind: "failed"; error: OpenPushError };

export interface ConfigLoaderDeps {
  http: Pick<HttpClient, "send">;
  store: ConfigStore;
  log: Logger;
  now: () => number;
}

export function configPath(appId: string, sw: WorkerState | "" | undefined): string {
  const query = new URLSearchParams({ sdk: VERSION, sw: sw ?? "" });
  return `/v1/apps/${encodeURIComponent(appId)}/webpush-config?${query.toString()}`;
}

/**
 * Loads the config bootstrap: the cached copy at once when there is one, and a
 * fresh copy with `If-None-Match` (stale-while-revalidate). With no cache and no answer:
 * `config_unavailable`.
 */
export class ConfigLoader {
  constructor(private readonly deps: ConfigLoaderDeps) {}

  async load(appId: string, cfg: CfgRow | undefined): Promise<LoadedConfig> {
    const cached = cfg?.bootstrap && cfg.bootstrap.app === appId ? cfg.bootstrap : undefined;
    const request = this.fetchFresh(appId, cached, cfg?.workerState);
    if (cached) {
      return {
        bootstrap: cached.body,
        fromCache: true,
        refresh: request.then((outcome) => {
          if (outcome.kind === "fresh") return outcome.bootstrap;
          if (outcome.kind === "failed") this.deps.log.debug(`Using the saved config: ${outcome.error.message}`);
          return undefined;
        }),
      };
    }
    const outcome = await request;
    if (outcome.kind === "fresh") return { bootstrap: outcome.bootstrap, fromCache: false };
    const reason = outcome.kind === "failed" ? outcome.error.message : "the server sent no config";
    throw new OpenPushError("config_unavailable", `Could not load this app's web push config: ${reason}`, {
      cause: outcome.kind === "failed" ? outcome.error.code : "not_modified",
    });
  }

  private async fetchFresh(appId: string, cached: CachedBootstrap | undefined, sw: WorkerState | undefined): Promise<FetchOutcome> {
    const headers: Record<string, string> = {};
    if (cached?.etag) headers["If-None-Match"] = cached.etag;
    let res;
    try {
      res = await this.deps.http.send({ method: "GET", path: configPath(appId, sw), headers, auth: false });
    } catch (error) {
      return { kind: "failed", error: asError(error) };
    }
    if (res.status === 304 && cached) return { kind: "not_modified" };
    if (res.status === 429) {
      return { kind: "failed", error: new OpenPushError("rate_limited", "The server asked the SDK to slow down") };
    }
    if (!res.ok) {
      return { kind: "failed", error: new OpenPushError("network", `The server answered ${res.status}`, { status: res.status }) };
    }
    const bootstrap = parseBootstrap(res.body);
    if (!bootstrap) return { kind: "failed", error: new OpenPushError("network", "The server sent a config the SDK cannot read") };
    const entry: CachedBootstrap = { app: appId, etag: res.header("ETag"), body: bootstrap, fetchedAt: this.deps.now() };
    try {
      await this.deps.store.mergeCfg({ bootstrap: entry });
    } catch {
      this.deps.log.debug("Could not save the config for the next visit");
    }
    return { kind: "fresh", bootstrap };
  }
}

function asError(error: unknown): OpenPushError {
  return error instanceof OpenPushError ? error : new OpenPushError("network", "Could not reach the OpenPush server");
}
