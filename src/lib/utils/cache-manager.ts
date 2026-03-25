import { APPEARANCE_STORAGE_KEYS } from "@/lib/theme/appearance";

const KNOWN_INDEXED_DB_NAMES = ["keyval-store"] as const;
const PRESERVED_LOCAL_STORAGE_KEYS = Object.values(APPEARANCE_STORAGE_KEYS);

export type StorageCategoryUsage = {
    id: string;
    label: string;
    description: string;
    size: number;
    isPrimary: boolean;
};

export type CacheClearReport = {
    clearedLocalStorageKeys: number;
    clearedSessionStorageKeys: number;
    clearedIndexedDbDatabases: number;
    clearedCacheBuckets: number;
    preservedLocalStorageKeys: string[];
};

// Prefixes used by the application for user-specific data
const USER_DATA_PREFIXES = [
    "files-offline-queue:",
    "chat-draft:",
    "quick-notes:",
    "user-preferences:",
];

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

    private async deleteIndexedDb(name: string): Promise<boolean> {
        if (typeof indexedDB === "undefined") return false;

        return new Promise<boolean>((resolve) => {
            try {
                const request = indexedDB.deleteDatabase(name);
                request.onsuccess = () => resolve(true);
                request.onerror = () => resolve(false);
                request.onblocked = () => resolve(false);
            } catch (error) {
                console.error("Error deleting IndexedDB database:", error);
                resolve(false);
            }
        });
    }

    private async listIndexedDbNames(): Promise<string[]> {
        if (typeof indexedDB === "undefined") return [];

        const enumerateDatabases = indexedDB.databases;
        if (typeof enumerateDatabases === "function") {
            try {
                const databases = await enumerateDatabases.call(indexedDB);
                return (databases || [])
                    .map((db) => db.name)
                    .filter((name): name is string => !!name);
            } catch {
                return [...KNOWN_INDEXED_DB_NAMES];
            }
        }
        return [...KNOWN_INDEXED_DB_NAMES];
    }

    async getStorageEstimate(): Promise<{ total: number; quota: number; persistent: boolean }> {
        if (typeof navigator === "undefined" || !navigator.storage) {
            return { total: 0, quota: 0, persistent: false };
        }

        try {
            const [estimate, persistent] = await Promise.all([
                navigator.storage.estimate(),
                navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false),
            ]);
            return {
                total: estimate.usage || 0,
                quota: estimate.quota || 0,
                persistent,
            };
        } catch {
            return { total: 0, quota: 0, persistent: false };
        }
    }

    async requestPersistence(): Promise<boolean> {
        if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.persist) {
            return await navigator.storage.persist();
        }
        return false;
    }

    async getDetailedBreakdown(): Promise<StorageCategoryUsage[]> {
        const breakdown: StorageCategoryUsage[] = [];

        // 1. App Bundle Cache (Cache API)
        let cacheSize = 0;
        if (typeof caches !== "undefined") {
            const keys = await caches.keys();
            for (const key of keys) {
                const cache = await caches.open(key);
                const reqs = await cache.keys();
                for (const req of reqs) {
                    const res = await cache.match(req);
                    if (res) {
                        try {
                            const blob = await res.blob();
                            cacheSize += blob.size;
                        } catch {
                            // ignore opaque or errored responses
                        }
                    }
                }
            }
        }
        breakdown.push({
            id: "app-cache",
            label: "Application Bundle",
            description: "Static assets, fonts, icons, and code chunks for faster loading.",
            size: cacheSize,
            isPrimary: false,
        });

        // 2. User Workspace (LocalStorage - Offline Queues & Drafts)
        let workspaceSize = 0;
        let hasPendingWork = false;
        if (typeof localStorage !== "undefined") {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key) {
                    const value = localStorage.getItem(key) || "";
                    const size = key.length + value.length;
                    if (USER_DATA_PREFIXES.some(p => key.startsWith(p))) {
                        workspaceSize += size;
                        if (key.includes("queue")) hasPendingWork = true;
                    }
                }
            }
        }
        breakdown.push({
            id: "user-workspace",
            label: "Workspace Data",
            description: hasPendingWork ? "Contains unsaved offline changes." : "Local drafts and workspace history.",
            size: workspaceSize,
            isPrimary: true,
        });

        return breakdown;
    }

    async clearStaticsOnly(): Promise<void> {
        // Clear Cache API (Static assets)
        if (typeof caches !== "undefined") {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
        }
        // Clear non-essential items from LocalStorage
        if (typeof localStorage !== "undefined") {
            const preserved = this.readPreservedLocalStorageEntries();
            const userEntries: Array<[string, string]> = [];
            
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && USER_DATA_PREFIXES.some(p => key.startsWith(p))) {
                    userEntries.push([key, localStorage.getItem(key)!]);
                }
            }

            localStorage.clear();
            this.restoreLocalStorageEntries([...preserved, ...userEntries]);
        }
    }

    async backupUserStore(): Promise<string | null> {
        if (typeof localStorage === "undefined") return null;
        
        const backup: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && USER_DATA_PREFIXES.some(p => key.startsWith(p))) {
                backup[key] = localStorage.getItem(key)!;
            }
        }

        if (Object.keys(backup).length === 0) return null;
        return JSON.stringify(backup, null, 2);
    }

    async clearAll(): Promise<CacheClearReport> {
        const preserved = this.readPreservedLocalStorageEntries();
        const initialLocalStorageCount = typeof localStorage !== "undefined" ? localStorage.length : 0;
        const initialSessionStorageCount = typeof sessionStorage !== "undefined" ? sessionStorage.length : 0;

        // Perform clearing
        await Promise.all([
            this.clearLocalStorage(),
            this.clearSessionStorage(),
            this.clearIndexedDB(),
            this.clearCacheAPI(),
        ]);

        const dbNames = await this.listIndexedDbNames();
        const cacheNames = typeof caches !== "undefined" ? await caches.keys() : [];

        return {
            clearedLocalStorageKeys: Math.max(0, initialLocalStorageCount - preserved.length),
            clearedSessionStorageKeys: initialSessionStorageCount,
            clearedIndexedDbDatabases: dbNames.length, // approximation as we just cleared them
            clearedCacheBuckets: cacheNames.length, // approximation
            preservedLocalStorageKeys: preserved.map(([k]) => k),
        };
    }

    // Individual clearing methods for granular UI
    async clearLocalStorage(): Promise<void> {
        if (typeof localStorage !== "undefined") {
            const preserved = this.readPreservedLocalStorageEntries();
            localStorage.clear();
            this.restoreLocalStorageEntries(preserved);
        }
    }

    async clearSessionStorage(): Promise<void> {
        if (typeof sessionStorage !== "undefined") sessionStorage.clear();
    }

    async clearIndexedDB(): Promise<void> {
        if (typeof indexedDB !== "undefined") {
            const names = await this.listIndexedDbNames();
            await Promise.all(names.map(name => this.deleteIndexedDb(name)));
        }
    }

    async clearCacheAPI(): Promise<void> {
        if (typeof caches !== "undefined") {
            const names = await caches.keys();
            await Promise.all(names.map(name => caches.delete(name)));
        }
    }
}

export const cacheManager = new CacheManager();
