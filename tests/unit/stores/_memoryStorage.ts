// Hermetic localStorage shim for store persist tests.
//
// Zustand's persist middleware calls `createJSONStorage(() => localStorage)`
// once at import time. `createJSONStorage` swallows the `ReferenceError` that
// would otherwise be thrown in a Node test environment and then returns
// `undefined`, which disables persistence. To exercise the persist contract
// we need to install a Storage-compatible object on `globalThis.localStorage`
// BEFORE the store module is imported. Test files import this module first
// to guarantee that ordering.

export class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

/**
 * Replace `globalThis.localStorage` with a fresh `MemoryStorage`. Returns a
 * cleanup callback that restores the previous value.
 */
export function installMemoryLocalStorage(): { storage: MemoryStorage; restore: () => void } {
  const previous = (globalThis as { localStorage?: Storage }).localStorage;
  const storage = new MemoryStorage();
  (globalThis as { localStorage?: Storage }).localStorage = storage;
  return {
    storage,
    restore: () => {
      if (previous === undefined) {
        delete (globalThis as { localStorage?: Storage }).localStorage;
      } else {
        (globalThis as { localStorage?: Storage }).localStorage = previous;
      }
    },
  };
}
