import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { APPEARANCE_STORAGE_KEYS } from "@/lib/theme/appearance";
import { CacheManager } from "@/lib/utils/cache-manager";

class MemoryStorage implements Storage {
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

const originalLocalStorage = globalThis.localStorage;
const originalSessionStorage = globalThis.sessionStorage;
const originalCaches = globalThis.caches;
const originalIndexedDb = globalThis.indexedDB;

function installDeleteDatabaseRecorder(target: string[]) {
    return (name: string) => {
        target.push(name);
        const request: {
            onsuccess: null | (() => void);
            onerror: null | (() => void);
            onblocked: null | (() => void);
        } = {
            onsuccess: null,
            onerror: null,
            onblocked: null,
        };

        queueMicrotask(() => {
            request.onsuccess?.();
        });

        return request;
    };
}

afterEach(() => {
    globalThis.localStorage = originalLocalStorage;
    globalThis.sessionStorage = originalSessionStorage;
    globalThis.caches = originalCaches;
    globalThis.indexedDB = originalIndexedDb;
});

describe("cache manager", () => {
    it("clears local app data while preserving appearance preferences", async () => {
        const localStorage = new MemoryStorage();
        localStorage.setItem(APPEARANCE_STORAGE_KEYS.theme, "dark");
        localStorage.setItem("project_wizard_draft", "{\"id\":\"draft-1\"}");

        const sessionStorage = new MemoryStorage();
        sessionStorage.setItem("hub-session", "recent");

        const deletedCacheNames: string[] = [];
        const deletedDatabaseNames: string[] = [];

        globalThis.localStorage = localStorage;
        globalThis.sessionStorage = sessionStorage;
        globalThis.caches = {
            keys: async () => ["app-shell", "image-previews"],
            delete: async (name: string) => {
                deletedCacheNames.push(name);
                return true;
            },
            has: async () => false,
            match: async () => undefined,
            open: async () => {
                throw new Error("not implemented");
            },
        } as unknown as CacheStorage;
        globalThis.indexedDB = {
            databases: async () => [{ name: "keyval-store" }],
            deleteDatabase: installDeleteDatabaseRecorder(deletedDatabaseNames),
        } as unknown as IDBFactory;

        const manager = new CacheManager();
        const result = await manager.clearAll();

        assert.equal(localStorage.getItem(APPEARANCE_STORAGE_KEYS.theme), "dark");
        assert.equal(localStorage.getItem("project_wizard_draft"), null);
        assert.equal(sessionStorage.length, 0);
        assert.deepEqual(deletedCacheNames, ["app-shell", "image-previews"]);
        assert.deepEqual(deletedDatabaseNames, ["keyval-store"]);
        assert.equal(result.clearedLocalStorageKeys, 2);
        assert.equal(result.clearedSessionStorageKeys, 1);
        assert.equal(result.clearedIndexedDbDatabases, 1);
        assert.equal(result.clearedCacheBuckets, 2);
        assert.deepEqual(result.preservedLocalStorageKeys, [APPEARANCE_STORAGE_KEYS.theme]);
    });

    it("falls back to the known IndexedDB store name when enumeration is unavailable", async () => {
        const deletedDatabaseNames: string[] = [];

        globalThis.localStorage = new MemoryStorage();
        globalThis.sessionStorage = new MemoryStorage();
        globalThis.indexedDB = {
            deleteDatabase: installDeleteDatabaseRecorder(deletedDatabaseNames),
        } as unknown as IDBFactory;

        const manager = new CacheManager();
        await manager.clearIndexedDB();

        assert.deepEqual(deletedDatabaseNames, ["keyval-store"]);
    });
});
