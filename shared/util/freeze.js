// Recursively freezes plain objects/arrays so engine rules can't be mutated at
// runtime (ES modules are strict, so writes to a frozen object throw).
// Functions, class instances' prototypes and already-frozen values are left as-is.

export function deepFreeze(obj, seen = new Set()) {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function') || seen.has(obj)) return obj;
  seen.add(obj);
  for (const key of Reflect.ownKeys(obj)) {
    const desc = Object.getOwnPropertyDescriptor(obj, key);
    if (desc && 'value' in desc) deepFreeze(desc.value, seen);
  }
  return Object.freeze(obj);
}

/** Freezes every export of a module namespace-like object (e.g. `deepFreezeAll({ A, B })`). */
export function deepFreezeAll(exportsObj) {
  for (const v of Object.values(exportsObj)) deepFreeze(v);
  return exportsObj;
}
