import { getRedisClient } from '../../../src/lib/redis'

type HashEntries = Record<string, string>

export type PresenceSubscriber<TMessage = unknown> = {
    on: (type: 'message' | 'error', listener: (event: any) => void) => void
    unsubscribe: (channels?: string[]) => Promise<void>
}

export type PresenceStore = {
    set: (key: string, value: string, options?: { ex?: number }) => Promise<unknown>
    get: (key: string) => Promise<string | null>
    del: (key: string) => Promise<unknown>
    hset: (key: string, values: HashEntries) => Promise<unknown>
    expire: (key: string, ttlSeconds: number) => Promise<unknown>
    hdel: (key: string, field: string) => Promise<unknown>
    hgetall: <TResult extends Record<string, string>>(key: string) => Promise<TResult | null>
    hlen: (key: string) => Promise<number>
    publish: (channel: string, message: string) => Promise<unknown>
    subscribe: <TMessage>(channel: string | string[]) => PresenceSubscriber<TMessage>
}

type InMemorySubscription = {
    channels: Set<string>
    messageListeners: Set<(event: { message?: string }) => void>
    errorListeners: Set<(event: Error) => void>
}

class InMemoryPresenceStore implements PresenceStore {
    private hashes = new Map<string, Map<string, string>>()
    private strings = new Map<string, string>()
    private expiryTimers = new Map<string, ReturnType<typeof setTimeout>>()
    private subscriptions = new Set<InMemorySubscription>()

    async set(key: string, value: string, options?: { ex?: number }) {
        this.strings.set(key, value)
        if (options?.ex !== undefined) {
            await this.expire(key, options.ex)
        }
        return "OK"
    }

    async get(key: string) {
        return this.strings.get(key) ?? null
    }

    async del(key: string) {
        this.strings.delete(key)
    }

    async hset(key: string, values: HashEntries) {
        const hash = this.hashes.get(key) ?? new Map<string, string>()
        for (const [field, value] of Object.entries(values)) {
            hash.set(field, value)
        }
        this.hashes.set(key, hash)
    }

    async expire(key: string, ttlSeconds: number) {
        const existingTimer = this.expiryTimers.get(key)
        if (existingTimer) {
            clearTimeout(existingTimer)
        }

        if (ttlSeconds <= 0) {
            this.hashes.delete(key)
            this.strings.delete(key)
            this.expiryTimers.delete(key)
            return
        }

        const timer = setTimeout(() => {
            this.hashes.delete(key)
            this.strings.delete(key)
            this.expiryTimers.delete(key)
        }, ttlSeconds * 1000)

        this.expiryTimers.set(key, timer)
    }

    async hdel(key: string, field: string) {
        const hash = this.hashes.get(key)
        if (!hash) return
        hash.delete(field)
        if (hash.size === 0) {
            this.hashes.delete(key)
        }
    }

    async hgetall<TResult extends Record<string, string>>(key: string) {
        const hash = this.hashes.get(key)
        if (!hash || hash.size === 0) {
            return null
        }

        return Object.fromEntries(hash.entries()) as TResult
    }

    async hlen(key: string) {
        return this.hashes.get(key)?.size ?? 0
    }

    async publish(channel: string, message: string) {
        for (const subscription of this.subscriptions) {
            if (!subscription.channels.has(channel)) continue
            for (const listener of subscription.messageListeners) {
                listener({ message })
            }
        }

        return 1
    }

    subscribe<TMessage>(channel: string | string[]) {
        const subscription: InMemorySubscription = {
            channels: new Set(Array.isArray(channel) ? channel : [channel]),
            messageListeners: new Set(),
            errorListeners: new Set(),
        }

        this.subscriptions.add(subscription)

        return {
            on: (type: 'message' | 'error', listener: (event: any) => void) => {
                if (type === 'message') {
                    subscription.messageListeners.add(listener as (event: { message?: string }) => void)
                } else {
                    subscription.errorListeners.add(listener as (event: Error) => void)
                }
            },
            unsubscribe: async (channels?: string[]) => {
                if (channels?.length) {
                    for (const name of channels) {
                        subscription.channels.delete(name)
                    }
                } else {
                    subscription.channels.clear()
                }

                if (subscription.channels.size === 0) {
                    this.subscriptions.delete(subscription)
                }
            },
        }
    }
}

let inMemoryPresenceStore: InMemoryPresenceStore | null = null

function getInMemoryPresenceStore() {
    if (!inMemoryPresenceStore) {
        inMemoryPresenceStore = new InMemoryPresenceStore()
    }

    return inMemoryPresenceStore
}

type PresenceStoreMode = 'auto' | 'redis' | 'memory'

function getPresenceStoreMode(env: NodeJS.ProcessEnv): PresenceStoreMode {
    const rawMode = (env.PRESENCE_STORE_MODE || env.PRESENCE_TRANSPORT || '').trim().toLowerCase()
    if (rawMode === 'redis' || rawMode === 'memory') {
        return rawMode
    }
    return 'auto'
}

export function createPresenceStore(options?: {
    env?: NodeJS.ProcessEnv
    redisClient?: PresenceStore | ReturnType<typeof getRedisClient>
}) {
    const env = options?.env ?? process.env
    const mode = getPresenceStoreMode(env)
    const isProduction = env.NODE_ENV === 'production'

    if (mode === 'memory') {
        if (isProduction) {
            throw new Error('In-memory presence transport is not allowed in production')
        }
        console.warn('[presence] Using in-memory local presence transport.')
        return {
            mode: 'memory' as const,
            store: getInMemoryPresenceStore(),
        }
    }

    const shouldUseRedis = mode === 'redis' || isProduction
    if (shouldUseRedis) {
        const redisClient = options && 'redisClient' in options ? options.redisClient : getRedisClient()
        if (redisClient) {
            return {
                mode: 'redis' as const,
                store: redisClient as unknown as PresenceStore,
            }
        }
        throw new Error('Upstash Redis is required for the dedicated presence service')
    }

    // Local development runs a single dedicated presence service, so Redis pub/sub is
    // unnecessary and can produce noisy aborted stream logs from Upstash's SSE reader.
    // Set PRESENCE_STORE_MODE=redis when explicitly testing the Redis backplane.
    console.warn('[presence] Using in-memory local presence transport. Set PRESENCE_STORE_MODE=redis to test Redis pub/sub locally.')

    return {
        mode: 'memory' as const,
        store: getInMemoryPresenceStore(),
    }
}
