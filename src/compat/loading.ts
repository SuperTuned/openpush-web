/**
 * Loading shapes: the deferred queue, the compat object on the reference's global, and the
 * reference's previous array queue. Callbacks run in order; once one has called `init`, the later
 * ones wait for it, and callbacks pushed later run at once.
 */
import { installDeferred } from "../core/deferred";
import type { Logger } from "../log/logger";
import { runLegacy, type CompatLog, type CompatSdk } from "./facade";
import { REF_DEFERRED, REF_GLOBAL, REF_LINK_CONTAINER } from "./names";
import { LINK_PLACEMENT } from "./prompts";

/** The attribute OpenPush's placed button renders into. */
const BUTTON_ATTR = "data-openpush-button";

/**
 * Puts the compat object on `win[REF_GLOBAL]`, drains `win[REF_DEFERRED]` and any items of the
 * previous array queue found on `win[REF_GLOBAL]`.
 */
export function installGlobals(
  win: object,
  compat: CompatSdk,
  initialized: () => Promise<void> | undefined,
  log: Logger,
): void {
  const slot = win as Record<string, unknown>;
  const legacy = Array.isArray(slot[REF_GLOBAL]) ? (slot[REF_GLOBAL] as unknown[]) : [];
  slot[REF_GLOBAL] = compat;
  const queue = installDeferred(win, compat, initialized, log, REF_DEFERRED);
  const compatLog: CompatLog = log;
  compat.push = (item: unknown): void => {
    queue.push(() => runLegacy(compat, item, compatLog));
  };
  for (const item of legacy) compat.push(item);
}

/**
 * Marks the reference's placed-link containers with `data-openpush-button` (the compat button's
 * placement), now and when they are added later. Returns a function that stops watching.
 */
export function markLinkContainers(doc: Document | undefined): () => void {
  if (!doc) return () => undefined;
  const mark = (root: ParentNode): void => {
    for (const element of root.querySelectorAll(`.${REF_LINK_CONTAINER}`)) {
      if (!element.hasAttribute(BUTTON_ATTR)) element.setAttribute(BUTTON_ATTR, LINK_PLACEMENT);
    }
  };
  mark(doc);
  if (typeof MutationObserver !== "function" || !doc.body) return () => undefined;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        const element = node as Element;
        if (element.classList.contains(REF_LINK_CONTAINER) && !element.hasAttribute(BUTTON_ATTR)) {
          element.setAttribute(BUTTON_ATTR, LINK_PLACEMENT);
        }
        mark(element);
      }
    }
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
