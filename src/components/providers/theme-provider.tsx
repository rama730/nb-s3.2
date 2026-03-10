'use client'

import { ThemeProvider as NextThemesProvider, useTheme as useNextTheme } from 'next-themes'
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
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
    choosePreferredSnapshot,
    createAppearanceSnapshot,
    isSnapshotNewer,
    normalizeThemeMode,
    parseAppearanceSnapshot,
    readLocalAppearanceSnapshot,
    resolveThemeMode,
    writeAppearanceSnapshot,
} from '@/lib/theme/appearance'
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
    const supabase = useMemo(() => createSupabaseBrowserClient(), [])
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

    const bootstrappedRef = useRef(false)
    const pendingSyncRef = useRef<AppearanceSnapshot | null>(null)
    const syncInFlightRef = useRef(false)
    const syncRetryIndexRef = useRef(0)
    const syncTimerRef = useRef<number | null>(null)

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

    const flushRemoteSync = useCallback(async (reason: string) => {
        if (!profileHardeningEnabled || !viewerId) return
        if (syncInFlightRef.current) return

        const snapshot = pendingSyncRef.current
        if (!snapshot) return

        syncInFlightRef.current = true
        pendingSyncRef.current = null
        const startedAt = performance.now()

        try {
            const { data: authData, error: authError } = await supabase.auth.getUser()
            if (authError || !authData.user) {
                throw new Error(authError?.message || 'Unable to resolve authenticated user')
            }

            const metadata =
                authData.user.user_metadata && typeof authData.user.user_metadata === 'object'
                    ? (authData.user.user_metadata as Record<string, unknown>)
                    : {}
            const remoteSnapshot = parseAppearanceSnapshot(metadata.app_appearance)
            if (remoteSnapshot && !isSnapshotNewer(snapshot, remoteSnapshot)) {
                logger.metric('theme.sync.skip_stale', { reason, userId: viewerId })
                syncRetryIndexRef.current = 0
                return
            }

            const { error: updateError } = await supabase.auth.updateUser({
                data: {
                    ...metadata,
                    app_appearance: snapshot,
                },
            })
            if (updateError) throw new Error(updateError.message)

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
                window.setTimeout(() => {
                    void flushRemoteSync('retry')
                }, retryDelay)
            } else {
                syncRetryIndexRef.current = 0
            }
        } finally {
            syncInFlightRef.current = false
            if (pendingSyncRef.current) {
                window.setTimeout(() => {
                    void flushRemoteSync('queued')
                }, 0)
            }
        }
    }, [profileHardeningEnabled, supabase, viewerId])

    const queueRemoteSync = useCallback((snapshot: AppearanceSnapshot, reason: string) => {
        if (!profileHardeningEnabled || !viewerId || !bootstrappedRef.current) return
        pendingSyncRef.current = snapshot

        if (syncTimerRef.current !== null) {
            window.clearTimeout(syncTimerRef.current)
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

    useEffect(() => {
        const root = document.documentElement
        root.style.colorScheme = resolvedTheme
        root.setAttribute('data-theme-mode', theme)
        root.setAttribute('data-accent', accentColor)
        root.setAttribute('data-density', density)
        if (reduceMotion) root.setAttribute('data-reduce-motion', 'true')
        else root.removeAttribute('data-reduce-motion')
        ensureThemeColorMeta(resolvedTheme === 'dark' ? '#0a0a0a' : '#ffffff')
    }, [accentColor, density, reduceMotion, resolvedTheme, theme])

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
        if ((root.getAttribute('data-reduce-motion') === 'true') !== localSnapshot.reduceMotion) mismatchReasons.push('reduce-motion')
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

        void supabase.auth.getUser().then((authResult: {
            data: { user: User | null };
            error: { message: string } | null;
        }) => {
            const { data, error } = authResult
            if (cancelled) return
            const user = data.user ?? null
            const nextUserId = user?.id ?? null

            setViewerId(nextUserId)
            const nextShellEnabled = isHardeningDomainEnabled('shellV1', nextUserId)
            const nextProfileEnabled = isHardeningDomainEnabled('profileV1', nextUserId)
            setShellHardeningEnabled(nextShellEnabled)
            setProfileHardeningEnabled(nextProfileEnabled)

            if (error) {
                logger.metric('theme.snapshot.fallback', {
                    source: 'remote',
                    reason: 'auth-error',
                    error: error.message,
                })
                return
            }

            if (!user || !nextProfileEnabled) {
                return
            }

            const metadata =
                user.user_metadata && typeof user.user_metadata === 'object'
                    ? (user.user_metadata as Record<string, unknown>)
                    : {}
            const remoteSnapshot = parseAppearanceSnapshot(metadata.app_appearance)
            if (!remoteSnapshot) {
                logger.metric('theme.snapshot.fallback', {
                    source: 'remote',
                    reason: 'missing-or-invalid',
                })
                pendingSyncRef.current = localSnapshot
                return
            }

            const preferredSnapshot = choosePreferredSnapshot(localSnapshot, remoteSnapshot)
            if (isSnapshotNewer(remoteSnapshot, localSnapshot)) {
                setAccentColorState(preferredSnapshot.accentColor)
                setDensityState(preferredSnapshot.density)
                setReduceMotionState(preferredSnapshot.reduceMotion)
                setNextTheme(preferredSnapshot.theme)
                persistLocalSnapshot(preferredSnapshot, 'bootstrap-remote-preferred')
                logger.metric('theme.snapshot.remote_preferred', { userId: nextUserId })
            } else {
                pendingSyncRef.current = localSnapshot
                logger.metric('theme.snapshot.local_preferred', { userId: nextUserId })
            }
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
        }
    }, [persistLocalSnapshot, setNextTheme, supabase])

    useEffect(() => {
        if (!bootstrappedRef.current || !profileHardeningEnabled || !viewerId) return
        if (!pendingSyncRef.current) return
        void flushRemoteSync('viewer-ready')
    }, [flushRemoteSync, profileHardeningEnabled, viewerId])

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
    }), [accentColor, density, reduceMotion, setAccentColor, setDensity, setReduceMotion])

    return (
        <ThemeContext.Provider value={themeValue}>
            <AppearanceContext.Provider value={appearanceValue}>
                {children}
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
