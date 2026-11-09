/**
 * DOM helpers for the prompt UI (`nonce`): elements are built with `createElement`
 * and `textContent` only (never HTML strings), listeners with `addEventListener` (never inline
 * handlers), and each prompt lives in its own shadow root with one `<style>`, which carries the
 * page's CSP nonce when one is given.
 */
const SVG = "http://www.w3.org/2000/svg";

export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A small line icon from path data (the bell, the close cross). */
export function icon(doc: Document, paths: readonly string[]): SVGSVGElement {
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of paths) {
    const path = doc.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

export const BELL_PATHS = ["M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15Z", "M10 20.5h4"];
export const BELL_OFF_PATHS = [...BELL_PATHS, "M4 4l16 16"];
export const CLOSE_PATHS = ["M6 6l12 12", "M18 6L6 18"];

/** Attaches an open shadow root to `host` (or reuses ours) with the one `<style>`. */
export function shadow(host: HTMLElement, css: string, nonce: string | undefined): ShadowRoot {
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  while (root.firstChild) root.removeChild(root.firstChild);
  const style = host.ownerDocument.createElement("style");
  if (nonce) style.setAttribute("nonce", nonce);
  style.textContent = css;
  root.appendChild(style);
  return root;
}

/** A host element of our own on `<body>`, marked with the prompt type. */
export function floatingHost(doc: Document, kind: string): HTMLElement {
  const host = doc.createElement("div");
  host.setAttribute("data-openpush-prompt", kind);
  (doc.body ?? doc.documentElement).appendChild(host);
  return host;
}

export function remove(node: Node | undefined | null): void {
  node?.parentNode?.removeChild(node);
}

/** A button with a label, a class and a click handler. */
export function button(doc: Document, className: string, label: string, onClick: (event: Event) => void): HTMLButtonElement {
  const b = el(doc, "button", className, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/** The close cross, with its accessible name. */
export function closeButton(doc: Document, label: string, onClick: () => void): HTMLButtonElement {
  const b = el(doc, "button", "x");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.appendChild(icon(doc, CLOSE_PATHS));
  b.addEventListener("click", onClick);
  return b;
}

let counter = 0;
/** A unique id inside a shadow root (for aria-labelledby). */
export function uid(prefix: string): string {
  counter += 1;
  return `op-${prefix}-${counter}`;
}
