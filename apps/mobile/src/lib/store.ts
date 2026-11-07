import { useSyncExternalStore } from "react";

/** Tiny observable value with a React hook; enough for app-wide UI state. */
export function create<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      subs.forEach((f) => f());
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    use(): T {
      return useSyncExternalStore(this.subscribe, this.get);
    },
  };
}
