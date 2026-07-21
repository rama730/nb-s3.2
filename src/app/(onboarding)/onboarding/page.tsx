'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { queryKeys } from '@/lib/query-keys'
import { getRolePreferences } from '@/lib/profile/role-preferences'

import { OnboardingLayout } from '@/components/onboarding/OnboardingLayout'
import { OnboardingSidebar } from '@/components/onboarding/OnboardingSidebar'
import { MobileProgressBar } from '@/components/onboarding/MobileProgressBar'
import { StepHeader } from '@/components/onboarding/StepHeader'
import { StepFooter } from '@/components/onboarding/StepFooter'
import { StepTransition, prefersReducedMotion } from '@/components/onboarding/StepTransition'
import dynamic from 'next/dynamic'
import { Suspense } from 'react'

const Step1Identity = dynamic(() => import('@/components/onboarding/steps/Step1Identity').then(mod => mod.Step1Identity))
const Step2Details = dynamic(() => import('@/components/onboarding/steps/Step2Details'))
const Step3Skills = dynamic(() => import('@/components/onboarding/steps/Step3Skills'))
const Step4Privacy = dynamic(() => import('@/components/onboarding/steps/Step4Privacy').then(mod => mod.Step4Privacy))
import { STEP_UI_CONFIG } from '@/lib/onboarding/step-ui-config'
import type { UsernameAvailabilityStatus } from '@/hooks/useUsernameAvailability'
import {
    clearOnboardingDraft,
    commitOnboardingStep,
    completeOnboarding,
    repairOnboardingClaims,
    saveOnboardingDraft,
    trackOnboardingEvent,
} from '@/app/actions/onboarding'
import { createProfileImageUploadUrlAction, finalizeProfileImageUploadAction } from '@/app/actions/profile'
import { useAuth } from '@/lib/hooks/use-auth'
import { useOnboardingBootstrap } from '@/components/onboarding/OnboardingBootstrapProvider'
import { uploadToSupabaseSignedUrl } from '@/lib/upload/supabase-signed-upload-client'
import { validateUsername } from '@/lib/validations/username'
import {
    ONBOARDING_EXPERIENCE_LEVEL_VALUES,
    ONBOARDING_GENDER_VALUES,
    ONBOARDING_HOURS_PER_WEEK_VALUES,
    ONBOARDING_MESSAGE_PRIVACY_VALUES,
    ONBOARDING_SOCIAL_KEYS,
    ONBOARDING_TOTAL_STEPS,
    ONBOARDING_VISIBILITY_VALUES,
    type OnboardingExperienceLevel,
    type OnboardingGenderIdentity,
    type OnboardingHoursPerWeek,
    type OnboardingMessagePrivacy,
    type OnboardingSocialLinkKey,
    type OnboardingVisibility,
} from '@/lib/onboarding/contracts'
import {
    ONBOARDING_FEATURE_FLAGS,
    ONBOARDING_REQUIRED_FIELDS,
    ONBOARDING_STEP2_SECTIONS,
    type OnboardingStep2SectionId,
} from '@/lib/onboarding/config'
import { type OnboardingEventInput } from '@/lib/onboarding/events'
import { compressAvatarOffMainThread } from '@/lib/services/avatar-worker-client'
import {
    ONBOARDING_LOCAL_DRAFT_TTL_MS,
    ONBOARDING_SCHEMA_VERSION,
    clampCompletedThrough,
    clampOnboardingStep,
    normalizeOnboardingSection,
    onboardingStorageKeys,
} from '@/lib/onboarding/state'
import { normalizeAuthNextPath } from '@/lib/auth/redirects'
import {
    Loader2,
} from 'lucide-react'

// Interest suggestions
const INTEREST_SUGGESTIONS = [
    'Open Source', 'Startups', 'AI/ML', 'Web3', 'Gaming',
    'Education', 'Healthcare', 'Fintech', 'E-commerce', 'SaaS',
    'Climate Tech', 'Social Impact', 'Creative Tools', 'Developer Tools', 'DevOps'
]



type OnboardingSocialLinksState = Record<OnboardingSocialLinkKey, string>

type OnboardingDataUpdates = Partial<Omit<OnboardingData, 'socialLinks'>> & {
    socialLinks?: Partial<OnboardingSocialLinksState>
}

interface OnboardingData {
    username: string
    fullName: string
    avatarUrl: string
    headline: string
    bio: string
    location: string
    website: string
    skills: string[]
    interests: string[]
    openTo: string[]
    messagePrivacy: OnboardingMessagePrivacy
    socialLinks: OnboardingSocialLinksState
    experienceLevel: OnboardingExperienceLevel | ''
    hoursPerWeek: OnboardingHoursPerWeek | ''
    genderIdentity: OnboardingGenderIdentity | ''
    pronouns: string
    visibility: OnboardingVisibility
}

type InteractionKind = 'input' | 'toggle'

const TOTAL_STEPS = ONBOARDING_TOTAL_STEPS
const ONBOARDING_DRAFT_KEY_LEGACY = 'onboarding:draft:v1'
const ONBOARDING_DRAFT_KEY_LEGACY_V2 = 'onboarding:draft:v2'
const ONBOARDING_SUBMIT_KEY_LEGACY = 'onboarding:submit-key:v1'
const EMPTY_ONBOARDING_DATA: OnboardingData = {
    username: '',
    fullName: '',
    avatarUrl: '',
    headline: '',
    bio: '',
    location: '',
    website: '',
    skills: [],
    interests: [],
    openTo: [],
    messagePrivacy: 'connections',
    socialLinks: ONBOARDING_SOCIAL_KEYS.reduce((acc, key) => {
        acc[key] = ''
        return acc
    }, {} as OnboardingSocialLinksState),
    experienceLevel: '',
    hoursPerWeek: '',
    genderIdentity: '',
    pronouns: '',
    visibility: 'public',
}

type ScopedLocalDraft = {
    userId: string
    step: number
    completedThrough: number
    activeSection: OnboardingStep2SectionId
    baseVersion: number
    schemaVersion: number
    data: Partial<OnboardingData>
    expiresAt: number
}

function parseStoredOnboardingDraft(raw: string, expectedUserId: string): ScopedLocalDraft | null {
    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        if (!parsed || typeof parsed !== 'object') return null
        if (parsed.userId !== expectedUserId) return null
        if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= Date.now()) return null

        const step =
            typeof parsed.step === 'number' && Number.isFinite(parsed.step)
                ? Math.min(TOTAL_STEPS, Math.max(1, Math.floor(parsed.step)))
                : 1

        const sourceData =
            parsed.data && typeof parsed.data === 'object'
                ? (parsed.data as Record<string, unknown>)
                : {}
        const data: Partial<OnboardingData> = {}

        if (typeof sourceData.username === 'string') data.username = sourceData.username
        if (typeof sourceData.fullName === 'string') data.fullName = sourceData.fullName
        if (typeof sourceData.avatarUrl === 'string') data.avatarUrl = sourceData.avatarUrl
        if (typeof sourceData.headline === 'string') data.headline = sourceData.headline
        if (typeof sourceData.bio === 'string') data.bio = sourceData.bio
        if (typeof sourceData.location === 'string') data.location = sourceData.location
        if (typeof sourceData.website === 'string') data.website = sourceData.website
        if (Array.isArray(sourceData.skills)) {
            data.skills = sourceData.skills.filter((skill): skill is string => typeof skill === 'string')
        }
        if (Array.isArray(sourceData.interests)) {
            data.interests = sourceData.interests.filter((interest): interest is string => typeof interest === 'string')
        }
        if (Array.isArray(sourceData.openTo)) {
            data.openTo = getRolePreferences(sourceData.openTo)
        }
        if (ONBOARDING_MESSAGE_PRIVACY_VALUES.includes(sourceData.messagePrivacy as OnboardingMessagePrivacy)) {
            data.messagePrivacy = sourceData.messagePrivacy as OnboardingMessagePrivacy
        }
        if (ONBOARDING_EXPERIENCE_LEVEL_VALUES.includes(sourceData.experienceLevel as OnboardingExperienceLevel)) {
            data.experienceLevel = sourceData.experienceLevel as OnboardingExperienceLevel
        }
        if (ONBOARDING_HOURS_PER_WEEK_VALUES.includes(sourceData.hoursPerWeek as OnboardingHoursPerWeek)) {
            data.hoursPerWeek = sourceData.hoursPerWeek as OnboardingHoursPerWeek
        }
        if (ONBOARDING_GENDER_VALUES.includes(sourceData.genderIdentity as OnboardingGenderIdentity)) {
            data.genderIdentity = sourceData.genderIdentity as OnboardingGenderIdentity
        }
        if (typeof sourceData.pronouns === 'string') data.pronouns = sourceData.pronouns
        if (sourceData.socialLinks && typeof sourceData.socialLinks === 'object') {
            const links = sourceData.socialLinks as Record<string, unknown>
            data.socialLinks = ONBOARDING_SOCIAL_KEYS.reduce((acc, key) => {
                acc[key] = typeof links[key] === 'string' ? (links[key] as string) : ''
                return acc
            }, {} as OnboardingSocialLinksState)
        }
        if (ONBOARDING_VISIBILITY_VALUES.includes(sourceData.visibility as OnboardingVisibility)) {
            data.visibility = sourceData.visibility as OnboardingVisibility
        }

        return {
            userId: expectedUserId,
            step,
            completedThrough: clampCompletedThrough(parsed.completedThrough),
            activeSection: normalizeOnboardingSection(parsed.activeSection),
            baseVersion: typeof parsed.baseVersion === 'number' ? Math.max(0, Math.floor(parsed.baseVersion)) : 0,
            schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : ONBOARDING_SCHEMA_VERSION,
            data,
            expiresAt: parsed.expiresAt,
        }
    } catch {
        return null
    }
}

function readOnboardingDraft(userId: string, draftKey: string): ScopedLocalDraft | null {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(draftKey)
    if (!raw) return null
    const parsed = parseStoredOnboardingDraft(raw, userId)
    if (!parsed) window.localStorage.removeItem(draftKey)
    return parsed
}

function getOnboardingReturnPath() {
    if (typeof window === 'undefined') return '/hub'
    const requested = new URLSearchParams(window.location.search).get('next')
    const normalized = normalizeAuthNextPath(requested)
    return normalized === '/onboarding' || normalized.startsWith('/onboarding?') ? '/hub' : normalized
}

function mergeOnboardingData(current: OnboardingData, updates: OnboardingDataUpdates): OnboardingData {
    const { socialLinks: socialLinkUpdates, ...restUpdates } = updates
    const definedUpdates = Object.fromEntries(
        Object.entries(restUpdates).filter(([, value]) => value !== undefined)
    ) as Partial<Omit<OnboardingData, 'socialLinks'>>

    const nextSocialLinks = { ...current.socialLinks }
    if (socialLinkUpdates) {
        for (const key of ONBOARDING_SOCIAL_KEYS) {
            const value = socialLinkUpdates[key]
            if (value !== undefined) {
                nextSocialLinks[key] = value
            }
        }
    }

    return {
        ...current,
        ...definedUpdates,
        socialLinks: nextSocialLinks,
    }
}

function normalizeDraftForSave(data: OnboardingData) {
    const normalizeList = (values: string[]) =>
        values.map((value) => value.trim()).filter(Boolean)

    const normalizeSocial = (links: OnboardingData['socialLinks']) =>
        ONBOARDING_SOCIAL_KEYS.reduce((acc, key) => {
            const value = (links[key] || '').trim()
            acc[key] = value
            return acc
        }, {} as OnboardingData['socialLinks'])

    return {
        ...data,
        username: data.username.trim(),
        fullName: data.fullName.trim(),
        headline: data.headline.trim(),
        bio: data.bio.trim(),
        location: data.location.trim(),
        website: data.website.trim(),
        pronouns: data.pronouns.trim() || undefined,
        skills: normalizeList(data.skills),
        interests: normalizeList(data.interests),
        openTo: normalizeList(data.openTo),
        socialLinks: normalizeSocial(data.socialLinks),
        experienceLevel: data.experienceLevel || undefined,
        hoursPerWeek: data.hoursPerWeek || undefined,
        genderIdentity: data.genderIdentity || undefined,
    }
}

function buildDraftPatch(previous: OnboardingData, next: OnboardingData) {
    const prev = normalizeDraftForSave(previous) as Record<string, unknown>
    const current = normalizeDraftForSave(next) as Record<string, unknown>
    const patch: Record<string, unknown> = {}

    for (const key of Object.keys(current)) {
        const prevValue = prev[key]
        const nextValue = current[key]
        if (JSON.stringify(prevValue) === JSON.stringify(nextValue)) continue
        patch[key] = nextValue
    }

    return patch
}

function generateIdempotencyKey() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `onboarding:${crypto.randomUUID()}`
    }
    return `onboarding:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
}

export default function OnboardingPage() {
    const queryClient = useQueryClient()
    const bootstrap = useOnboardingBootstrap()
    const { user, profile, refreshProfile } = useAuth()
    const storageKeys = useMemo(() => onboardingStorageKeys(bootstrap.userId), [bootstrap.userId])
    const initialData = useMemo(() => {
        const hydrated = mergeOnboardingData(
            EMPTY_ONBOARDING_DATA,
            bootstrap.draft.data as OnboardingDataUpdates,
        )
        const metadata = user?.user_metadata || {}
        return mergeOnboardingData(hydrated, {
            fullName: hydrated.fullName || profile?.fullName || metadata.full_name || metadata.name || '',
            avatarUrl: hydrated.avatarUrl || profile?.avatarUrl || metadata.avatar_url || metadata.picture || '',
        })
    }, [bootstrap.draft.data, profile?.avatarUrl, profile?.fullName, user?.user_metadata])

    const [step, setStep] = useState(() => clampOnboardingStep(bootstrap.draft.step))
    const [completedThrough, setCompletedThrough] = useState(() => clampCompletedThrough(bootstrap.draft.completedThrough))
    const [justCompletedStep, setJustCompletedStep] = useState<number | null>(null)
    const [transitionDirection, setTransitionDirection] = useState<'forward' | 'backward' | 'section'>('forward')
    const [usernameStatus, setUsernameStatus] = useState<UsernameAvailabilityStatus>('idle')
    const [step2Section, setStep2Section] = useState<OnboardingStep2SectionId>(() => normalizeOnboardingSection(bootstrap.draft.activeSection))
    const [isLoading, setIsLoading] = useState(false)
    const [isCommittingStep, setIsCommittingStep] = useState(false)
    const [isInitializing, setIsInitializing] = useState(false)
    const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
    const [isDetectingLocation, setIsDetectingLocation] = useState(false)
    const draftHydratedRef = useRef(false)
    const bootstrapHydratedRef = useRef(false)
    const draftVersionRef = useRef<number>(bootstrap.draft.version)
    const draftSaveInFlightRef = useRef<Promise<void> | null>(null)
    const avatarPreviewUrlRef = useRef<string | null>(null)
    const lastSyncedDraftRef = useRef<OnboardingData>(initialData)
    const lastSyncedStepRef = useRef<number>(bootstrap.draft.step)
    const lastSyncedSectionRef = useRef<OnboardingStep2SectionId>(bootstrap.draft.activeSection)
    const renderStartedAtRef = useRef<number>(Date.now())
    const measuredInputStepsRef = useRef<Set<number>>(new Set())
    const lastRenderMetricAtRef = useRef<number>(0)
    const submitIdempotencyKeyRef = useRef<string>('')
    const submitInFlightRef = useRef(false)
    const onboardingStartedAtRef = useRef<number>(Date.now())
    const stepEnteredAtRef = useRef<number>(Date.now())
    const lastStepViewRef = useRef<number | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [draftSaveDelayMs, setDraftSaveDelayMs] = useState(900)

    const [data, setData] = useState<OnboardingData>(initialData)

    const telemetrySnapshot = useMemo(() => ({
        skillsCount: data.skills.length,
        interestsCount: data.interests.length,
        openToCount: data.openTo.length,
        socialLinksCount: Object.values(data.socialLinks).filter(Boolean).length,
        hasIdentityDetails: Boolean(data.genderIdentity || data.pronouns),
        hasProfessionalDetails: Boolean(data.headline || data.bio || data.location || data.website),
        messagePrivacy: data.messagePrivacy,
        visibility: data.visibility,
    }), [data])
    const telemetrySnapshotRef = useRef(telemetrySnapshot)
    useEffect(() => {
        telemetrySnapshotRef.current = telemetrySnapshot
    }, [telemetrySnapshot])

    const trackEvent = useCallback((payload: OnboardingEventInput) => {
        void trackOnboardingEvent(payload)
    }, [])

    const markInteraction = useCallback((kind: InteractionKind) => {
        setDraftSaveDelayMs(kind === 'toggle' ? 350 : 900)
    }, [])

    // Reconcile the server bootstrap with the same-user crash buffer.
    useEffect(() => {
        if (bootstrapHydratedRef.current) return
        bootstrapHydratedRef.current = true
        async function hydrateDraft() {
            const localDraft = readOnboardingDraft(bootstrap.userId, storageKeys.draft)
            try {
                if (typeof window !== 'undefined' && !submitIdempotencyKeyRef.current) {
                    const storedSubmitKey = window.localStorage.getItem(storageKeys.submit) || ''
                    submitIdempotencyKeyRef.current = storedSubmitKey || generateIdempotencyKey()
                    window.localStorage.setItem(storageKeys.submit, submitIdempotencyKeyRef.current)
                    window.localStorage.removeItem(ONBOARDING_DRAFT_KEY_LEGACY)
                    window.localStorage.removeItem(ONBOARDING_DRAFT_KEY_LEGACY_V2)
                    window.localStorage.removeItem(ONBOARDING_SUBMIT_KEY_LEGACY)
                }

                if (localDraft && localDraft.baseVersion >= bootstrap.draft.version) {
                    setStep(localDraft.step)
                    setCompletedThrough(localDraft.completedThrough)
                    setStep2Section(localDraft.activeSection)
                    setData(prev => mergeOnboardingData(prev, localDraft.data))
                }

                if (user) {
                    const { ensureUserProfile } = await import('@/app/actions/database')
                    await ensureUserProfile()
                }
                draftHydratedRef.current = true
                const resumedStep = localDraft && localDraft.baseVersion >= bootstrap.draft.version
                    ? localDraft.step
                    : bootstrap.draft.step
                trackEvent({
                    eventType: 'draft_loaded',
                    step: resumedStep,
                    metadata: {
                        localDraftSource: localDraft ? 'scoped_v3' : 'none',
                        hadRemoteDraft: bootstrap.draft.version > 0,
                        serverVersion: bootstrap.draft.version,
                    },
                })
            } catch (error) {
                console.warn('Onboarding bootstrap degraded; continuing with server state:', error)
            } finally {
                setIsInitializing(false)
            }
        }

        void hydrateDraft()
    }, [bootstrap.draft.step, bootstrap.draft.version, bootstrap.userId, storageKeys.draft, storageKeys.submit, trackEvent, user])

    useEffect(() => {
        if (isInitializing || typeof window === 'undefined') return
        try {
            const localData = data.avatarUrl.startsWith('blob:')
                ? { ...data, avatarUrl: lastSyncedDraftRef.current.avatarUrl }
                : data
            window.localStorage.setItem(
                storageKeys.draft,
                JSON.stringify({
                    userId: bootstrap.userId,
                    step,
                    completedThrough,
                    activeSection: step2Section,
                    baseVersion: draftVersionRef.current,
                    schemaVersion: ONBOARDING_SCHEMA_VERSION,
                    data: localData,
                    expiresAt: Date.now() + ONBOARDING_LOCAL_DRAFT_TTL_MS,
                })
            )
            window.localStorage.removeItem(ONBOARDING_DRAFT_KEY_LEGACY)
            window.localStorage.removeItem(ONBOARDING_DRAFT_KEY_LEGACY_V2)
        } catch (storageError) {
            console.warn('Unable to persist onboarding draft:', storageError)
        }
    }, [bootstrap.userId, completedThrough, data, isInitializing, step, step2Section, storageKeys.draft])

    useEffect(() => {
        if (isInitializing) return
        if (!draftHydratedRef.current) return

        const timer = window.setTimeout(() => {
            const operation = (async () => {
                try {
                    const patch = buildDraftPatch(lastSyncedDraftRef.current, data)
                    const stepChanged = lastSyncedStepRef.current !== step
                    const sectionChanged = lastSyncedSectionRef.current !== step2Section
                    if (Object.keys(patch).length === 0 && !stepChanged && !sectionChanged) return

                    const startedAt = performance.now()
                    const result = await saveOnboardingDraft({
                        step,
                        draft: patch,
                        activeSection: step2Section,
                        expectedVersion: draftVersionRef.current,
                    })
                    trackEvent({
                        eventType: 'save_draft_latency',
                        step,
                        metadata: {
                            durationMs: Math.round(performance.now() - startedAt),
                            patchKeys: Object.keys(patch).length,
                        },
                    })
                    if (result.success) {
                        draftVersionRef.current = result.version ?? draftVersionRef.current
                        lastSyncedDraftRef.current = data
                        lastSyncedStepRef.current = step
                        lastSyncedSectionRef.current = step2Section
                        setCompletedThrough(result.completedThrough ?? completedThrough)
                        return
                    }

                    if (result.errorDetails?.code === 'DRAFT_CONFLICT') {
                        draftVersionRef.current = result.version ?? draftVersionRef.current
                        const latestDraft = result.draft
                        if (latestDraft) {
                            setData(prev => mergeOnboardingData(prev, latestDraft))
                            lastSyncedDraftRef.current = mergeOnboardingData(lastSyncedDraftRef.current, latestDraft)
                        }
                        if (typeof result.step === 'number') {
                            setStep(result.step)
                            lastSyncedStepRef.current = result.step
                        }
                        if (typeof result.completedThrough === 'number') {
                            setCompletedThrough(result.completedThrough)
                        }
                        if (result.activeSection) {
                            setStep2Section(result.activeSection)
                            lastSyncedSectionRef.current = result.activeSection
                        }
                        setError('Your draft was updated in another tab. Latest version has been synced.')
                    }
                } catch (draftError) {
                    console.error('Unable to save onboarding draft:', draftError)
                    setError('Unable to save draft right now. Please try again.')
                }
            })()
            draftSaveInFlightRef.current = operation
            void operation.finally(() => {
                if (draftSaveInFlightRef.current === operation) {
                    draftSaveInFlightRef.current = null
                }
            })
        }, draftSaveDelayMs)

        return () => {
            window.clearTimeout(timer)
        }
    }, [completedThrough, data, draftSaveDelayMs, isInitializing, step, step2Section, trackEvent])

    useEffect(() => {
        if (typeof window === 'undefined') return
        const preload = () => {
            void import('@/lib/services/location-service')
            void import('@/app/actions/onboarding')
        }

        const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void }
        if (typeof w.requestIdleCallback === 'function') {
            const id = w.requestIdleCallback(preload)
            return () => {
                if (typeof w.cancelIdleCallback === 'function') {
                    w.cancelIdleCallback(id)
                }
            }
        }

        const timeout = window.setTimeout(preload, 250)
        return () => window.clearTimeout(timeout)
    }, [])

    useEffect(() => {
        if (isInitializing) return
        if (lastStepViewRef.current === step) return

        stepEnteredAtRef.current = Date.now()
        lastStepViewRef.current = step
        const stableTelemetrySnapshot = telemetrySnapshotRef.current
        trackEvent({
            eventType: 'step_view',
            step,
            metadata: {
                ...stableTelemetrySnapshot,
                step2Section,
            },
        })
    }, [step, isInitializing, step2Section, trackEvent])

    useEffect(() => {
        if (isInitializing) return
        const raf = window.requestAnimationFrame(() => {
            const now = performance.now()
            if (now - lastRenderMetricAtRef.current < 500) return
            lastRenderMetricAtRef.current = now
            trackEvent({
                eventType: 'step_render_time',
                step,
                metadata: {
                    durationMs: Math.round(now - renderStartedAtRef.current),
                    step2Section,
                },
            })
        })
        return () => window.cancelAnimationFrame(raf)
    }, [step, step2Section, isInitializing, trackEvent])

    const updateData = useCallback((updates: Partial<OnboardingData>, kind: InteractionKind = 'input') => {
        markInteraction(kind)
        if (kind === 'input' && !measuredInputStepsRef.current.has(step)) {
            measuredInputStepsRef.current.add(step)
            const startedAt = performance.now()
            window.requestAnimationFrame(() => {
                trackEvent({
                    eventType: 'input_latency',
                    step,
                    metadata: {
                        durationMs: Math.round(performance.now() - startedAt),
                    },
                })
            })
        }
        setData(prev => mergeOnboardingData(prev, updates))
    }, [markInteraction, step, trackEvent])

    // Handle avatar file selection - show preview immediately
    const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const previousAvatarUrl = data.avatarUrl

        if (!file.type.startsWith('image/')) {
            setError('Please select an image file')
            return
        }

        if (file.size > 10 * 1024 * 1024) {
            setError('Image must be less than 10MB')
            return
        }

        setIsUploadingAvatar(true)
        setError(null)

        try {
            // Show immediate preview using object URL
            if (avatarPreviewUrlRef.current) URL.revokeObjectURL(avatarPreviewUrlRef.current)
            const previewUrl = URL.createObjectURL(file)
            avatarPreviewUrlRef.current = previewUrl
            updateData({ avatarUrl: previewUrl })

            // Try to upload compressed version to storage (background, non-blocking)
            try {
                const compressedBlob = await compressAvatarOffMainThread(file)
                const uploadSession = await createProfileImageUploadUrlAction({
                    mimeType: 'image/jpeg',
                    sizeBytes: compressedBlob.size,
                    kind: 'avatar',
                })
                if (!uploadSession.success) {
                    throw new Error(uploadSession.error || 'Failed to prepare avatar upload')
                }

                await uploadToSupabaseSignedUrl(uploadSession, compressedBlob)

                const finalized = await finalizeProfileImageUploadAction({
                    uploadIntentId: uploadSession.uploadIntentId,
                })
                if (!finalized.success) {
                    throw new Error(finalized.error || 'Failed to finalize avatar upload')
                }

                updateData({ avatarUrl: `${finalized.publicUrl}?t=${Date.now()}` })
                URL.revokeObjectURL(previewUrl)
                avatarPreviewUrlRef.current = null
            } catch (uploadError) {
                URL.revokeObjectURL(previewUrl)
                avatarPreviewUrlRef.current = null
                updateData({ avatarUrl: previousAvatarUrl })
                throw uploadError
            }
        } catch (error) {
            console.error('Avatar error:', error)
            setError('We could not upload that photo. Your previous photo is unchanged.')
        } finally {
            setIsUploadingAvatar(false)
        }
    }

    useEffect(() => {
        return () => {
            if (avatarPreviewUrlRef.current) URL.revokeObjectURL(avatarPreviewUrlRef.current)
        }
    }, [])

    const nextStep = async () => {
        if (step === 2 && ONBOARDING_FEATURE_FLAGS.enableStep2Sections) {
            const currentIndex = ONBOARDING_STEP2_SECTIONS.findIndex((item) => item.id === step2Section)
            if (currentIndex >= 0 && currentIndex < ONBOARDING_STEP2_SECTIONS.length - 1) {
                renderStartedAtRef.current = performance.now()
                setTransitionDirection('section')
                setStep2Section(ONBOARDING_STEP2_SECTIONS[currentIndex + 1]!.id)
                return
            }
        }
        if (step >= TOTAL_STEPS || isCommittingStep) return

        setIsCommittingStep(true)
        setError(null)
        const committingStep = step
        const durationMs = Date.now() - stepEnteredAtRef.current
        try {
            if (draftSaveInFlightRef.current) {
                await draftSaveInFlightRef.current
            }
            const result = await commitOnboardingStep({
                step: committingStep,
                draft: normalizeDraftForSave(data),
                activeSection: step2Section,
                expectedVersion: draftVersionRef.current,
            })

            if (!result.success) {
                if (result.errorDetails?.code === 'DRAFT_CONFLICT') {
                    draftVersionRef.current = result.version ?? draftVersionRef.current
                    if (result.draft) {
                        setData(prev => mergeOnboardingData(prev, result.draft!))
                        lastSyncedDraftRef.current = mergeOnboardingData(lastSyncedDraftRef.current, result.draft)
                    }
                    if (typeof result.step === 'number') {
                        setStep(result.step)
                        lastSyncedStepRef.current = result.step
                    }
                    if (typeof result.committedThrough === 'number') {
                        setCompletedThrough(result.committedThrough)
                    }
                    if (result.activeSection) {
                        setStep2Section(result.activeSection)
                        lastSyncedSectionRef.current = result.activeSection
                    }
                    trackEvent({
                        eventType: 'draft_conflict',
                        step: committingStep,
                        metadata: { serverVersion: result.version ?? -1 },
                    })
                }
                trackEvent({
                    eventType: 'step_commit_error',
                    step: committingStep,
                    metadata: { reason: result.errorDetails?.code || 'unknown' },
                })
                setError(result.errorDetails?.message || result.error || 'Unable to save this step.')
                return
            }

            draftVersionRef.current = result.version ?? draftVersionRef.current
            lastSyncedDraftRef.current = data
            lastSyncedStepRef.current = result.step ?? committingStep + 1
            lastSyncedSectionRef.current = result.activeSection ?? step2Section
            setCompletedThrough(result.committedThrough ?? committingStep)
            setJustCompletedStep(committingStep)
            trackEvent({
                eventType: 'step_commit_success',
                step: committingStep,
                metadata: { version: result.version ?? draftVersionRef.current },
            })
            trackEvent({
                eventType: 'step_continue',
                step: committingStep,
                metadata: {
                    ...telemetrySnapshot,
                    durationMs,
                    step2Section,
                },
            })
            trackEvent({
                eventType: 'time_to_continue',
                step: committingStep,
                metadata: { durationMs },
            })

            if (!prefersReducedMotion()) {
                await new Promise((resolve) => window.setTimeout(resolve, 160))
            }
            renderStartedAtRef.current = performance.now()
            if (committingStep === 1) {
                setStep2Section(ONBOARDING_STEP2_SECTIONS[0].id)
            }
            setTransitionDirection('forward')
            setStep(result.step ?? committingStep + 1)
        } catch (commitError) {
            console.error('Unable to commit onboarding step:', commitError)
            setError('Unable to save this step right now. Your entries remain available in this browser.')
        } finally {
            setJustCompletedStep(null)
            setIsCommittingStep(false)
        }
    }

    const prevStep = () => {
        if (step === 2 && ONBOARDING_FEATURE_FLAGS.enableStep2Sections) {
            const currentIndex = ONBOARDING_STEP2_SECTIONS.findIndex((item) => item.id === step2Section)
            if (currentIndex > 0) {
                renderStartedAtRef.current = performance.now()
                setTransitionDirection('section')
                setStep2Section(ONBOARDING_STEP2_SECTIONS[currentIndex - 1]!.id)
                return
            }
        }
        if (step > 1) {
            const durationMs = Date.now() - stepEnteredAtRef.current
            trackEvent({
                eventType: 'step_back',
                step,
                metadata: {
                    ...telemetrySnapshot,
                    durationMs,
                    step2Section,
                },
            })
            renderStartedAtRef.current = performance.now()
            if (step === 3) {
                setStep2Section(ONBOARDING_STEP2_SECTIONS[ONBOARDING_STEP2_SECTIONS.length - 1]!.id)
            }
            setTransitionDirection('backward')
            setStep(step - 1)
        }
    }

    const toggleSkill = useCallback((skill: string) => {
        markInteraction('toggle')
        setData(prev => ({
            ...prev,
            skills: prev.skills.includes(skill)
                ? prev.skills.filter(s => s !== skill)
                : [...prev.skills, skill]
        }))
    }, [markInteraction])

    const toggleInterest = useCallback((interest: string) => {
        markInteraction('toggle')
        setData(prev => ({
            ...prev,
            interests: prev.interests.includes(interest)
                ? prev.interests.filter(i => i !== interest)
                : [...prev.interests, interest]
        }))
    }, [markInteraction])

    const toggleOpenTo = useCallback((option: string) => {
        markInteraction('toggle')
        setData(prev => ({
            ...prev,
            openTo: prev.openTo.includes(option)
                ? prev.openTo.filter((item) => item !== option)
                : [...prev.openTo, option],
        }))
    }, [markInteraction])

    const updateSocialLink = useCallback((key: OnboardingSocialLinkKey, value: string) => {
        markInteraction('input')
        setData(prev => ({
            ...prev,
            socialLinks: {
                ...prev.socialLinks,
                [key]: value,
            },
        }))
    }, [markInteraction])

    const handleSubmit = async () => {
        if (submitInFlightRef.current) return
        submitInFlightRef.current = true
        setError(null)
        const idempotencyKey = submitIdempotencyKeyRef.current
        if (!idempotencyKey) {
            setError('Unable to submit yet. Please wait a moment and retry.')
            submitInFlightRef.current = false
            return
        }
        setIsLoading(true)
        const timeOnCurrentStepMs = Date.now() - stepEnteredAtRef.current
        const totalOnboardingMs = Date.now() - onboardingStartedAtRef.current
        trackEvent({
            eventType: 'submit_start',
            step: TOTAL_STEPS,
            metadata: {
                ...telemetrySnapshot,
                timeOnCurrentStepMs,
                totalOnboardingMs,
            },
        })
        trackEvent({
            eventType: 'time_to_submit',
            step: TOTAL_STEPS,
            metadata: {
                timeOnCurrentStepMs,
                totalOnboardingMs,
            },
        })

        try {
            const result = await completeOnboarding({
                username: data.username,
                fullName: data.fullName,
                avatarUrl: data.avatarUrl,
                headline: data.headline,
                bio: data.bio,
                location: data.location,
                website: data.website,
                skills: data.skills,
                interests: data.interests,
                openTo: data.openTo,
                messagePrivacy: data.messagePrivacy,
                socialLinks: data.socialLinks,
                experienceLevel: data.experienceLevel || undefined,
                hoursPerWeek: data.hoursPerWeek || undefined,
                genderIdentity: data.genderIdentity || undefined,
                pronouns: data.pronouns,
                visibility: data.visibility,
                idempotencyKey,
            })

            if (!result.success) {
                setError(result.errorDetails?.message || result.error || 'Failed to complete setup')
                trackEvent({
                    eventType: 'submit_error',
                    step: TOTAL_STEPS,
                    metadata: {
                        reason: result.errorDetails?.code || result.error || 'unknown',
                        ...telemetrySnapshot,
                    },
                })
                return
            }

            if (result.needsMetadataSync) {
                try {
                    await repairOnboardingClaims()
                } catch (repairError) {
                    console.error('Unable to repair onboarding claims:', repairError)
                }
            }

            const supabase = createClient()
            await Promise.allSettled([
                supabase.auth.refreshSession(),
                refreshProfile(),
                clearOnboardingDraft(),
            ])
            if (data.username) {
                queryClient.invalidateQueries({ queryKey: queryKeys.profile.byTarget(data.username) })
            }
            if (typeof window !== 'undefined') {
                const checklistItems = [
                    !data.headline ? 'Add a headline' : null,
                    !data.bio ? 'Add a short bio' : null,
                    data.skills.length < 3 ? 'Add at least 3 skills' : null,
                    data.openTo.length === 0 ? 'Set role preferences' : null,
                    Object.values(data.socialLinks).filter(Boolean).length === 0 ? 'Add at least 1 social link' : null,
                ].filter((item): item is string => Boolean(item))

                window.localStorage.setItem(
                    'onboarding:profile-strength:v1',
                    JSON.stringify({
                        createdAt: Date.now(),
                        items: checklistItems,
                    })
                )
                window.localStorage.removeItem(storageKeys.draft)
                window.localStorage.removeItem(storageKeys.submit)
            }
            setCompletedThrough(TOTAL_STEPS)
            setJustCompletedStep(TOTAL_STEPS)
            trackEvent({
                eventType: 'submit_success',
                step: TOTAL_STEPS,
                metadata: {
                    ...telemetrySnapshot,
                    needsMetadataSync: result.needsMetadataSync === true,
                    totalOnboardingMs: Date.now() - onboardingStartedAtRef.current,
                },
            })
            if (!prefersReducedMotion()) {
                await new Promise((resolve) => window.setTimeout(resolve, 160))
            }
            window.location.replace(getOnboardingReturnPath())

        } catch {
            setError('An unexpected error occurred')
            trackEvent({
                eventType: 'submit_error',
                step: TOTAL_STEPS,
                metadata: {
                    reason: 'unexpected',
                    ...telemetrySnapshot,
                },
            })
        } finally {
            setJustCompletedStep(null)
            submitInFlightRef.current = false
            setIsLoading(false)
        }
    }

    const canProceed = () => {
        const required = ONBOARDING_REQUIRED_FIELDS[step as 1 | 2 | 3 | 4] || []
        for (const field of required) {
            if (field === 'username') {
                if (!validateUsername(data.username).valid) return false
                if (usernameStatus !== 'valid') return false
            }
            if (field === 'fullName' && data.fullName.trim().length < 2) return false
            if (field === 'skills' && data.skills.length < 1) return false
        }
        return true
    }

    const selectedSkills = useMemo(() => new Set(data.skills), [data.skills])
    const selectedInterests = useMemo(() => new Set(data.interests), [data.interests])
    const filledSocialLinks = useMemo(
        () => Object.entries(data.socialLinks).filter(([, value]) => Boolean(value)),
        [data.socialLinks]
    )

    const completedSteps = useMemo(() => {
        const set = new Set<number>()
        for (let i = 1; i <= completedThrough; i++) {
            set.add(i)
        }
        return set
    }, [completedThrough])

    const sidebarStepLabels = useMemo(() =>
        STEP_UI_CONFIG.map((cfg) => ({ title: cfg.sidebarLabel, subtitle: cfg.subtitle })),
        []
    )

    const mobileStepLabels = useMemo(() =>
        STEP_UI_CONFIG.map((cfg) => cfg.sidebarLabel),
        []
    )

    const currentStepConfig = STEP_UI_CONFIG[step - 1]

    if (isInitializing) {
        return (
            <OnboardingLayout>
                <div className="flex items-center justify-center min-h-[50vh]">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            </OnboardingLayout>
        )
    }

    return (
        <OnboardingLayout
            sidebar={
                <OnboardingSidebar
                    currentStep={step}
                    totalSteps={TOTAL_STEPS}
                    stepLabels={sidebarStepLabels}
                    completedSteps={completedSteps}
                    justCompletedStep={justCompletedStep}
                />
            }
            mobileProgress={
                <MobileProgressBar
                    currentStep={step}
                    totalSteps={TOTAL_STEPS}
                    stepLabels={mobileStepLabels}
                    completedThrough={completedThrough}
                    justCompletedStep={justCompletedStep}
                />
            }
        >
            <StepTransition
                step={step}
                transitionKey={`${step}:${step === 2 ? step2Section : 'main'}`}
                direction={transitionDirection}
            >
                {/* Render StepHeader for steps 1 and 2 (steps 3 and 4 include their own) */}
                {(step === 1 || step === 2) && currentStepConfig && (
                    <StepHeader
                        title={currentStepConfig.title}
                        subtitle={currentStepConfig.subtitle}
                    />
                )}

                {/* Step 1: Identity */}
                {step === 1 && (
                    <Suspense fallback={<div className="h-96 w-full animate-pulse bg-zinc-50 dark:bg-zinc-900 rounded-xl" />}>
                        <Step1Identity
                            fullName={data.fullName}
                            username={data.username}
                            avatarUrl={data.avatarUrl}
                            isUploadingAvatar={isUploadingAvatar}
                            onFullNameChange={(value) => updateData({ fullName: value })}
                            onUsernameChange={(username) => updateData({ username })}
                            onAvatarChange={handleAvatarChange}
                            onUsernameStatusChange={setUsernameStatus}
                        />
                    </Suspense>
                )}


                {/* Step 2: Profile Details with SectionNav */}
                {step === 2 && (
                    <Suspense fallback={<div className="h-96 w-full animate-pulse bg-zinc-50 dark:bg-zinc-900 rounded-xl" />}>
                        <Step2Details
                            step2Section={step2Section}
                            onSectionChange={(sectionId) => {
                                const nextSection = ONBOARDING_STEP2_SECTIONS.find((item) => item.id === sectionId)
                                if (!nextSection) return
                                renderStartedAtRef.current = performance.now()
                                markInteraction('toggle')
                                setTransitionDirection('section')
                                setStep2Section(nextSection.id)
                            }}
                            genderIdentity={data.genderIdentity}
                            pronouns={data.pronouns}
                            onGenderChange={(value) => updateData({ genderIdentity: value }, 'toggle')}
                            onPronounsChange={(value) => updateData({ pronouns: value }, 'input')}
                            experienceLevel={data.experienceLevel}
                            hoursPerWeek={data.hoursPerWeek}
                            openTo={data.openTo}
                            onExperienceLevelChange={(value) => updateData({ experienceLevel: value }, 'toggle')}
                            onHoursPerWeekChange={(value) => updateData({ hoursPerWeek: value }, 'toggle')}
                            onToggleOpenTo={toggleOpenTo}
                            headline={data.headline}
                            bio={data.bio}
                            location={data.location}
                            website={data.website}
                            onHeadlineChange={(value) => updateData({ headline: value }, 'input')}
                            onBioChange={(value) => updateData({ bio: value }, 'input')}
                            onLocationChange={(value) => updateData({ location: value }, 'input')}
                            onWebsiteChange={(value) => updateData({ website: value }, 'input')}
                            isDetectingLocation={isDetectingLocation}
                            onDetectLocation={async () => {
                                setIsDetectingLocation(true)
                                setError(null)
                                try {
                                    const { detectLocation } = await import('@/lib/services/location-service')
                                    const { location, error: locError } = await detectLocation()
                                    if (location) {
                                        updateData({ location: location.formatted }, 'input')
                                    } else if (locError) {
                                        setError(locError)
                                    }
                                } catch {
                                    setError('Failed to detect location')
                                } finally {
                                    setIsDetectingLocation(false)
                                }
                            }}
                            socialLinks={data.socialLinks}
                            onSocialLinkChange={updateSocialLink}
                        />
                    </Suspense>
                )}

                {/* Step 3: Skills & Interests */}
                {step === 3 && (
                    <Suspense fallback={<div className="h-96 w-full animate-pulse bg-zinc-50 dark:bg-zinc-900 rounded-xl" />}>
                        <Step3Skills
                            interestOptions={INTEREST_SUGGESTIONS.map((i) => ({ value: i, label: i }))}
                            selectedSkills={selectedSkills}
                            selectedInterests={selectedInterests}
                            onToggleSkill={toggleSkill}
                            onToggleInterest={toggleInterest}
                        />
                    </Suspense>
                )}

                {/* Step 4: Privacy & Review */}
                {step === 4 && (
                    <Suspense fallback={<div className="h-96 w-full animate-pulse bg-zinc-50 dark:bg-zinc-900 rounded-xl" />}>
                        <Step4Privacy
                            visibility={data.visibility}
                            messagePrivacy={data.messagePrivacy}
                            onVisibilityChange={(value) => updateData({ visibility: value }, 'toggle')}
                            onMessagePrivacyChange={(value) => updateData({ messagePrivacy: value }, 'toggle')}
                            summaryItems={[
                                { label: '@' + data.username, value: data.fullName },
                                { label: 'Visibility', value: data.visibility },
                                { label: 'Messages', value: data.messagePrivacy },
                                { label: 'Skills', value: `${data.skills.length} selected` },
                                { label: 'Open to Roles', value: `${data.openTo.length} preferences` },
                                { label: 'Social links', value: `${filledSocialLinks.length} connected` },
                            ]}
                            error={error}
                        />
                    </Suspense>
                )}
            </StepTransition>

            {/* Step Footer Navigation */}
            <StepFooter
                step={step}
                totalSteps={TOTAL_STEPS}
                canProceed={canProceed()}
                isLoading={isLoading || isCommittingStep}
                loadingLabel={isLoading ? 'Completing...' : 'Saving...'}
                nextLabel={
                    step === 2
                        ? (() => {
                            const index = ONBOARDING_STEP2_SECTIONS.findIndex((section) => section.id === step2Section)
                            const nextSection = ONBOARDING_STEP2_SECTIONS[index + 1]
                            return nextSection ? `Next: ${nextSection.label}` : 'Continue to Skills'
                        })()
                        : 'Continue'
                }
                onBack={prevStep}
                onNext={nextStep}
                onSubmit={handleSubmit}
            />
        </OnboardingLayout>
    )
}
