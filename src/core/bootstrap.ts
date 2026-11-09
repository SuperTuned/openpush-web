/** The config bootstrap from `GET /v1/apps/{app}/webpush-config`. */
export interface Bootstrap {
  app: string;
  enabled: boolean;
  sdk_key?: string;
  site?: { origin: string; name: string; icon?: string | null };
  setup_type?: string;
  web_push?: { public_key: string; key_id: string };
  worker?: { path: string; scope: string };
  auto_resubscribe?: boolean;
  keep_on_screen?: boolean;
  click?: { match: string; action: string };
  prompts?: unknown[];
  webhooks?: { displayed?: string | null; clicked?: string | null; dismissed?: string | null; cors?: boolean };
  channels?: { email: boolean; phone: boolean };
  languages?: string[];
  move?: { from_firebase: boolean };
  direct?: { new_registrations: boolean };
  /** v1 fields, present for apps that still have the Firebase web credential. */
  vapid_public?: string;
  firebase?: Record<string, unknown>;
  site_url?: string;
  needs_link_code?: boolean;
  [field: string]: unknown;
}

/** Accepts a response body as a bootstrap when it has the minimal shape; else undefined. */
export function parseBootstrap(body: unknown): Bootstrap | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b.app !== "string") return undefined;
  const enabled = b.enabled === undefined ? true : b.enabled === true;
  return { ...b, app: b.app, enabled } as Bootstrap;
}

/** True when the bootstrap describes a site this SDK can use (a v2 site row). */
export function hasSite(boot: Bootstrap): boot is Bootstrap & { site: NonNullable<Bootstrap["site"]> } {
  return !!boot.site && typeof boot.site.origin === "string" && boot.site.origin !== "";
}
