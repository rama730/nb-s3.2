'use client'

import { MotionConfig } from 'framer-motion'
import { ThemeProvider as NextThemesProvider, useTheme as useNextTheme } from 'next-themes'
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { isHardeningDomainEnabled } from '@/lib/features/hardening'
import { logger } from '@/lib/logger'
import {
    APPEARANCE_STORAGE_KEYS,
    type AccentColor,
    type AppearanceSnapshot,
    type Density,
    DEFAULT_APPEARANCE_SNAPSHOT,
    type ResolvedTheme,
    type ThemeMode,
    areAppearanceSnapshotsEquivalent,
    choosePreferredSnapshot,
    createAppearanceSnapshot,
    isSnapshotNewer,
    normalizeThemeMode,
    readLocalAppearanceSnapshot,
    resolveThemeMode,
    writeAppearanceSnapshot,
} from '@/lib/theme/appearance'
import {
    type AppearanceSyncState,
    readAppearanceSettings,
    resetAppearanceSettings,
    writeAppearanceSettings,
} from '@/lib/theme/appearance-client'
import { resolveReducedMotionPreference } from '@/lib/theme/appearance-runtime'
import { isReducedMotionEnabled, prefersReducedMotionFromSystem } from '@/lib/theme/reduced-motion'

const REMOTE_SYNC_DEBOUNCE_MS = 900
const REMOTE_SYNC_RETRY_DELAYS_MS = [1_500, 5_000, 15_000]

let themeTransitionInFlight = false

interface ThemeContextValue {
    theme: ThemeMode;
    resolvedTheme: ResolvedTheme;
    setTheme: (theme: ThemeMode) => void;
    setThemeWithTransition: (theme: ThemeMode) => Promise<void>;
    isThemeTransitioning: boolean;
}

interface AppearanceContextValue {
    accentColor: AccentColor;
    setAccentColor: (color: AccentColor) => void;
    density: Density;
    setDensity: (density: Density) => void;
    reduceMotion: boolean;
    setReduceMotion: (reduce: boolean) => void;
    syncState: AppearanceSyncState;
    lastSyncedAt?: string;
    resetAppearance: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)
const AppearanceContext = createContext<AppearanceContextValue | undefined>(undefined)

interface ThemeProviderProps {
    children: ReactNode
}

function ensureThemeColorMeta(content: string) {
    let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
    if (!meta) {
        meta = document.createElement('meta')
        meta.name = 'theme-color'
        document.head.appendChild(meta)
    }
    if (meta.content !== content) meta.content = content
}

function ThemeRuntimeProvider({ children }: ThemeProviderProps) {
    const { theme: rawTheme, resolvedTheme: rawResolvedTheme, setTheme: setNextTheme } = useNextTheme()
    const theme = normalizeThemeMode(rawTheme, DEFAULT_APPEARANCE_SNAPSHOT.theme)
    const resolvedTheme: ResolvedTheme = rawResolvedTheme === 'dark' ? 'dark' : 'light'

    const [accentColor, setAccentColorState] = useState<AccentColor>(DEFAULT_APPEARANCE_SNAPSHOT.accentColor)
    const [density, setDensityState] = useState<Density>(DEFAULT_APPEARANCE_SNAPSHOT.density)
    const [reduceMotion, setReduceMotionState] = useState<boolean>(DEFAULT_APPEARANCE_SNAPSHOT.reduceMotion)
    const [isThemeTransitioning, setIsThemeTransitioning] = useState(false)
    const [viewerId, setViewerId] = useState<string | null>(null)
    const [shellHardeningEnabled, setShellHardeningEnabled] = useState(
        isHardeningDomainEnabled('shellV1', null),
    )
    const [profileHardeningEnabled, setProfileHardeningEnabled] = useState(
        isHardeningDomainEnabled('profileV1', null),
    )
    const [syncState, setSyncState] = useState<AppearanceSyncState>('idle')
    const [lastSyncedAt, setLastSyncedAt] = useState<string | undefined>(undefined)
    const [systemReduceMotion, setSystemReduceMotion] = useState(false)

    const bootstrappedRef = useRef(false)
    const pendingSyncRef = useRef<AppearanceSnapshot | null>(null)
    const lastSyncedSnapshotRef = useRef<AppearanceSnapshot | null>(null)
    const syncInFlightRef = useRef(false)
    const syncRetryIndexRef = useRef(0)
    const syncTimerRef = useRef<number | null>(null)
    const retryTimerRef = useRef<number | null>(null)

    const persistLocalSnapshot = useCallback((snapshot: AppearanceSnapshot, source: string) => {
        try {
            writeAppearanceSnapshot(snapshot, (key, value) => localStorage.setItem(key, value))
            logger.metric('theme.snapshot.local_persist', {
                source,
                theme: snapshot.theme,
                accentColor: snapshot.accentColor,
                density: snapshot.density,
            })
        } catch (error) {
            logger.metric('theme.snapshot.local_persist_failed', {
                source,
                error: error instanceof Error ? error.message : 'unknown',
            })
        }
    }, [])

    const buildNextSnapshot = useCallback((patch: Partial<AppearanceSnapshot>) => {
        return createAppearanceSnapshot({
            theme: patch.theme ?? theme,
            accentColor: patch.accentColor ?? accentColor,
            density: patch.density ?? density,
            reduceMotion: typeof patch.reduceMotion === 'boolean' ? patch.reduceMotion : reduceMotion,
            updatedAt: patch.updatedAt ?? new Date().toISOString(),
        })
    }, [accentColor, density, reduceMotion, theme])

    const applySnapshotLocally = useCallback((snapshot: AppearanceSnapshot, source: string) => {
        setAccentColorState(snapshot.accentColor)
        setDensityState(snapshot.density)
        setReduceMotionState(snapshot.reduceMotion)
        setNextTheme(snapshot.theme)
        persistLocalSnapshot(snapshot, source)
    }, [persistLocalSnapshot, setNextTheme])

    const flushRemoteSync = useCallback(async (reason: string) => {
        if (!profileHardeningEnabled || !viewerId) return
        if (syncInFlightRef.current) return

        const snapshot = pendingSyncRef.current
        if (!snapshot) return

        syncInFlightRef.current = true
        pendingSyncRef.current = null
        const startedAt = performance.now()
        let retryScheduled = false
        setSyncState('saving')

        try {
            if (lastSyncedSnapshotRef.current && areAppearanceSnapshotsEquivalent(lastSyncedSnapshotRef.current, snapshot)) {
                logger.metric('theme.sync.skip_stale', { reason, userId: viewerId })
                syncRetryIndexRef.current = 0
                setSyncState('saved')
                setLastSyncedAt(lastSyncedSnapshotRef.current.updatedAt)
                return
            }

            const result = await writeAppearanceSettings(snapshot)
            const savedSnapshot = result.snapshot ?? snapshot
            lastSyncedSnapshotRef.current = savedSnapshot
            setLastSyncedAt(savedSnapshot.updatedAt)
            setSyncState('saved')

            syncRetryIndexRef.current = 0
            logger.metric('theme.sync.success', {
                reason,
                userId: viewerId,
                durationMs: Math.round(performance.now() - startedAt),
            })
        } catch (error) {
            const retryIndex = syncRetryIndexRef.current
            const retryDelay = REMOTE_SYNC_RETRY_DELAYS_MS[retryIndex] ?? null
            logger.metric('theme.sync.failure', {
                reason,
                userId: viewerId,
                retryIndex,
                retryDelayMs: retryDelay ?? 0,
                error: error instanceof Error ? error.message : 'unknown',
            })

            if (retryDelay !== null) {
                syncRetryIndexRef.current = retryIndex + 1
                pendingSyncRef.current = snapshot
                if (retryTimerRef.current !== null) {
                    window.clearTimeout(retryTimerRef.current)
                }
                retryTimerRef.current = window.setTimeout(() => {
                    retryTimerRef.current = null
                    void flushRemoteSync('retry')
                }, retryDelay)
                retryScheduled = true
            } else {
                syncRetryIndexRef.current = 0
                setSyncState('save_failed')
            }
        } finally {
            syncInFlightRef.current = false
            if (pendingSyncRef.current && !retryScheduled) {
                if (retryTimerRef.current !== null) {
                    window.clearTimeout(retryTimerRef.current)
                }
                retryTimerRef.current = window.setTimeout(() => {
                    retryTimerRef.current = null
                    void flushRemoteSync('queued')
                }, 0)
            }
        }
    }, [profileHardeningEnabled, viewerId])

    const queueRemoteSync = useCallback((snapshot: AppearanceSnapshot, reason: string) => {
        if (!profileHardeningEnabled || !viewerId || !bootstrappedRef.current) return
        if (pendingSyncRef.current && areAppearanceSnapshotsEquivalent(pendingSyncRef.current, snapshot)) {
            return
        }
        if (lastSyncedSnapshotRef.current && areAppearanceSnapshotsEquivalent(lastSyncedSnapshotRef.current, snapshot)) {
            setSyncState('saved')
            setLastSyncedAt(lastSyncedSnapshotRef.current.updatedAt)
            return
        }
        pendingSyncRef.current = snapshot
        setSyncState('saving')

        if (syncTimerRef.current !== null) {
            window.clearTimeout(syncTimerRef.current)
        }
        if (retryTimerRef.current !== null) {
            window.clearTimeout(retryTimerRef.current)
            retryTimerRef.current = null
        }

        syncTimerRef.current = window.setTimeout(() => {
            void flushRemoteSync(reason)
        }, REMOTE_SYNC_DEBOUNCE_MS)
    }, [flushRemoteSync, profileHardeningEnabled, viewerId])

    const applyThemeMode = useCallback(async (nextTheme: ThemeMode, allowTransition: boolean) => {
        const startedAt = performance.now()
        const root = document.documentElement
        const transitionSupported = !!(document as Document & { startViewTransition?: (callback: () => void) => { finished: Promise<void> } }).startViewTransition

        if (!allowTransition || !shellHardeningEnabled) {
            setNextTheme(nextTheme)
            logger.metric('theme.toggle.ms', {
                mode: nextTheme,
                transitioned: false,
                durationMs: Math.round(performance.now() - startedAt),
            })
            return
        }

        if (themeTransitionInFlight) {
            logger.metric('theme.transition.duplicate_suppressed', { mode: nextTheme })
            setNextTheme(nextTheme)
            return
        }

        themeTransitionInFlight = true
        setIsThemeTransitioning(true)
        root.classList.add('theme-transition')

        try {
            const useViewTransition =
                transitionSupported
                && !isReducedMotionEnabled({
                    root: document.documentElement,
                    matchMedia: window.matchMedia?.bind(window),
                })
            if (!useViewTransition) {
                setNextTheme(nextTheme)
            } else {
                const transition = (document as Document & { startViewTransition: (callback: () => void) => { finished: Promise<void> } })
                    .startViewTransition(() => setNextTheme(nextTheme))
                await transition.finished
            }

            logger.metric('theme.toggle.ms', {
                mode: nextTheme,
                transitioned: useViewTransition,
                durationMs: Math.round(performance.now() - startedAt),
            })
        } catch (error) {
            setNextTheme(nextTheme)
            logger.metric('theme.toggle.error', {
                mode: nextTheme,
                error: error instanceof Error ? error.message : 'unknown',
            })
        } finally {
            window.setTimeout(() => root.classList.remove('theme-transition'), 220)
            themeTransitionInFlight = false
            setIsThemeTransitioning(false)
        }
    }, [setNextTheme, shellHardeningEnabled])

    const setTheme = useCallback((nextThemeInput: ThemeMode) => {
        const nextTheme = normalizeThemeMode(nextThemeInput, theme)
        if (nextTheme === theme) return

        const nextSnapshot = buildNextSnapshot({ theme: nextTheme })
        persistLocalSnapshot(nextSnapshot, 'set-theme')
        queueRemoteSync(nextSnapshot, 'set-theme')
        void applyThemeMode(nextTheme, false)
    }, [applyThemeMode, buildNextSnapshot, persistLocalSnapshot, queueRemoteSync, theme])

    const setThemeWithTransition = useCallback(async (nextThemeInput: ThemeMode) => {
        const nextTheme = normalizeThemeMode(nextThemeInput, theme)
        if (nextTheme === theme) return

        const nextSnapshot = buildNextSnapshot({ theme: nextTheme })
        persistLocalSnapshot(nextSnapshot, 'set-theme-transition')
        queueRemoteSync(nextSnapshot, 'set-theme-transition')
        await applyThemeMode(nextTheme, true)
    }, [applyThemeMode, buildNextSnapshot, persistLocalSnapshot, queueRemoteSync, theme])

    const setAccentColor = useCallback((nextAccent: AccentColor) => {
        if (nextAccent === accentColor) return
        setAccentColorState(nextAccent)
        const snapshot = buildNextSnapshot({ accentColor: nextAccent })
        persistLocalSnapshot(snapshot, 'set-accent')
        queueRemoteSync(snapshot, 'set-accent')
    }, [accentColor, buildNextSnapshot, persistLocalSnapshot, queueRemoteSync])

    const setDensity = useCallback((nextDensity: Density) => {
        if (nextDensity === density) return
        setDensityState(nextDensity)
        const snapshot = buildNextSnapshot({ density: nextDensity })
        persistLocalSnapshot(snapshot, 'set-density')
        queueRemoteSync(snapshot, 'set-density')
    }, [buildNextSnapshot, density, persistLocalSnapshot, queueRemoteSync])

    const setReduceMotion = useCallback((nextReduceMotion: boolean) => {
        if (nextReduceMotion === reduceMotion) return
        setReduceMotionState(nextReduceMotion)
        const snapshot = buildNextSnapshot({ reduceMotion: nextReduceMotion })
        persistLocalSnapshot(snapshot, 'set-reduce-motion')
        queueRemoteSync(snapshot, 'set-reduce-motion')
    }, [buildNextSnapshot, persistLocalSnapshot, queueRemoteSync, reduceMotion])

    const effectiveReduceMotion = reduceMotion || systemReduceMotion

    useEffect(() => {
        const root = document.documentElement
        root.style.colorScheme = resolvedTheme
        root.setAttribute('data-theme-mode', theme)
        root.setAttribute('data-accent', accentColor)
        root.setAttribute('data-density', density)
        if (effectiveReduceMotion) root.setAttribute('data-reduce-motion', 'true')
        else root.removeAttribute('data-reduce-motion')
        ensureThemeColorMeta(resolvedTheme === 'dark' ? '#0a0a0a' : '#ffffff')
    }, [accentColor, density, effectiveReduceMotion, resolvedTheme, theme])

    useEffect(() => {
        const media = window.matchMedia('(prefers-reduced-motion: reduce)')
        const update = () => {
            setSystemReduceMotion(
                resolveReducedMotionPreference({
                    matchMedia: window.matchMedia?.bind(window),
                }),
            )
        }
        update()
        media.addEventListener('change', update)
        return () => media.removeEventListener('change', update)
    }, [])

    useEffect(() => {
        let cancelled = false
        const startedAt = performance.now()
        const nowIso = new Date().toISOString()
        const localSnapshot = readLocalAppearanceSnapshot((key) => localStorage.getItem(key), nowIso)

        const root = document.documentElement
        const systemPrefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false
        const expectedResolved = resolveThemeMode(localSnapshot.theme, systemPrefersDark)
        const expectedDark = expectedResolved === 'dark'
        const mismatchReasons: string[] = []
        if (root.classList.contains('dark') !== expectedDark) mismatchReasons.push('dark-class')
        if (root.getAttribute('data-accent') !== localSnapshot.accentColor) mismatchReasons.push('accent')
        if (root.getAttribute('data-density') !== localSnapshot.density) mismatchReasons.push('density')
        const expectedReduceMotion = localSnapshot.reduceMotion || prefersReducedMotionFromSystem(window.matchMedia?.bind(window))
        if ((root.getAttribute('data-reduce-motion') === 'true') !== expectedReduceMotion) mismatchReasons.push('reduce-motion')
        if (mismatchReasons.length > 0) {
            logger.metric('theme.hydration_mismatch', {
                reasons: mismatchReasons.join(','),
                count: mismatchReasons.length,
            })
        }

        setAccentColorState(localSnapshot.accentColor)
        setDensityState(localSnapshot.density)
        setReduceMotionState(localSnapshot.reduceMotion)
        setNextTheme(localSnapshot.theme)
        persistLocalSnapshot(localSnapshot, 'bootstrap-local')
        bootstrappedRef.current = true
        setSyncState('idle')

        void readAppearanceSettings().then((result) => {
            if (cancelled) return
            const nextUserId = result.userId ?? null

            setViewerId(nextUserId)
            const nextShellEnabled = isHardeningDomainEnabled('shellV1', nextUserId)
            const nextProfileEnabled = isHardeningDomainEnabled('profileV1', nextUserId)
            setShellHardeningEnabled(nextShellEnabled)
            setProfileHardeningEnabled(nextProfileEnabled)
            lastSyncedSnapshotRef.current = result.snapshot

            if (!nextUserId || !nextProfileEnabled) {
                return
            }

            const remoteSnapshot = result.snapshot
            if (!remoteSnapshot) {
                logger.metric('theme.snapshot.fallback', {
                    source: 'remote',
                    reason: 'missing-or-invalid',
                })
                pendingSyncRef.current = localSnapshot
                setSyncState('saving')
                return
            }

            const preferredSnapshot = choosePreferredSnapshot(localSnapshot, remoteSnapshot)
            if (isSnapshotNewer(remoteSnapshot, localSnapshot)) {
                applySnapshotLocally(preferredSnapshot, 'bootstrap-remote-preferred')
                setLastSyncedAt(remoteSnapshot.updatedAt)
                setSyncState('saved')
                logger.metric('theme.snapshot.remote_preferred', { userId: nextUserId })
            } else {
                pendingSyncRef.current = localSnapshot
                setSyncState('saving')
                logger.metric('theme.snapshot.local_preferred', { userId: nextUserId })
            }
        }).catch((error: unknown) => {
            if (cancelled) return
            logger.metric('theme.snapshot.fallback', {
                source: 'remote',
                reason: 'request-failed',
                error: error instanceof Error ? error.message : 'unknown',
            })
            setSyncState('idle')
        }).finally(() => {
            logger.metric('theme.bootstrap.ms', {
                durationMs: Math.round(performance.now() - startedAt),
            })
        })

        return () => {
            cancelled = true
            if (syncTimerRef.current !== null) {
                window.clearTimeout(syncTimerRef.current)
                syncTimerRef.current = null
            }
            if (retryTimerRef.current !== null) {
                window.clearTimeout(retryTimerRef.current)
                retryTimerRef.current = null
            }
        }
    }, [applySnapshotLocally, persistLocalSnapshot, setNextTheme])

    useEffect(() => {
        if (!bootstrappedRef.current || !profileHardeningEnabled || !viewerId) return
        if (!pendingSyncRef.current) return
        void flushRemoteSync('viewer-ready')
    }, [flushRemoteSync, profileHardeningEnabled, viewerId])

    const resetAppearance = useCallback(async () => {
        const snapshot = createAppearanceSnapshot(DEFAULT_APPEARANCE_SNAPSHOT)
        applySnapshotLocally(snapshot, 'reset-local')
        if (!profileHardeningEnabled || !viewerId || !bootstrappedRef.current) {
            setSyncState('idle')
            setLastSyncedAt(undefined)
            return
        }
        pendingSyncRef.current = snapshot
        setSyncState('saving')
        if (syncTimerRef.current !== null) {
            window.clearTimeout(syncTimerRef.current)
            syncTimerRef.current = null
        }
        if (retryTimerRef.current !== null) {
            window.clearTimeout(retryTimerRef.current)
            retryTimerRef.current = null
        }
        try {
            const result = await resetAppearanceSettings()
            const savedSnapshot = result.snapshot ?? snapshot
            lastSyncedSnapshotRef.current = savedSnapshot
            pendingSyncRef.current = null
            syncRetryIndexRef.current = 0
            setLastSyncedAt(savedSnapshot.updatedAt)
            setSyncState('saved')
        } catch (error) {
            const retryIndex = syncRetryIndexRef.current
            const retryDelay = REMOTE_SYNC_RETRY_DELAYS_MS[retryIndex] ?? null
            logger.metric('theme.reset.failure', {
                userId: viewerId,
                retryIndex,
                retryDelayMs: retryDelay ?? 0,
                error: error instanceof Error ? error.message : 'unknown',
            })
            pendingSyncRef.current = snapshot
            if (retryDelay !== null) {
                syncRetryIndexRef.current = retryIndex + 1
                retryTimerRef.current = window.setTimeout(() => {
                    retryTimerRef.current = null
                    void flushRemoteSync('reset-retry')
                }, retryDelay)
                return
            }
            syncRetryIndexRef.current = 0
            setSyncState('save_failed')
        }
    }, [applySnapshotLocally, flushRemoteSync, profileHardeningEnabled, viewerId])

    const themeValue = useMemo<ThemeContextValue>(() => ({
        theme,
        resolvedTheme,
        setTheme,
        setThemeWithTransition,
        isThemeTransitioning,
    }), [isThemeTransitioning, resolvedTheme, setTheme, setThemeWithTransition, theme])

    const appearanceValue = useMemo<AppearanceContextValue>(() => ({
        accentColor,
        setAccentColor,
        density,
        setDensity,
        reduceMotion,
        setReduceMotion,
        syncState,
        lastSyncedAt,
        resetAppearance,
    }), [accentColor, density, lastSyncedAt, reduceMotion, resetAppearance, setAccentColor, setDensity, setReduceMotion, syncState])

    return (
        <ThemeContext.Provider value={themeValue}>
            <AppearanceContext.Provider value={appearanceValue}>
                <MotionConfig reducedMotion={effectiveReduceMotion ? 'always' : 'never'}>
                    {children}
                </MotionConfig>
            </AppearanceContext.Provider>
        </ThemeContext.Provider>
    )
}

export function ThemeProvider({ children }: ThemeProviderProps) {
    return (
        <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
            <ThemeRuntimeProvider>{children}</ThemeRuntimeProvider>
        </NextThemesProvider>
    )
}

export function useTheme() {
    const context = useContext(ThemeContext)
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider')
    }
    return context
}

export function useAppearance() {
    const context = useContext(AppearanceContext)
    if (!context) {
        throw new Error('useAppearance must be used within a ThemeProvider')
    }
    return context
}

export function useReducedMotionPreference() {
    const { reduceMotion } = useAppearance()
    const [systemReduceMotion, setSystemReduceMotion] = useState(false)

    useEffect(() => {
        const media = window.matchMedia('(prefers-reduced-motion: reduce)')
        const update = () => setSystemReduceMotion(prefersReducedMotionFromSystem(window.matchMedia?.bind(window)))
        update()
        media.addEventListener('change', update)
        return () => media.removeEventListener('change', update)
    }, [])

    return reduceMotion || systemReduceMotion
}

export type { ThemeMode, ResolvedTheme, AccentColor, Density }
export { APPEARANCE_STORAGE_KEYS, DEFAULT_APPEARANCE_SNAPSHOT }
