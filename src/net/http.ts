import { OpenPushError } from "../errors";
import type { Logger } from "../log/logger";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HttpRequest {
  method: HttpMethod;
  /** Path on the OpenPush server, starting with "/". */
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Send `X-OP-SDK-Key` (default true). The public config route does not need it. */
  auth?: boolean;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  header(name: string): string | null;
  body: unknown;
}

export interface HttpDeps {
  fetch: FetchLike;
  serverUrl: () => string;
  sdkKey: () => string | undefined;
  log: Logger;
  /** False while consent is required and not given: no request leaves the page. */
  allowed: () => boolean;
}

export const SDK_KEY_HEADER = "X-OP-SDK-Key";

/** JSON over fetch to the OpenPush server. */
export class HttpClient {
  constructor(private readonly deps: HttpDeps) {}

  async send(req: HttpRequest): Promise<HttpResponse> {
    if (!this.deps.allowed()) throw new OpenPushError("consent_required", "Requests are off until consent is given");
    const headers: Record<string, string> = { ...req.headers };
    if (req.auth !== false) {
      const key = this.deps.sdkKey();
      if (!key) throw new OpenPushError("not_initialized", "The SDK key is not known yet");
      headers[SDK_KEY_HEADER] = key;
    }
    let payload: string | undefined;
    if (req.body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(req.body);
    }
    const url = this.deps.serverUrl() + req.path;
    const pathOnly = req.path.split("?")[0] ?? req.path;
    let res: Response;
    try {
      res = await this.deps.fetch(url, { method: req.method, headers, body: payload, credentials: "omit" });
    } catch (error) {
      this.deps.log.trace(`${req.method} ${pathOnly} failed: no connection`);
      throw new OpenPushError("network", "Could not reach the OpenPush server", {
        cause: error instanceof Error ? error.name : "unknown",
      });
    }
    this.deps.log.trace(`${req.method} ${pathOnly} ${res.status}`);
    return {
      status: res.status,
      ok: res.ok,
      header: (name) => res.headers.get(name),
      body: await readBody(res),
    };
  }
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204 || res.status === 304) return undefined;
  const type = res.headers.get("Content-Type") ?? "";
  try {
    if (type.includes("json")) return await res.json();
    const text = await res.text();
    return text === "" ? undefined : text;
  } catch {
    return undefined;
  }
}
