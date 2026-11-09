/**
 * Puts a module's named exports on its default export as non-enumerable properties, so a CommonJS
 * `require` returns the default export and still reaches the named ones. `default` points back at
 * the object, for code compiled with ES module interop.
 */
export function withNamed<T extends object>(target: T, named: Record<string, unknown>): T {
  for (const [key, value] of Object.entries(named)) {
    if (key === "default" || key in target) continue;
    Object.defineProperty(target, key, { value, enumerable: false, configurable: true });
  }
  if (!("default" in target)) Object.defineProperty(target, "default", { value: target, enumerable: false, configurable: true });
  return target;
}
