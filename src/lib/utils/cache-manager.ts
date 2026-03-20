import { APPEARANCE_STORAGE_KEYS } from "@/lib/theme/appearance";

const KNOWN_INDEXED_DB_NAMES = ["keyval-store"] as const;
const PRESERVED_LOCAL_STORAGE_KEYS = Object.values(APPEARANCE_STORAGE_KEYS);

export type CacheClearReport = {
    clearedLocalStorageKeys: number;
    clearedSessionStorageKeys: number;
    clearedIndexedDbDatabases: number;
    clearedCacheBuckets: number;
    preservedLocalStorageKeys: string[];
};

// Cache manager for handling browser storage and caches

export class CacheManager {
    private readPreservedLocalStorageEntries(): Array<[string, string]> {
        if (typeof localStorage === "undefined") return [];

        return PRESERVED_LOCAL_STORAGE_KEYS.flatMap((key) => {
            const value = localStorage.getItem(key);
            return value === null ? [] : [[key, value] as const];
        });
    }

    private restoreLocalStorageEntries(entries: Array<[string, string]>): void {
        if (typeof localStorage === "undefined") return;

        for (const [key, value] of entries) {
            localStorage.setItem(key, value);
        }
    }

    private async deleteIndexedDb(name: string): Promise<void> {
        if (typeof indexedDB === "undefined" || !name) return;

        await new Promise<void>((resolve) => {
            try {
                const request = indexedDB.deleteDatabase(name);
                request.onsuccess = () => resolve();
                request.onerror = () => {
                    console.error("Failed to delete IndexedDB database", { name });
                    resolve();
                };
                request.onblocked = () => {
                    console.warn("IndexedDB delete blocked", { name });
                    resolve();
                };
            } catch (error) {
                console.error("Error deleting IndexedDB database", { name, error });
                resolve();
            }
        });
    }

    private async listIndexedDbNames(): Promise<string[]> {
        if (typeof indexedDB === "undefined") return [];

        const enumerateDatabases = indexedDB.databases;
        if (typeof enumerateDatabases === "function") {
            try {
                const databases = await enumerateDatabases.call(indexedDB);
                const names = Array.from(
                    new Set(
                        (databases || [])
                            .map((db) => db.name)
                            .filter((name): name is string => typeof name === "string" && name.length > 0)
                    )
                );

                if (names.length > 0) {
                    return names;
                }
            } catch (error) {
                console.warn("Failed to enumerate IndexedDB databases", error);
            }
        }

        return [...KNOWN_INDEXED_DB_NAMES];
    }

    async getStorageEstimate(): Promise<{ total: number; quota: number }> {
        if (typeof navigator === "undefined" || !navigator.storage) {
            return { total: 0, quota: 0 };
        }

        try {
            const estimate = await navigator.storage.estimate();
            return {
                total: estimate.usage || 0,
                quota: estimate.quota || 0,
            };
        } catch (error) {
            console.error("Failed to get storage estimate:", error);
            return { total: 0, quota: 0 };
        }
    }

    async clearAll(): Promise<CacheClearReport> {
        const preservedEntries = this.readPreservedLocalStorageEntries();
        let clearedLocalStorageKeys = 0;
        let clearedSessionStorageKeys = 0;
        let clearedIndexedDbDatabases = 0;
        let clearedCacheBuckets = 0;

        // Clear localStorage while preserving the user's appearance settings.
        if (typeof localStorage !== "undefined") {
            clearedLocalStorageKeys = localStorage.length;
            localStorage.clear();
            this.restoreLocalStorageEntries(preservedEntries);
        }

        // Clear sessionStorage
        if (typeof sessionStorage !== "undefined") {
            clearedSessionStorageKeys = sessionStorage.length;
            sessionStorage.clear();
        }

        // Clear IndexedDB databases
        if (typeof indexedDB !== "undefined") {
            const databaseNames = await this.listIndexedDbNames();
            for (const name of databaseNames) {
                await this.deleteIndexedDb(name);
                clearedIndexedDbDatabases += 1;
            }
        }

        // Clear Cache API caches
        if (typeof caches !== "undefined") {
            const cacheNames = await caches.keys();
            for (const name of cacheNames) {
                await caches.delete(name);
                clearedCacheBuckets += 1;
            }
        }

        return {
            clearedLocalStorageKeys,
            clearedSessionStorageKeys,
            clearedIndexedDbDatabases,
            clearedCacheBuckets,
            preservedLocalStorageKeys: preservedEntries.map(([key]) => key),
        };
    }

    // Clear specific cache types
    async clearLocalStorage(): Promise<void> {
        if (typeof localStorage !== "undefined") {
            const preservedEntries = this.readPreservedLocalStorageEntries();
            localStorage.clear();
            this.restoreLocalStorageEntries(preservedEntries);
        }
    }

    async clearSessionStorage(): Promise<void> {
        if (typeof sessionStorage !== "undefined") {
            sessionStorage.clear();
        }
    }

    async clearIndexedDB(): Promise<void> {
        if (typeof indexedDB !== "undefined") {
            const databaseNames = await this.listIndexedDbNames();
            for (const name of databaseNames) {
                await this.deleteIndexedDb(name);
            }
        }
    }

    async clearCacheAPI(): Promise<void> {
        if (typeof caches !== "undefined") {
            const cacheNames = await caches.keys();
            for (const name of cacheNames) {
                await caches.delete(name);
            }
        }
    }
}

export const cacheManager = new CacheManager();
