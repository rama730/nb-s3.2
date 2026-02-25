'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
    ArrowLeft,
    ArrowRight,
    Check,
    Loader2,
    Camera,
    MapPin,
    Globe,
    Briefcase,
    User,
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
    visibility: 'public' | 'connections' | 'private'
}

const TOTAL_STEPS = 4
const ONBOARDING_DRAFT_KEY = 'onboarding:draft:v1'
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
    visibility: 'public',
}

function readOnboardingDraft(): { step: number; data: Partial<OnboardingData>; updatedAt: number } | null {
    if (typeof window === 'undefined') return null
    try {
        const raw = window.localStorage.getItem(ONBOARDING_DRAFT_KEY)
        if (!raw) return null
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
        if (
            sourceData.visibility === 'public' ||
            sourceData.visibility === 'connections' ||
            sourceData.visibility === 'private'
        ) {
            data.visibility = sourceData.visibility
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
    const [isLoading, setIsLoading] = useState(false)
    const [isInitializing, setIsInitializing] = useState(true)
    const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
    const [isDetectingLocation, setIsDetectingLocation] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const draftHydratedRef = useRef(false)
    const draftVersionRef = useRef<number>(0)
    const submitIdempotencyKeyRef = useRef<string>('')
    const [error, setError] = useState<string | null>(null)

    const [data, setData] = useState<OnboardingData>(EMPTY_ONBOARDING_DATA)

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
                        setData(prev => ({ ...prev, ...preferredDraft.data }))
                    }
                    if (remoteDraftResult.success) {
                        draftVersionRef.current = remoteDraftResult.version || 0
                    }

                    const metadata = user.user_metadata || {}

                    // Pre-fill from social login data without overwriting draft input.
                    setData(prev => ({
                        ...prev,
                        fullName: prev.fullName || metadata.full_name || metadata.name || '',
                        avatarUrl: prev.avatarUrl || metadata.avatar_url || metadata.picture || '',
                    }))

                    // Ensure profile record exists in database
                    const { ensureUserProfile } = await import('@/app/actions/database')
                    await ensureUserProfile()
                }
                draftHydratedRef.current = true
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
        } catch (storageError) {
            console.warn('Unable to persist onboarding draft:', storageError)
        }
    }, [step, data, isInitializing])

    useEffect(() => {
        if (isInitializing) return
        if (!draftHydratedRef.current) return

        const timer = window.setTimeout(() => {
            void (async () => {
                try {
                    const result = await saveOnboardingDraft({
                        step,
                        draft: data,
                        expectedVersion: draftVersionRef.current,
                    })
                    if (result.success) {
                        draftVersionRef.current = result.version ?? draftVersionRef.current
                        return
                    }

                    if (result.errorDetails?.code === 'DRAFT_CONFLICT') {
                        draftVersionRef.current = result.version ?? draftVersionRef.current
                        if (result.draft) {
                            setData(prev => ({ ...prev, ...result.draft }))
                        }
                        if (typeof result.step === 'number') {
                            setStep(result.step)
                        }
                        setError('Your draft was updated in another tab. Latest version has been synced.')
                    }
                } catch (draftError) {
                    console.error('Unable to save onboarding draft:', draftError)
                    setError('Unable to save draft right now. Please try again.')
                }
            })()
        }, 600)

        return () => {
            window.clearTimeout(timer)
        }
    }, [step, data, isInitializing])

    useEffect(() => {
        if (isInitializing) return
        void trackOnboardingEvent({
            eventType: 'step_view',
            step,
        })
    }, [step, isInitializing])

    const updateData = (updates: Partial<OnboardingData>) => {
        setData(prev => ({ ...prev, ...updates }))
    }

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
                    const { compressAvatar } = await import('@/lib/services/avatar-service')
                    const compressedBlob = await compressAvatar(file)
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
        if (step < TOTAL_STEPS) {
            void trackOnboardingEvent({ eventType: 'step_continue', step })
            setStep(step + 1)
        }
    }

    const prevStep = () => {
        if (step > 1) {
            void trackOnboardingEvent({ eventType: 'step_back', step })
            setStep(step - 1)
        }
    }

    const toggleSkill = (skill: string) => {
        setData(prev => ({
            ...prev,
            skills: prev.skills.includes(skill)
                ? prev.skills.filter(s => s !== skill)
                : [...prev.skills, skill]
        }))
    }

    const toggleInterest = (interest: string) => {
        setData(prev => ({
            ...prev,
            interests: prev.interests.includes(interest)
                ? prev.interests.filter(i => i !== interest)
                : [...prev.interests, interest]
        }))
    }

    const handleSubmit = async () => {
        setError(null)
        const idempotencyKey = submitIdempotencyKeyRef.current
        if (!idempotencyKey) {
            setError('Unable to submit yet. Please wait a moment and retry.')
            return
        }
        setIsLoading(true)
        void trackOnboardingEvent({
            eventType: 'submit_start',
            step: TOTAL_STEPS,
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
                visibility: data.visibility,
                idempotencyKey,
            })

            if (!result.success) {
                setError(result.errorDetails?.message || result.error || 'Failed to complete setup')
                void trackOnboardingEvent({
                    eventType: 'submit_error',
                    step: TOTAL_STEPS,
                    metadata: {
                        reason: result.errorDetails?.code || result.error || 'unknown',
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
                window.localStorage.removeItem(ONBOARDING_DRAFT_KEY)
                window.localStorage.removeItem(ONBOARDING_SUBMIT_KEY)
            }
            void trackOnboardingEvent({
                eventType: 'submit_success',
                step: TOTAL_STEPS,
                metadata: { needsMetadataSync: result.needsMetadataSync === true },
            })
            router.push('/hub')

        } catch {
            setError('An unexpected error occurred')
            void trackOnboardingEvent({
                eventType: 'submit_error',
                step: TOTAL_STEPS,
                metadata: { reason: 'unexpected' },
            })
        } finally {
            setIsLoading(false)
        }
    }

    const canProceed = () => {
        switch (step) {
            case 1:
                return validateUsername(data.username).valid && data.fullName.length >= 2
            case 2:
                return true // Optional step
            case 3:
                return data.skills.length >= 1
            case 4:
                return true
            default:
                return false
        }
    }

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

                {/* Step 2: Professional Info */}
                {step === 2 && (
                    <Card className="border-0 shadow-xl">
                        <CardHeader className="text-center pb-2">
                            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                                <Briefcase className="w-6 h-6 text-primary" />
                            </div>
                            <CardTitle className="text-2xl">Professional details</CardTitle>
                            <CardDescription>
                                Help others understand what you do (optional)
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="headline">Headline</Label>
                                    <Input
                                        id="headline"
                                        placeholder="e.g. Full Stack Developer | Open Source Enthusiast"
                                        value={data.headline}
                                        onChange={(e) => updateData({ headline: e.target.value })}
                                        className="h-11"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="bio">Bio</Label>
                                    <textarea
                                        id="bio"
                                        placeholder="Tell us about yourself, your experience, and what you're passionate about..."
                                        value={data.bio}
                                        onChange={(e) => updateData({ bio: e.target.value })}
                                        className="w-full min-h-[120px] px-3 py-2 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                        maxLength={500}
                                    />
                                    <p className="text-xs text-muted-foreground text-right">
                                        {data.bio.length}/500
                                    </p>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
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
                                                            updateData({ location: location.formatted })
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
                                                {isDetectingLocation ? (
                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                ) : (
                                                    <MapPin className="w-3 h-3" />
                                                )}
                                                {isDetectingLocation ? 'Detecting...' : 'Use my location'}
                                            </button>
                                        </div>
                                        <div className="relative">
                                            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                            <Input
                                                id="location"
                                                placeholder="San Francisco, CA"
                                                value={data.location}
                                                onChange={(e) => updateData({ location: e.target.value })}
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
                                                onChange={(e) => updateData({ website: e.target.value })}
                                                className="h-11 pl-10"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
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
                                            <Badge
                                                key={skill}
                                                variant={data.skills.includes(skill) ? 'default' : 'outline'}
                                                className="cursor-pointer hover:bg-primary/90 transition-colors py-1.5 px-3"
                                                onClick={() => toggleSkill(skill)}
                                            >
                                                {data.skills.includes(skill) && (
                                                    <Check className="w-3 h-3 mr-1" />
                                                )}
                                                {skill}
                                            </Badge>
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
                                            <Badge
                                                key={interest}
                                                variant={data.interests.includes(interest) ? 'default' : 'outline'}
                                                className="cursor-pointer hover:bg-primary/90 transition-colors py-1.5 px-3"
                                                onClick={() => toggleInterest(interest)}
                                            >
                                                {data.interests.includes(interest) && (
                                                    <Check className="w-3 h-3 mr-1" />
                                                )}
                                                {interest}
                                            </Badge>
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
                                <Check className="w-6 h-6 text-primary" />
                            </div>
                            <CardTitle className="text-2xl">Almost done!</CardTitle>
                            <CardDescription>
                                Choose who can see your profile
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            <div className="space-y-3">
                                {[
                                    { value: 'public', label: 'Public', desc: 'Anyone can view your profile' },
                                    { value: 'connections', label: 'Connections Only', desc: 'Only your connections can view your profile' },
                                    { value: 'private', label: 'Private', desc: 'Only you can view your profile' }
                                ].map((option) => (
                                    <div
                                        key={option.value}
                                        onClick={() => updateData({ visibility: option.value as OnboardingData['visibility'] })}
                                        className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${data.visibility === option.value
                                            ? 'border-primary bg-primary/5'
                                            : 'border-border hover:border-primary/50'
                                            }`}
                                    >
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
                                    </div>
                                ))}
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
