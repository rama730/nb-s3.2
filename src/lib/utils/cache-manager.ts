// Cache manager for handling browser storage and caches

class CacheManager {
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

    async clearAll(): Promise<void> {
        // Clear localStorage
        if (typeof localStorage !== "undefined") {
            localStorage.clear();
        }

        // Clear sessionStorage
        if (typeof sessionStorage !== "undefined") {
            sessionStorage.clear();
        }

        // Clear IndexedDB databases
        if (typeof indexedDB !== "undefined") {
            const databases = await indexedDB.databases?.() || [];
            for (const db of databases) {
                if (db.name) {
                    await this.deleteIndexedDb(db.name);
                }
            }
        }

        // Clear Cache API caches
        if (typeof caches !== "undefined") {
            const cacheNames = await caches.keys();
            for (const name of cacheNames) {
                await caches.delete(name);
            }
        }
    }

    // Clear specific cache types
    async clearLocalStorage(): Promise<void> {
        if (typeof localStorage !== "undefined") {
            localStorage.clear();
        }
    }

    async clearSessionStorage(): Promise<void> {
        if (typeof sessionStorage !== "undefined") {
            sessionStorage.clear();
        }
    }

    async clearIndexedDB(): Promise<void> {
        if (typeof indexedDB !== "undefined") {
            const databases = await indexedDB.databases?.() || [];
            for (const db of databases) {
                if (db.name) {
                    await this.deleteIndexedDb(db.name);
                }
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
