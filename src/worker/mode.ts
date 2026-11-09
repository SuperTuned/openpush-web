/**
 * Worker mode. Standalone: the site registered OpenPush's own file, so no
 * other push handler exists and every push must be shown. Combined: the import line runs inside
 * the site's own worker, so only OpenPush's pushes are OpenPush's business.
 */
import type { CfgRow } from "../storage/types";
import type { ImportedMarker } from "./sw_types";

export const WORKER_FILE = "openpush-sw.js";

function pathname(url: string, base?: string): string | null {
  try {
    return new URL(url, base).pathname;
  } catch {
    return null;
  }
}

/** The file-name test alone, used until `cfg` is read. */
export function isOpenPushFile(scriptURL: string): boolean {
  const path = pathname(scriptURL);
  return path !== null && path.slice(path.lastIndexOf("/") + 1) === WORKER_FILE;
}

/**
 * Standalone when the file is `openpush-sw.js` and, once `cfg` is known, the OpenPush SDK
 * registered it at the configured path.
 */
export function detectStandalone(scriptURL: string, cfg: CfgRow | undefined): boolean {
  if (!isOpenPushFile(scriptURL)) return false;
  if (!cfg || typeof cfg.workerPath !== "string" || cfg.workerPath === "") return true;
  const configured = pathname(cfg.workerPath, scriptURL);
  if (configured === null || configured !== pathname(scriptURL)) return false;
  return cfg.workerState === undefined || cfg.workerState === "ok";
}

export function marker(scriptURL: string, cfg?: CfgRow): ImportedMarker {
  return { scriptURL, standalone: detectStandalone(scriptURL, cfg) };
}
