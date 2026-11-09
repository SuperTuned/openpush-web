/** Click matching and actions. */
import type { Logger } from "../log/logger";
import type { ClickBehavior } from "../storage/types";
import type { ClientsLike, WindowClientLike } from "./sw_types";
import { sameOrigin } from "./urls";

/** What a click did: nothing, focused a window, navigated one, or opened a new one. */
export type OpenResult = "none" | "focused" | "navigated" | "opened";

export const DEFAULT_CLICK: ClickBehavior = { match: "exact", action: "navigate" };

export function clickBehavior(value: Partial<ClickBehavior> | undefined): ClickBehavior {
  const match = value?.match === "origin" ? "origin" : "exact";
  const action = value?.action === "focus" ? "focus" : "navigate";
  return { match, action };
}

/** The window a click uses: exact URL, or any window on the site origin. The focused one first. */
export function matchWindow(windows: readonly WindowClientLike[], target: string, behavior: ClickBehavior, origin: string): WindowClientLike | undefined {
  const fits = (w: WindowClientLike): boolean => (behavior.match === "exact" ? w.url === target : sameOrigin(w.url, origin));
  const candidates = windows.filter(fits);
  return candidates.find((w) => w.focused) ?? candidates[0];
}

async function openNew(clients: ClientsLike, target: string, log: Logger): Promise<OpenResult> {
  try {
    await clients.openWindow(target);
    return "opened";
  } catch {
    log.debug("The browser did not open a window for the click");
    return "none";
  }
}

/**
 * Focuses, navigates or opens per the site's click behaviour. A cross-origin target always opens
 * a new window; `navigate()` is used only for same-origin targets. A window the worker does not
 * control cannot be navigated: an exact match then stays as it is (it already shows the target),
 * and an origin match gives way to a new window.
 */
export async function openTarget(clients: ClientsLike, target: string, behavior: ClickBehavior, origin: string, log: Logger): Promise<OpenResult> {
  if (!sameOrigin(target, origin)) return openNew(clients, target, log);
  let windows: readonly WindowClientLike[] = [];
  try {
    windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
  } catch {
    windows = [];
  }
  const match = matchWindow(windows, target, behavior, origin);
  if (!match) return openNew(clients, target, log);
  let win = match;
  try {
    win = (await match.focus()) ?? match;
  } catch {
    log.debug("The browser did not let the click focus a window");
  }
  if (behavior.action === "focus") return "focused";
  try {
    await win.navigate(target);
    return "navigated";
  } catch {
    if (behavior.match === "exact") return "focused";
    return openNew(clients, target, log);
  }
}
