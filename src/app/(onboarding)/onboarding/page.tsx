'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { queryKeys } from '@/lib/query-keys'

import { OnboardingLayout } from '@/components/onboarding/OnboardingLayout'
import { OnboardingSidebar } from '@/components/onboarding/OnboardingSidebar'
import { MobileProgressBar } from '@/components/onboarding/MobileProgressBar'
import { StepHeader } from '@/components/onboarding/StepHeader'
import { StepFooter } from '@/components/onboarding/StepFooter'
import { StepTransition } from '@/components/onboarding/StepTransition'
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
    completeOnboarding,
    getOnboardingDraft,
    repairOnboardingClaims,
    saveOnboardingDraft,
    trackOnboardingEvent,
} from '@/app/actions/onboarding'
import { createProfileImageUploadUrlAction, finalizeProfileImageUploadAction } from '@/app/actions/profile'
import { useAuth } from '@/lib/hooks/use-auth'
import { uploadToSupabaseSignedUrl } from '@/lib/upload/supabase-signed-upload-client'
import { validateUsername } from '@/lib/validations/username'
import {
    ONBOARDING_AVAILABILITY_VALUES,
    ONBOARDING_EXPERIENCE_LEVEL_VALUES,
    ONBOARDING_GENDER_VALUES,
    ONBOARDING_HOURS_PER_WEEK_VALUES,
    ONBOARDING_MESSAGE_PRIVACY_VALUES,
    ONBOARDING_SOCIAL_KEYS,
    ONBOARDING_TOTAL_STEPS,
    ONBOARDING_VISIBILITY_VALUES,
    type OnboardingAvailabilityStatus,
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
    Loader2,
} from 'lucide-react'

// Skill suggestions
const SKILL_SUGGESTIONS = [
    'React', 'Next.js', 'TypeScript', 'JavaScript', 'Python',
    'Node.js', 'GraphQL', 'PostgreSQL', 'MongoDB', 'AWS',
    'Docker', 'Kubernetes', 'Figma', 'UI/UX Design', 'Machine Learning',
    'Data Science', 'Mobile Development', 'iOS', 'Android', 'Flutter'
]

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
    availabilityStatus: OnboardingAvailabilityStatus
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
const ONBOARDING_DRAFT_KEY = 'onboarding:draft:v2'
const ONBOARDING_DRAFT_KEY_LEGACY = 'onboarding:draft:v1'
const ONBOARDING_SUBMIT_KEY = 'onboarding:submit-key:v1'
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
    availabilityStatus: 'available',
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

type LocalDraftSource = 'v2' | 'v1'

function parseStoredOnboardingDraft(raw: string): { step: number; data: Partial<OnboardingData>; updatedAt: number } | null {
    try {
        const parsed = JSON.parse(raw) as { step?: unknown; data?: unknown; updatedAt?: unknown }
        if (!parsed || typeof parsed !== 'object') return null

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
            data.openTo = sourceData.openTo.filter((item): item is string => typeof item === 'string')
        }
        if (ONBOARDING_AVAILABILITY_VALUES.includes(sourceData.availabilityStatus as OnboardingAvailabilityStatus)) {
            data.availabilityStatus = sourceData.availabilityStatus as OnboardingAvailabilityStatus
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

        const updatedAt =
            typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
                ? parsed.updatedAt
                : 0

        return { step, data, updatedAt }
    } catch {
        return null
    }
}

function readOnboardingDraft(): { step: number; data: Partial<OnboardingData>; updatedAt: number; source: LocalDraftSource } | null {
    if (typeof window === 'undefined') return null
    const v2Raw = window.localStorage.getItem(ONBOARDING_DRAFT_KEY)
    if (v2Raw) {
        const parsed = parseStoredOnboardingDraft(v2Raw)
        if (parsed) return { ...parsed, source: 'v2' }
    }
    // Legacy read fallback retained through 2026-06-30 rollout window.
    const v1Raw = window.localStorage.getItem(ONBOARDING_DRAFT_KEY_LEGACY)
    if (v1Raw) {
        const parsed = parseStoredOnboardingDraft(v1Raw)
        if (parsed) return { ...parsed, source: 'v1' }
    }
    return null
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
    const router = useRouter()
    const queryClient = useQueryClient()
    const { refreshProfile } = useAuth()
    const [step, setStep] = useState(1)
    const [transitionDirection, setTransitionDirection] = useState<'forward' | 'backward' | 'section'>('forward')
    const [usernameStatus, setUsernameStatus] = useState<UsernameAvailabilityStatus>('idle')
    const [step2Section, setStep2Section] = useState<OnboardingStep2SectionId>(ONBOARDING_STEP2_SECTIONS[0].id)
    const [isLoading, setIsLoading] = useState(false)
    const [isInitializing, setIsInitializing] = useState(true)
    const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
    const [isDetectingLocation, setIsDetectingLocation] = useState(false)
    const draftHydratedRef = useRef(false)
    const initialDraftSyncRef = useRef(false)
    const draftVersionRef = useRef<number>(0)
    const lastSyncedDraftRef = useRef<OnboardingData>(EMPTY_ONBOARDING_DATA)
    const lastSyncedStepRef = useRef<number>(1)
    const lastInteractionKindRef = useRef<InteractionKind>('input')
    const renderStartedAtRef = useRef<number>(Date.now())
    const lastInputMetricAtRef = useRef<number>(0)
    const lastRenderMetricAtRef = useRef<number>(0)
    const submitIdempotencyKeyRef = useRef<string>('')
    const submitInFlightRef = useRef(false)
    const onboardingStartedAtRef = useRef<number>(Date.now())
    const stepEnteredAtRef = useRef<number>(Date.now())
    const lastStepViewRef = useRef<number | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [customOpenTo, setCustomOpenTo] = useState('')
    const [customOpenToError, setCustomOpenToError] = useState<string | null>(null)
    const [draftSaveDelayMs, setDraftSaveDelayMs] = useState(900)

    const [data, setData] = useState<OnboardingData>(EMPTY_ONBOARDING_DATA)

    const telemetrySnapshot = useMemo(() => ({
        skillsCount: data.skills.length,
        interestsCount: data.interests.length,
        openToCount: data.openTo.length,
        socialLinksCount: Object.values(data.socialLinks).filter(Boolean).length,
        hasIdentityDetails: Boolean(data.genderIdentity || data.pronouns),
        hasProfessionalDetails: Boolean(data.headline || data.bio || data.location || data.website),
        availabilityStatus: data.availabilityStatus,
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
        lastInteractionKindRef.current = kind
        setDraftSaveDelayMs(kind === 'toggle' ? 350 : 900)
    }, [])

    // Pre-fill data from social login and ensure profile exists
    useEffect(() => {
        async function loadSocialData() {
            const localDraft = readOnboardingDraft()
            try {
                if (typeof window !== 'undefined' && !submitIdempotencyKeyRef.current) {
                    const storedSubmitKey = window.localStorage.getItem(ONBOARDING_SUBMIT_KEY) || ''
                    submitIdempotencyKeyRef.current = storedSubmitKey || generateIdempotencyKey()
                    window.localStorage.setItem(ONBOARDING_SUBMIT_KEY, submitIdempotencyKeyRef.current)
                }

                if (localDraft) {
                    setStep(localDraft.step)
                    setData(prev => mergeOnboardingData(prev, localDraft.data))
                    lastSyncedStepRef.current = localDraft.step
                }

                const supabase = createClient()
                let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null
                try {
                    const authResult = await supabase.auth.getUser()
                    user = authResult.data.user
                } catch (authError) {
                    console.warn('Unable to fetch auth user during onboarding bootstrap:', authError)
                }

                if (user) {
                    const remoteDraftResult = await getOnboardingDraft()
                    const remoteDraftUpdatedAt =
                        remoteDraftResult.success && remoteDraftResult.updatedAt
                            ? new Date(remoteDraftResult.updatedAt).getTime()
                            : 0
                    const localDraftUpdatedAt = localDraft?.updatedAt || 0
                    const remoteDraft =
                        remoteDraftResult.success && remoteDraftResult.draft
                            ? {
                                step: remoteDraftResult.step || 1,
                                data: remoteDraftResult.draft,
                            }
                            : null
                    const preferredDraft =
                        remoteDraft && remoteDraftUpdatedAt > localDraftUpdatedAt
                            ? remoteDraft
                            : localDraft

                    if (preferredDraft && preferredDraft !== localDraft) {
                        setStep(preferredDraft.step)
                        setData(prev => mergeOnboardingData(prev, preferredDraft.data))
                        lastSyncedStepRef.current = preferredDraft.step
                    }
                    if (localDraft?.source === 'v1' && typeof window !== 'undefined') {
                        window.localStorage.removeItem(ONBOARDING_DRAFT_KEY_LEGACY)
                        window.localStorage.setItem(
                            ONBOARDING_DRAFT_KEY,
                            JSON.stringify({
                                step: localDraft.step,
                                data: localDraft.data,
                                updatedAt: localDraft.updatedAt,
                            })
                        )
                    }
                    if (remoteDraftResult.success) {
                        draftVersionRef.current = remoteDraftResult.version || 0
                    }

                    const metadata = user.user_metadata || {}

                    // Pre-fill from social login data without overwriting draft input.
                    setData(prev => mergeOnboardingData(prev, {
                        fullName: prev.fullName || metadata.full_name || metadata.name || '',
                        avatarUrl: prev.avatarUrl || metadata.avatar_url || metadata.picture || '',
                    }))

                    // Ensure profile record exists in database
                    const { ensureUserProfile } = await import('@/app/actions/database')
                    await ensureUserProfile()
                }
                draftHydratedRef.current = true
                trackEvent({
                    eventType: 'draft_loaded',
                    step,
                    metadata: {
                        localDraftSource: localDraft?.source || 'none',
                        hadRemoteDraft: Boolean(user),
                    },
                })
            } catch (error) {
                console.warn('Onboarding bootstrap degraded; continuing with local state:', error)
            } finally {
                setIsInitializing(false)
            }
        }

        loadSocialData()
    }, [])

    useEffect(() => {
        if (isInitializing || typeof window === 'undefined') return
        try {
            const updatedAt = Date.now()
            window.localStorage.setItem(
                ONBOARDING_DRAFT_KEY,
                JSON.stringify({
                    step,
                    data,
                    updatedAt,
                })
            )
            window.localStorage.removeItem(ONBOARDING_DRAFT_KEY_LEGACY)
        } catch (storageError) {
            console.warn('Unable to persist onboarding draft:', storageError)
        }
    }, [step, data, isInitializing])

    useEffect(() => {
        if (isInitializing) return
        if (initialDraftSyncRef.current) return
        lastSyncedDraftRef.current = data
        lastSyncedStepRef.current = step
        initialDraftSyncRef.current = true
    }, [isInitializing, data, step])

    useEffect(() => {
        if (isInitializing) return
        if (!draftHydratedRef.current) return

        const timer = window.setTimeout(() => {
            void (async () => {
                try {
                    const patch = buildDraftPatch(lastSyncedDraftRef.current, data)
                    const stepChanged = lastSyncedStepRef.current !== step
                    if (Object.keys(patch).length === 0 && !stepChanged) return

                    const startedAt = performance.now()
                    const result = await saveOnboardingDraft({
                        step,
                        draft: patch,
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
                        setError('Your draft was updated in another tab. Latest version has been synced.')
                    }
                } catch (draftError) {
                    console.error('Unable to save onboarding draft:', draftError)
                    setError('Unable to save draft right now. Please try again.')
                }
            })()
        }, draftSaveDelayMs)

        return () => {
            window.clearTimeout(timer)
        }
    }, [step, data, isInitializing, draftSaveDelayMs, trackEvent])

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
        if (kind === 'input') {
            const startedAt = performance.now()
            if (startedAt - lastInputMetricAtRef.current > 1200) {
                lastInputMetricAtRef.current = startedAt
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
        }
        setData(prev => mergeOnboardingData(prev, updates))
    }, [markInteraction, step, trackEvent])

    // Handle avatar file selection - show preview immediately
    const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

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
            const previewUrl = URL.createObjectURL(file)
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
            } catch {
                // Silently ignore upload errors - preview is already showing
                console.log('Storage upload skipped, using preview')
            }
        } catch (error) {
            console.error('Avatar error:', error)
            setError('Failed to load image')
        } finally {
            setIsUploadingAvatar(false)
        }
    }

    const nextStep = () => {
        if (step === 2 && ONBOARDING_FEATURE_FLAGS.enableStep2Sections) {
            const currentIndex = ONBOARDING_STEP2_SECTIONS.findIndex((item) => item.id === step2Section)
            if (currentIndex >= 0 && currentIndex < ONBOARDING_STEP2_SECTIONS.length - 1) {
                renderStartedAtRef.current = performance.now()
                setTransitionDirection('section')
                setStep2Section(ONBOARDING_STEP2_SECTIONS[currentIndex + 1]!.id)
                return
            }
        }
        if (step < TOTAL_STEPS) {
            const durationMs = Date.now() - stepEnteredAtRef.current
            trackEvent({
                eventType: 'step_continue',
                step,
                metadata: {
                    ...telemetrySnapshot,
                    durationMs,
                    step2Section,
                },
            })
            trackEvent({
                eventType: 'time_to_continue',
                step,
                metadata: { durationMs },
            })
            renderStartedAtRef.current = performance.now()
            if (step === 1) {
                setStep2Section(ONBOARDING_STEP2_SECTIONS[0].id)
            }
            setTransitionDirection('forward')
            setStep(step + 1)
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

    const addCustomOpenTo = useCallback(() => {
        const normalized = customOpenTo.trim()
        if (!normalized) {
            setCustomOpenToError('Enter an option before adding')
            return
        }

        const lowered = normalized.toLowerCase()
        if (data.openTo.some((value) => value.toLowerCase() === lowered)) {
            setCustomOpenToError('This option already exists')
            return
        }

        if (data.openTo.length >= 12) {
            setCustomOpenToError('You can add up to 12 open-to options')
            return
        }

        setCustomOpenToError(null)
        markInteraction('toggle')
        setData((prev) => ({ ...prev, openTo: [...prev.openTo, normalized] }))
        setCustomOpenTo('')
    }, [customOpenTo, data.openTo, markInteraction])

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
                availabilityStatus: data.availabilityStatus,
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
                    data.openTo.length === 0 ? 'Set open-to preferences' : null,
                    Object.values(data.socialLinks).filter(Boolean).length === 0 ? 'Add at least 1 social link' : null,
                ].filter((item): item is string => Boolean(item))

                window.localStorage.setItem(
                    'onboarding:profile-strength:v1',
                    JSON.stringify({
                        createdAt: Date.now(),
                        items: checklistItems,
                    })
                )
                window.localStorage.removeItem(ONBOARDING_DRAFT_KEY)
                window.localStorage.removeItem(ONBOARDING_SUBMIT_KEY)
            }
            trackEvent({
                eventType: 'submit_success',
                step: TOTAL_STEPS,
                metadata: {
                    ...telemetrySnapshot,
                    needsMetadataSync: result.needsMetadataSync === true,
                    totalOnboardingMs: Date.now() - onboardingStartedAtRef.current,
                },
            })
            router.push('/hub')

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
        for (let i = 1; i < step; i++) {
            set.add(i)
        }
        return set
    }, [step])

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
            <OnboardingLayout currentStep={1} totalSteps={TOTAL_STEPS}>
                <div className="flex items-center justify-center min-h-[50vh]">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            </OnboardingLayout>
        )
    }

    return (
        <OnboardingLayout
            currentStep={step}
            totalSteps={TOTAL_STEPS}
            sidebar={
                <OnboardingSidebar
                    currentStep={step}
                    totalSteps={TOTAL_STEPS}
                    stepLabels={sidebarStepLabels}
                    completedSteps={completedSteps}
                />
            }
            mobileProgress={
                <MobileProgressBar
                    currentStep={step}
                    totalSteps={TOTAL_STEPS}
                    stepLabels={mobileStepLabels}
                />
            }
        >
            <StepTransition step={step} direction={transitionDirection}>
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
                            availabilityStatus={data.availabilityStatus}
                            onExperienceLevelChange={(value) => updateData({ experienceLevel: value }, 'toggle')}
                            onHoursPerWeekChange={(value) => updateData({ hoursPerWeek: value }, 'toggle')}
                            onToggleOpenTo={toggleOpenTo}
                            onAvailabilityChange={(value) => updateData({ availabilityStatus: value }, 'toggle')}
                            customOpenTo={customOpenTo}
                            customOpenToError={customOpenToError}
                            onCustomOpenToChange={(value) => {
                                setCustomOpenTo(value)
                                setCustomOpenToError(null)
                            }}
                            onAddCustomOpenTo={addCustomOpenTo}
                            enableCustomOpenTo={ONBOARDING_FEATURE_FLAGS.enableCustomOpenTo}
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
                            skillOptions={SKILL_SUGGESTIONS.map((s) => ({ value: s, label: s }))}
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
                                { label: 'Availability', value: data.availabilityStatus },
                                { label: 'Skills', value: `${data.skills.length} selected` },
                                { label: 'Open to', value: `${data.openTo.length} preferences` },
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
                isLoading={isLoading}
                onBack={prevStep}
                onNext={nextStep}
                onSubmit={handleSubmit}
            />
        </OnboardingLayout>
    )
}
