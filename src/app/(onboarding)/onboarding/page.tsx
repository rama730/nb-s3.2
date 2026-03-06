'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import UsernameInput from '@/components/onboarding/UsernameInput'
import {
    clearOnboardingDraft,
    completeOnboarding,
    getOnboardingDraft,
    repairOnboardingClaims,
    saveOnboardingDraft,
    trackOnboardingEvent,
} from '@/app/actions/onboarding'
import { useAuth } from '@/lib/hooks/use-auth'
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
    ArrowLeft,
    ArrowRight,
    Check,
    Clock3,
    Loader2,
    Camera,
    MapPin,
    Globe,
    Briefcase,
    Shield,
    User,
    Users,
    Sparkles
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

const OPEN_TO_SUGGESTIONS = [
    'Full-time roles',
    'Part-time roles',
    'Freelance projects',
    'Open source collaboration',
    'Mentorship',
    'Hackathons',
    'Co-founder opportunities',
]

const EXPERIENCE_LEVEL_OPTIONS = [
    { value: 'student', label: 'Student' },
    { value: 'junior', label: 'Junior' },
    { value: 'mid', label: 'Mid-level' },
    { value: 'senior', label: 'Senior' },
    { value: 'lead', label: 'Lead' },
    { value: 'founder', label: 'Founder' },
] as const

const HOURS_PER_WEEK_OPTIONS = [
    { value: 'lt_5', label: '<5 hrs/week' },
    { value: 'h_5_10', label: '5-10 hrs/week' },
    { value: 'h_10_20', label: '10-20 hrs/week' },
    { value: 'h_20_40', label: '20-40 hrs/week' },
    { value: 'h_40_plus', label: '40+ hrs/week' },
] as const

const GENDER_OPTIONS = [
    { value: 'male', label: 'Male' },
    { value: 'female', label: 'Female' },
    { value: 'non_binary', label: 'Non-binary' },
    { value: 'other', label: 'Other' },
    { value: 'prefer_not_to_say', label: 'Prefer not to say' },
] as const

const AVAILABILITY_OPTIONS = [
    { value: 'available', label: 'Available', desc: 'Open for new opportunities' },
    { value: 'busy', label: 'Busy', desc: 'Limited availability right now' },
    { value: 'focusing', label: 'Focusing', desc: 'Heads-down on current work' },
    { value: 'offline', label: 'Offline', desc: 'Not actively looking' },
] as const

const MESSAGE_PRIVACY_OPTIONS = [
    { value: 'everyone', label: 'Everyone', desc: 'Allow messages from all users' },
    { value: 'connections', label: 'Connections only', desc: 'Allow messages only from connections' },
] as const

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
    return {
        ...current,
        ...updates,
        socialLinks: {
            ...current.socialLinks,
            ...(updates.socialLinks || {}),
        },
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
    const [step2Section, setStep2Section] = useState<OnboardingStep2SectionId>(ONBOARDING_STEP2_SECTIONS[0].id)
    const [isLoading, setIsLoading] = useState(false)
    const [isInitializing, setIsInitializing] = useState(true)
    const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
    const [isDetectingLocation, setIsDetectingLocation] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
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
    const onboardingStartedAtRef = useRef<number>(Date.now())
    const stepEnteredAtRef = useRef<number>(Date.now())
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
            try {
                const localDraft = readOnboardingDraft()
                if (typeof window !== 'undefined' && !submitIdempotencyKeyRef.current) {
                    const storedSubmitKey = window.localStorage.getItem(ONBOARDING_SUBMIT_KEY) || ''
                    submitIdempotencyKeyRef.current = storedSubmitKey || generateIdempotencyKey()
                    window.localStorage.setItem(ONBOARDING_SUBMIT_KEY, submitIdempotencyKeyRef.current)
                }

                const supabase = createClient()
                const { data: { user } } = await supabase.auth.getUser()

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

                    if (preferredDraft) {
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
                console.error('Error loading user data:', error)
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
        stepEnteredAtRef.current = Date.now()
        trackEvent({
            eventType: 'step_view',
            step,
            metadata: {
                ...telemetrySnapshot,
                step2Section,
            },
        })
    }, [step, isInitializing, telemetrySnapshot, step2Section, trackEvent])

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
            // Show immediate preview using FileReader
            const reader = new FileReader()
            reader.onload = (event) => {
                const previewUrl = event.target?.result as string
                updateData({ avatarUrl: previewUrl })
            }
            reader.readAsDataURL(file)

            // Try to upload compressed version to storage (background, non-blocking)
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()

            if (user) {
                try {
                    const compressedBlob = await compressAvatarOffMainThread(file)
                    const fileName = `${user.id}-${Date.now()}.jpg`

                    const { error: uploadError } = await supabase.storage
                        .from('avatars')
                        .upload(fileName, compressedBlob, {
                            contentType: 'image/jpeg',
                            upsert: true,
                        })

                    if (!uploadError) {
                        const { data: { publicUrl } } = supabase.storage
                            .from('avatars')
                            .getPublicUrl(fileName)
                        updateData({ avatarUrl: publicUrl })
                    }
                } catch {
                    // Silently ignore upload errors - preview is already showing
                    console.log('Storage upload skipped, using preview')
                }
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
                setStep2Section(ONBOARDING_STEP2_SECTIONS[currentIndex + 1].id)
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
            setStep(step + 1)
        }
    }

    const prevStep = () => {
        if (step === 2 && ONBOARDING_FEATURE_FLAGS.enableStep2Sections) {
            const currentIndex = ONBOARDING_STEP2_SECTIONS.findIndex((item) => item.id === step2Section)
            if (currentIndex > 0) {
                renderStartedAtRef.current = performance.now()
                setStep2Section(ONBOARDING_STEP2_SECTIONS[currentIndex - 1].id)
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
                setStep2Section(ONBOARDING_STEP2_SECTIONS[ONBOARDING_STEP2_SECTIONS.length - 1].id)
            }
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
        const normalized = customOpenTo.trim().slice(0, 32)
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
        setError(null)
        const idempotencyKey = submitIdempotencyKeyRef.current
        if (!idempotencyKey) {
            setError('Unable to submit yet. Please wait a moment and retry.')
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
            queryClient.invalidateQueries({ queryKey: ['profile'] })
            queryClient.invalidateQueries({ queryKey: ['user'] })
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
            setIsLoading(false)
        }
    }

    const canProceed = () => {
        const required = ONBOARDING_REQUIRED_FIELDS[step as 1 | 2 | 3 | 4] || []
        for (const field of required) {
            if (field === 'username' && !validateUsername(data.username).valid) return false
            if (field === 'fullName' && data.fullName.trim().length < 2) return false
            if (field === 'skills' && data.skills.length < 1) return false
        }
        return true
    }

    const selectedSkills = useMemo(() => new Set(data.skills), [data.skills])
    const selectedInterests = useMemo(() => new Set(data.interests), [data.interests])
    const selectedOpenTo = useMemo(() => new Set(data.openTo), [data.openTo])
    const filledSocialLinks = useMemo(
        () => Object.entries(data.socialLinks).filter(([, value]) => Boolean(value)),
        [data.socialLinks]
    )

    const step2Sections = useMemo(() => ONBOARDING_STEP2_SECTIONS.map((section) => {
        const done =
            section.id === 'identity'
                ? Boolean(data.genderIdentity || data.pronouns)
                : section.id === 'work'
                    ? Boolean(data.experienceLevel || data.hoursPerWeek || data.openTo.length > 0)
                    : section.id === 'profile'
                        ? Boolean(data.headline || data.bio || data.location || data.website)
                        : filledSocialLinks.length > 0
        return { ...section, done }
    }), [data, filledSocialLinks.length])

    if (isInitializing) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30 p-4 py-8">
            <div className="max-w-2xl mx-auto space-y-6">
                {/* Progress */}
                <div className="space-y-2">
                    <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Step {step} of {TOTAL_STEPS}</span>
                        <span>{Math.round((step / TOTAL_STEPS) * 100)}% complete</span>
                    </div>
                    <div className="flex gap-2">
                        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                            <div
                                key={i}
                                className={`h-2 flex-1 rounded-full transition-colors ${i < step ? 'bg-primary' : 'bg-muted'
                                    }`}
                            />
                        ))}
                    </div>
                </div>

                {/* Step 1: Basic Info with Social Pre-fill */}
                {step === 1 && (
                    <Card className="border-0 shadow-xl">
                        <CardHeader className="text-center pb-2">
                            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                                <User className="w-6 h-6 text-primary" />
                            </div>
                            <CardTitle className="text-2xl">
                                {data.fullName ? `Welcome, ${data.fullName.split(' ')[0]}! 👋` : "Let's get started"}
                            </CardTitle>
                            <CardDescription>
                                Choose your unique username
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            {/* Avatar - Pre-filled from social */}
                            <div className="flex flex-col items-center gap-4">
                                <Avatar className="w-24 h-24 ring-4 ring-primary/10">
                                    <AvatarImage src={data.avatarUrl} />
                                    <AvatarFallback className="text-2xl bg-gradient-to-br from-blue-500 to-purple-500 text-white">
                                        {data.fullName.slice(0, 2).toUpperCase() || 'U'}
                                    </AvatarFallback>
                                </Avatar>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleAvatarChange}
                                    accept="image/*"
                                    className="hidden"
                                />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploadingAvatar}
                                >
                                    {isUploadingAvatar ? (
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    ) : (
                                        <Camera className="w-4 h-4 mr-2" />
                                    )}
                                    {isUploadingAvatar ? 'Uploading...' : 'Change photo'}
                                </Button>
                            </div>

                            <div className="space-y-4">
                                {/* Full Name - Pre-filled from social */}
                                <div className="space-y-2">
                                    <Label htmlFor="fullName">Full Name <span className="text-red-500">*</span></Label>
                                    <Input
                                        id="fullName"
                                        placeholder="John Doe"
                                        value={data.fullName}
                                        onChange={(e) => updateData({ fullName: e.target.value })}
                                        className="h-11"
                                    />
                                    {data.avatarUrl && (
                                        <p className="text-xs text-green-600 dark:text-green-400">
                                            ✓ Pre-filled from your account
                                        </p>
                                    )}
                                </div>

                                {/* Username with real-time check */}
                                <UsernameInput
                                    value={data.username}
                                    onChange={(username) => updateData({ username })}
                                    fullName={data.fullName}
                                />
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Step 2: Identity, Availability, and Professional Info */}
                {step === 2 && (
                    <Card className="border-0 shadow-xl">
                        <CardHeader className="text-center pb-2">
                            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                                <Briefcase className="w-6 h-6 text-primary" />
                            </div>
                            <CardTitle className="text-2xl">Profile details</CardTitle>
                            <CardDescription>
                                Add the details we use for matching and outreach preferences
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            <div className="sticky top-2 z-10 rounded-lg border bg-background/95 backdrop-blur p-3 space-y-3">
                                <div className="flex flex-wrap gap-2">
                                    {step2Sections.map((section) => (
                                        <div
                                            key={section.id}
                                            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs ${section.done
                                                ? 'bg-primary/10 text-primary'
                                                : 'bg-muted text-muted-foreground'
                                                }`}
                                        >
                                            {section.done ? <Check className="w-3 h-3" /> : null}
                                            {section.label}
                                        </div>
                                    ))}
                                </div>
                                <Tabs
                                    value={step2Section}
                                    onValueChange={(nextValue) => {
                                        const nextSection = ONBOARDING_STEP2_SECTIONS.find((item) => item.id === nextValue)
                                        if (!nextSection) return
                                        renderStartedAtRef.current = performance.now()
                                        markInteraction('toggle')
                                        setStep2Section(nextSection.id)
                                    }}
                                >
                                    <TabsList className="w-full h-auto flex-wrap">
                                        {step2Sections.map((section) => (
                                            <TabsTrigger key={section.id} value={section.id} className="h-8">
                                                {section.label}
                                            </TabsTrigger>
                                        ))}
                                    </TabsList>
                                </Tabs>
                            </div>

                            {step2Section === 'identity' && (
                                <div className="space-y-6">
                                    <fieldset className="space-y-3">
                                        <legend className="text-base font-medium">Gender (optional)</legend>
                                        <div className="flex flex-wrap gap-2">
                                            {GENDER_OPTIONS.map((option) => (
                                                <label
                                                    key={option.value}
                                                    className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm cursor-pointer transition-colors ${data.genderIdentity === option.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:border-primary/50'}`}
                                                >
                                                    <input
                                                        type="radio"
                                                        name="genderIdentity"
                                                        value={option.value}
                                                        checked={data.genderIdentity === option.value}
                                                        onChange={() => updateData({ genderIdentity: option.value }, 'toggle')}
                                                        className="sr-only"
                                                    />
                                                    {option.label}
                                                </label>
                                            ))}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Optional. This helps personalize your profile and recommendations.
                                        </p>
                                    </fieldset>

                                    <div className="space-y-2">
                                        <Label htmlFor="pronouns">Pronouns (optional)</Label>
                                        <Input
                                            id="pronouns"
                                            placeholder="e.g. he/him, she/her, they/them"
                                            value={data.pronouns}
                                            onChange={(e) => updateData({ pronouns: e.target.value }, 'input')}
                                            className="h-11"
                                        />
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs text-muted-foreground">Optional. You can skip and edit later in settings.</p>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 px-2 text-xs"
                                                onClick={() => updateData({ genderIdentity: '', pronouns: '' }, 'toggle')}
                                            >
                                                Skip for now
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {step2Section === 'work' && (
                                <div className="space-y-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="experienceLevel">Experience level</Label>
                                            <select
                                                id="experienceLevel"
                                                value={data.experienceLevel}
                                                onChange={(e) => updateData({ experienceLevel: e.target.value as OnboardingData['experienceLevel'] }, 'toggle')}
                                                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                                            >
                                                <option value="">Select experience level</option>
                                                {EXPERIENCE_LEVEL_OPTIONS.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="hoursPerWeek">Availability per week</Label>
                                            <select
                                                id="hoursPerWeek"
                                                value={data.hoursPerWeek}
                                                onChange={(e) => updateData({ hoursPerWeek: e.target.value as OnboardingData['hoursPerWeek'] }, 'toggle')}
                                                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                                            >
                                                <option value="">Select weekly commitment</option>
                                                {HOURS_PER_WEEK_OPTIONS.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <fieldset className="space-y-3">
                                        <legend className="text-base font-medium">Open to</legend>
                                        <div className="flex flex-wrap gap-2">
                                            {OPEN_TO_SUGGESTIONS.map((option) => (
                                                <label key={option} className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm cursor-pointer transition-colors ${selectedOpenTo.has(option) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:border-primary/50'}`}>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedOpenTo.has(option)}
                                                        onChange={() => toggleOpenTo(option)}
                                                        className="sr-only"
                                                    />
                                                    {option}
                                                </label>
                                            ))}
                                        </div>
                                        {ONBOARDING_FEATURE_FLAGS.enableCustomOpenTo && (
                                            <div className="flex gap-2">
                                                <Input
                                                    value={customOpenTo}
                                                    onChange={(e) => {
                                                        setCustomOpenTo(e.target.value)
                                                        setCustomOpenToError(null)
                                                    }}
                                                    placeholder="Add custom preference (e.g. Weekend projects)"
                                                    className="h-10"
                                                />
                                                <Button type="button" variant="outline" onClick={addCustomOpenTo}>
                                                    Add
                                                </Button>
                                            </div>
                                        )}
                                        {customOpenToError && (
                                            <p className="text-xs text-destructive">{customOpenToError}</p>
                                        )}
                                        <p className="text-xs text-muted-foreground">
                                            Matching example: users selecting “Mentorship” will see mentor-request opportunities first.
                                        </p>
                                    </fieldset>

                                    <fieldset className="space-y-3">
                                        <legend className="text-base font-medium flex items-center gap-2">
                                            <Clock3 className="w-4 h-4 text-muted-foreground" />
                                            Current availability
                                        </legend>
                                        <div className="space-y-2">
                                            {AVAILABILITY_OPTIONS.map((option) => (
                                                <label
                                                    key={option.value}
                                                    className={`block p-3 rounded-lg border cursor-pointer transition-all ${data.availabilityStatus === option.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
                                                >
                                                    <input
                                                        type="radio"
                                                        name="availabilityStatus"
                                                        value={option.value}
                                                        checked={data.availabilityStatus === option.value}
                                                        onChange={() => updateData({ availabilityStatus: option.value }, 'toggle')}
                                                        className="sr-only"
                                                    />
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <p className="font-medium">{option.label}</p>
                                                            <p className="text-sm text-muted-foreground">{option.desc}</p>
                                                        </div>
                                                        {data.availabilityStatus === option.value && (
                                                            <Check className="w-4 h-4 text-primary" />
                                                        )}
                                                    </div>
                                                </label>
                                            ))}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Availability affects outreach urgency and recommendation timing.
                                        </p>
                                    </fieldset>
                                </div>
                            )}

                            {step2Section === 'profile' && (
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="headline">Headline</Label>
                                        <Input
                                            id="headline"
                                            placeholder="e.g. Full Stack Developer | Open Source Enthusiast"
                                            value={data.headline}
                                            onChange={(e) => updateData({ headline: e.target.value }, 'input')}
                                            className="h-11"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="bio">Bio</Label>
                                        <textarea
                                            id="bio"
                                            placeholder="Tell us about yourself, your experience, and what you're passionate about..."
                                            value={data.bio}
                                            onChange={(e) => updateData({ bio: e.target.value }, 'input')}
                                            className="w-full min-h-[120px] px-3 py-2 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                            maxLength={500}
                                        />
                                        <p className="text-xs text-muted-foreground text-right">{data.bio.length}/500</p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <Label htmlFor="location">Location</Label>
                                                <button
                                                    type="button"
                                                    onClick={async () => {
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
                                                    disabled={isDetectingLocation}
                                                    className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 disabled:opacity-50"
                                                >
                                                    {isDetectingLocation ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
                                                    {isDetectingLocation ? 'Detecting...' : 'Use my location'}
                                                </button>
                                            </div>
                                            <div className="relative">
                                                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                                <Input
                                                    id="location"
                                                    placeholder="San Francisco, CA"
                                                    value={data.location}
                                                    onChange={(e) => updateData({ location: e.target.value }, 'input')}
                                                    className="h-11 pl-10"
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="website">Website</Label>
                                            <div className="relative">
                                                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                                <Input
                                                    id="website"
                                                    placeholder="https://yoursite.com"
                                                    value={data.website}
                                                    onChange={(e) => updateData({ website: e.target.value }, 'input')}
                                                    className="h-11 pl-10"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {step2Section === 'social' && (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                        <Users className="w-4 h-4 text-muted-foreground" />
                                        <Label className="text-base">Social links (optional)</Label>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="githubLink">GitHub URL</Label>
                                            <Input
                                                id="githubLink"
                                                placeholder="github.com/your-handle"
                                                value={data.socialLinks.github}
                                                onChange={(e) => updateSocialLink('github', e.target.value)}
                                                className="h-11"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="linkedinLink">LinkedIn URL</Label>
                                            <Input
                                                id="linkedinLink"
                                                placeholder="linkedin.com/in/your-handle"
                                                value={data.socialLinks.linkedin}
                                                onChange={(e) => updateSocialLink('linkedin', e.target.value)}
                                                className="h-11"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="xLink">X URL</Label>
                                            <Input
                                                id="xLink"
                                                placeholder="x.com/your-handle"
                                                value={data.socialLinks.x}
                                                onChange={(e) => updateSocialLink('x', e.target.value)}
                                                className="h-11"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="portfolioLink">Portfolio URL</Label>
                                            <Input
                                                id="portfolioLink"
                                                placeholder="https://yourportfolio.com"
                                                value={data.socialLinks.portfolio}
                                                onChange={(e) => updateSocialLink('portfolio', e.target.value)}
                                                className="h-11"
                                            />
                                        </div>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Example: adding GitHub improves technical match ranking for engineering roles.
                                    </p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Step 3: Skills & Interests */}
                {step === 3 && (
                    <Card className="border-0 shadow-xl">
                        <CardHeader className="text-center pb-2">
                            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                                <Sparkles className="w-6 h-6 text-primary" />
                            </div>
                            <CardTitle className="text-2xl">Skills & Interests</CardTitle>
                            <CardDescription>
                                Select at least one skill to help us match you with relevant projects
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            <div className="space-y-4">
                                <div>
                                    <Label className="text-base">Skills <span className="text-red-500">*</span></Label>
                                    <p className="text-sm text-muted-foreground mb-3">
                                        Select the skills you&apos;re proficient in
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {SKILL_SUGGESTIONS.map((skill) => (
                                            <label
                                                key={skill}
                                                className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm cursor-pointer transition-colors ${selectedSkills.has(skill) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:border-primary/50'}`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedSkills.has(skill)}
                                                    onChange={() => toggleSkill(skill)}
                                                    className="sr-only"
                                                />
                                                {selectedSkills.has(skill) && <Check className="w-3 h-3 mr-1" />}
                                                {skill}
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <Label className="text-base">Interests</Label>
                                    <p className="text-sm text-muted-foreground mb-3">
                                        What areas are you interested in?
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {INTEREST_SUGGESTIONS.map((interest) => (
                                            <label
                                                key={interest}
                                                className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm cursor-pointer transition-colors ${selectedInterests.has(interest) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:border-primary/50'}`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedInterests.has(interest)}
                                                    onChange={() => toggleInterest(interest)}
                                                    className="sr-only"
                                                />
                                                {selectedInterests.has(interest) && <Check className="w-3 h-3 mr-1" />}
                                                {interest}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Step 4: Privacy */}
                {step === 4 && (
                    <Card className="border-0 shadow-xl">
                        <CardHeader className="text-center pb-2">
                            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                                <Shield className="w-6 h-6 text-primary" />
                            </div>
                            <CardTitle className="text-2xl">Privacy and messaging</CardTitle>
                            <CardDescription>
                                Set profile visibility and who can message you
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            <fieldset className="space-y-3">
                                <legend className="text-base font-medium">Who can view your profile?</legend>
                                {[
                                    { value: 'public', label: 'Public', desc: 'Anyone can view your profile' },
                                    { value: 'connections', label: 'Connections Only', desc: 'Only your connections can view your profile' },
                                    { value: 'private', label: 'Private', desc: 'Only you can view your profile' }
                                ].map((option) => (
                                    <label
                                        key={option.value}
                                        className={`block p-4 rounded-lg border-2 cursor-pointer transition-all ${data.visibility === option.value
                                            ? 'border-primary bg-primary/5'
                                            : 'border-border hover:border-primary/50'
                                            }`}
                                    >
                                        <input
                                            type="radio"
                                            name="visibility"
                                            value={option.value}
                                            checked={data.visibility === option.value}
                                            onChange={() => updateData({ visibility: option.value as OnboardingData['visibility'] }, 'toggle')}
                                            className="sr-only"
                                        />
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="font-medium">{option.label}</p>
                                                <p className="text-sm text-muted-foreground">{option.desc}</p>
                                            </div>
                                            {data.visibility === option.value && (
                                                <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                                                    <Check className="w-3 h-3 text-primary-foreground" />
                                                </div>
                                            )}
                                        </div>
                                    </label>
                                ))}
                            </fieldset>

                            <fieldset className="space-y-3">
                                <legend className="text-base font-medium">Who can message you?</legend>
                                {MESSAGE_PRIVACY_OPTIONS.map((option) => (
                                    <label
                                        key={option.value}
                                        className={`block p-4 rounded-lg border-2 cursor-pointer transition-all ${data.messagePrivacy === option.value
                                            ? 'border-primary bg-primary/5'
                                            : 'border-border hover:border-primary/50'
                                            }`}
                                    >
                                        <input
                                            type="radio"
                                            name="messagePrivacy"
                                            value={option.value}
                                            checked={data.messagePrivacy === option.value}
                                            onChange={() => updateData({ messagePrivacy: option.value }, 'toggle')}
                                            className="sr-only"
                                        />
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="font-medium">{option.label}</p>
                                                <p className="text-sm text-muted-foreground">{option.desc}</p>
                                            </div>
                                            {data.messagePrivacy === option.value && (
                                                <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                                                    <Check className="w-3 h-3 text-primary-foreground" />
                                                </div>
                                            )}
                                        </div>
                                    </label>
                                ))}
                                <p className="text-xs text-muted-foreground">
                                    Message privacy controls DM access and reduces unwanted outreach. Example: choosing “Connections only” blocks cold DMs.
                                </p>
                            </fieldset>

                            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                                <p className="text-sm font-medium">Review before submit</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                                    <p><span className="text-muted-foreground">Visibility:</span> {data.visibility}</p>
                                    <p><span className="text-muted-foreground">Messages:</span> {data.messagePrivacy}</p>
                                    <p><span className="text-muted-foreground">Availability:</span> {data.availabilityStatus}</p>
                                    <p><span className="text-muted-foreground">Skills:</span> {data.skills.length}</p>
                                    <p><span className="text-muted-foreground">Open to:</span> {data.openTo.length}</p>
                                    <p><span className="text-muted-foreground">Social links:</span> {filledSocialLinks.length}</p>
                                </div>
                            </div>

                            {error && (
                                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                                    {error}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Navigation */}
                <div className="flex justify-between">
                    <Button
                        variant="ghost"
                        onClick={prevStep}
                        disabled={step === 1}
                        className="gap-2"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </Button>

                    {step < TOTAL_STEPS ? (
                        <Button
                            onClick={nextStep}
                            disabled={!canProceed()}
                            className="gap-2"
                        >
                            Continue
                            <ArrowRight className="w-4 h-4" />
                        </Button>
                    ) : (
                        <Button
                            onClick={handleSubmit}
                            disabled={isLoading}
                            className="gap-2"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Setting up...
                                </>
                            ) : (
                                <>
                                    Complete Setup
                                    <Check className="w-4 h-4" />
                                </>
                            )}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    )
}
