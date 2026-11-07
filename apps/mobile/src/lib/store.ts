import { useSyncExternalStore } from "react";

export interface Store<T> {
  get: () => T;
  set: (next: T) => void;
  subscribe: (fn: () => void) => () => void;
}

/** Tiny observable value; read it in components with `useStore(store)`. */
export function create<T>(initial: T): Store<T> {
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
  };
}

/**
 * A real hook (named use*), not a `store.use()` method: the React Compiler treats calls named
 * `use()` like React's `use` API and may cache them, which skips the hook on re-render and
 * breaks hook order (seen as a crash in updateEffect on device).
 */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
