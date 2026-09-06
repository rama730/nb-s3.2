'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import TurnstileWidget, { hasTurnstileSiteKey } from '@/components/auth/TurnstileWidget'
import { GoogleOneTap } from '@/components/auth/GoogleOneTap'
import { AuthAmbientCanvas } from '@/components/auth/AuthAmbientCanvas'
import { Github, Loader2, Eye, EyeOff, AlertCircle, Check, X, Sparkles, Mail, ArrowLeft, ShieldCheck } from 'lucide-react'
import { buildAuthPageHref, resolveAuthRedirectPath } from '@/lib/auth/redirects'
import { getPasswordPolicyResult, PASSWORD_MIN_LENGTH } from '@/lib/security/password-policy'
import { LegalLinks } from '@/components/legal/LegalLinks'
import { detectEmailDomainTypo } from '@/lib/validations/email-typo'
import { sanitizeUsernameInput } from '@/lib/validations/username'
import { isDisposableEmail } from '@/lib/validations/disposable-email'
import { createClient } from '@/lib/supabase/client'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

function GoogleIcon({ className = 'w-4 h-4' }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
        </svg>
    )
}

function SignupPageInner() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { signUp, verifyOtp, signInWithGoogle, signInWithGitHub } = useAuth()
    const redirectPath = resolveAuthRedirectPath(searchParams.get('redirect'))
    const loginHref = buildAuthPageHref('/login', redirectPath)
    const inviteParam = searchParams.get('invite') || searchParams.get('ref') || searchParams.get('project')
    const oneTapNextPath = inviteParam
        ? `${redirectPath}${redirectPath.includes('?') ? '&' : '?'}invite=${encodeURIComponent(inviteParam)}`
        : redirectPath

    const [fullName, setFullName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirmPassword, setShowConfirmPassword] = useState(false)
    const [showEmailFields, setShowEmailFields] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [oauthProviderLoading, setOauthProviderLoading] = useState<'google' | 'github' | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)
    const [captchaToken, setCaptchaToken] = useState<string | null>(null)
    const [legalAccepted, setLegalAccepted] = useState(false)

    const [honeypot, setHoneypot] = useState('')
    const [handleStatus, setHandleStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')
    const idempotencyKeyRef = useRef<string>(
        typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now())
    )

    // In-App OTP Verification State
    const [isVerifyingOtp, setIsVerifyingOtp] = useState(false)
    const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', ''])
    const [isOtpLoading, setIsOtpLoading] = useState(false)
    const [otpError, setOtpError] = useState<string | null>(null)
    const [resendCooldown, setResendCooldown] = useState(0)
    const [resendMessage, setResendMessage] = useState<string | null>(null)
    const otpInputRefs = useRef<(HTMLInputElement | null)[]>([])

    const submitRequestIdRef = useRef(0)
    const fullNameInputRef = useRef<HTMLInputElement | null>(null)
    const isEmailSectionOpen = showEmailFields || Boolean(error) || Boolean(email) || Boolean(fullName)

    const DUPLICATE_EMAIL_MESSAGE = 'This email has already been used to create an account'

    // Live Handle Preview
    const suggestedHandle = useMemo(() => {
        if (!fullName.trim()) return ''
        return sanitizeUsernameInput(fullName.trim().replace(/\s+/g, '_'))
    }, [fullName])

    // Client-side domain typo heuristic
    const emailTypo = useMemo(() => {
        return detectEmailDomainTypo(email)
    }, [email])

    // Client-side disposable domain check
    const isDisposable = useMemo(() => {
        return isDisposableEmail(email)
    }, [email])

    // Restore non-sensitive draft fields (fullName, email) from sessionStorage
    useEffect(() => {
        try {
            const draftRaw = sessionStorage.getItem('nb_signup_draft')
            if (draftRaw) {
                const draft = JSON.parse(draftRaw) as { fullName?: string; email?: string }
                if (draft.fullName) setFullName(draft.fullName)
                if (draft.email) setEmail(draft.email)
                if (draft.fullName || draft.email) setShowEmailFields(true)
            }
        } catch {
            // Ignore storage access issues
        }
    }, [])

    useEffect(() => {
        try {
            if (fullName || email) {
                sessionStorage.setItem('nb_signup_draft', JSON.stringify({ fullName, email }))
            }
        } catch {
            // Ignore storage write issues
        }
    }, [fullName, email])

    // Debounced live handle availability check
    useEffect(() => {
        if (!suggestedHandle || suggestedHandle.length < 3) {
            setHandleStatus('idle')
            return
        }

        setHandleStatus('checking')
        const controller = new AbortController()
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/v1/onboarding/username-check?username=${encodeURIComponent(suggestedHandle)}`, {
                    signal: controller.signal,
                })
                const json = (await res.json().catch(() => null)) as { data?: { available?: boolean } } | null
                if (json?.data?.available) {
                    setHandleStatus('available')
                } else if (json?.data && !json.data.available) {
                    setHandleStatus('taken')
                } else {
                    setHandleStatus('idle')
                }
            } catch (err) {
                if ((err as Error)?.name !== 'AbortError') {
                    setHandleStatus('idle')
                }
            }
        }, 400)

        return () => {
            clearTimeout(timer)
            controller.abort()
        }
    }, [suggestedHandle])

    // Dual Session/Magic-Link listener: if user confirms via email on another device/tab, advance automatically
    useEffect(() => {
        if (!isVerifyingOtp) return
        const supabase = createClient()
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
            if (session?.user) {
                try {
                    sessionStorage.removeItem('nb_signup_draft')
                } catch {
                    // Ignore
                }
                router.push(redirectPath)
            }
        })
        return () => {
            subscription.unsubscribe()
        }
    }, [isVerifyingOtp, redirectPath, router])

    // Resend countdown effect
    useEffect(() => {
        if (resendCooldown <= 0) return
        const timer = setInterval(() => {
            setResendCooldown((prev) => Math.max(0, prev - 1))
        }, 1000)
        return () => clearInterval(timer)
    }, [resendCooldown])

    const toErrorMessage = (authError: unknown): string => {
        if (!authError) return 'Unable to create account'
        const raw =
            typeof authError === 'object' && authError !== null && 'message' in authError
                ? String((authError as { message?: unknown }).message || '')
                : String(authError)
        const normalized = raw.toLowerCase()

        if (
            normalized.includes('already registered') ||
            normalized.includes('already been registered') ||
            normalized.includes('already exists')
        ) {
            return DUPLICATE_EMAIL_MESSAGE
        }
        return raw || 'Unable to create account'
    }

    const isDuplicateObfuscatedResponse = (payload: unknown): boolean => {
        const data = (payload as { data?: { user?: { identities?: unknown[] } } } | null)?.data
        const identities = data?.user?.identities
        return Array.isArray(identities) && identities.length === 0
    }

    // Password strength indicators
    const passwordPolicy = getPasswordPolicyResult(password)
    const passwordChecks = passwordPolicy.checks
    const passwordStrength = passwordPolicy.score

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        setSuccess(null)

        if (!isEmailSectionOpen) {
            setShowEmailFields(true)
            setTimeout(() => fullNameInputRef.current?.focus({ preventScroll: true }), 50)
            return
        }

        if (isDisposable) {
            setError('Disposable or temporary email addresses are not permitted. Please use a permanent email.')
            return
        }

        if (!passwordPolicy.ok) {
            setError(passwordPolicy.error || 'Please create a stronger password')
            return
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match')
            return
        }

        if (!captchaToken) {
            setError('Please complete the human verification check')
            return
        }

        if (!legalAccepted) {
            setError('Please accept the Terms of Service and EULA to create an account')
            return
        }

        const requestId = ++submitRequestIdRef.current
        setIsLoading(true)

        try {
            const signUpResult = await Promise.race([
                signUp(
                    email.trim(),
                    password,
                    fullName.trim(),
                    captchaToken || undefined,
                    legalAccepted,
                    {
                        suggestedUsername: suggestedHandle || undefined,
                        inviteToken: inviteParam || undefined,
                        website_hp: honeypot || undefined,
                        idempotencyKey: idempotencyKeyRef.current,
                    }
                ),
                new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('Request timeout')), 15_000)
                }),
            ])

            if (requestId !== submitRequestIdRef.current) return

            if (isDuplicateObfuscatedResponse(signUpResult)) {
                setError(DUPLICATE_EMAIL_MESSAGE)
                return
            }

            const authError = (signUpResult as { error?: unknown } | null)?.error
            if (authError) {
                setError(toErrorMessage(authError))
                return
            }

            const data = (signUpResult as { data?: { session?: unknown; user?: unknown } } | null)?.data
            if (data?.session) {
                try {
                    sessionStorage.removeItem('nb_signup_draft')
                } catch {
                    // Ignore
                }
                router.push(redirectPath)
                return
            }

            if (data?.user) {
                setIsVerifyingOtp(true)
                setResendCooldown(60)
                setTimeout(() => otpInputRefs.current[0]?.focus(), 150)
                return
            }

            setError('Unable to create account. Please try again.')
        } catch (signupError) {
            if (requestId !== submitRequestIdRef.current) return
            if (signupError instanceof Error && signupError.message === 'Request timeout') {
                setError('Signup is taking too long. Please try again.')
            } else {
                setError('An unexpected error occurred')
            }
        } finally {
            if (requestId === submitRequestIdRef.current) {
                setIsLoading(false)
            }
        }
    }

    const handleOtpChange = (index: number, val: string) => {
        const clean = val.replace(/[^0-9]/g, '')
        if (!clean) {
            const next = [...otpDigits]
            next[index] = ''
            setOtpDigits(next)
            return
        }
        if (clean.length > 1) {
            const pasted = clean.slice(0, 6).split('')
            const next = [...otpDigits]
            pasted.forEach((char, i) => {
                if (i < 6) next[i] = char
            })
            setOtpDigits(next)
            const target = Math.min(pasted.length, 5)
            otpInputRefs.current[target]?.focus()
            return
        }
        const next = [...otpDigits]
        next[index] = clean
        setOtpDigits(next)
        if (index < 5) {
            otpInputRefs.current[index + 1]?.focus()
        }
    }

    const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
            otpInputRefs.current[index - 1]?.focus()
        }
    }

    const handleVerifyOtp = async (e?: React.FormEvent) => {
        if (e) e.preventDefault()
        const code = otpDigits.join('').trim()
        if (code.length !== 6) {
            setOtpError('Please enter all 6 digits')
            return
        }
        setIsOtpLoading(true)
        setOtpError(null)
        try {
            const res = await verifyOtp(email, code, 'signup')
            if (res.error) {
                setOtpError(res.error.message || 'Invalid or expired verification code')
                return
            }
            try {
                sessionStorage.removeItem('nb_signup_draft')
            } catch {
                // Ignore
            }
            router.push(redirectPath)
        } catch {
            setOtpError('Verification failed. Please check the code and try again.')
        } finally {
            setIsOtpLoading(false)
        }
    }

    const handleResendOtp = async () => {
        if (resendCooldown > 0) return
        setOtpError(null)
        setResendMessage(null)
        try {
            await fetch('/api/v1/auth/verify-email', {
                method: 'POST',
                credentials: 'same-origin',
            })
            setResendCooldown(60)
            setResendMessage('A new verification code has been dispatched. Check your inbox.')
        } catch {
            setResendCooldown(60)
            setResendMessage('Verification code requested. Please check your inbox.')
        }
    }

    const handleGoogleSignIn = async () => {
        setError(null)
        setOauthProviderLoading('google')
        try {
            const nextWithInvite = inviteParam
                ? `${redirectPath}${redirectPath.includes('?') ? '&' : '?'}invite=${encodeURIComponent(inviteParam)}`
                : redirectPath
            const legalNext = `/legal/accept?context=oauth_signup&next=${encodeURIComponent(nextWithInvite)}`
            const { error: oauthErr } = await signInWithGoogle(legalNext)
            if (oauthErr) {
                setError(oauthErr.message)
                setOauthProviderLoading(null)
            }
        } catch {
            setError('Unable to start Google sign-in. Please try again.')
            setOauthProviderLoading(null)
        }
    }

    const handleGitHubSignIn = async () => {
        setError(null)
        setOauthProviderLoading('github')
        try {
            const nextWithInvite = inviteParam
                ? `${redirectPath}${redirectPath.includes('?') ? '&' : '?'}invite=${encodeURIComponent(inviteParam)}`
                : redirectPath
            const legalNext = `/legal/accept?context=oauth_signup&next=${encodeURIComponent(nextWithInvite)}`
            const { error: oauthErr } = await signInWithGitHub(legalNext)
            if (oauthErr) {
                setError(oauthErr.message)
                setOauthProviderLoading(null)
            }
        } catch {
            setError('Unable to start GitHub sign-in. Please try again.')
            setOauthProviderLoading(null)
        }
    }

    return (
        <main className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2 bg-background text-foreground">
            <GoogleOneTap nextPath={oneTapNextPath} onError={setError} />
            {/* Left Panel: Clean Interactive Registration & Verification Form */}
            <div className="flex flex-col justify-start sm:justify-center items-center py-8 sm:py-12 pb-16 px-6 sm:px-10 lg:px-12 xl:p-16 w-full min-h-screen overflow-y-auto">
                <div className="w-full max-w-md my-auto transition-all duration-300 ease-out">

                    {/* Optional Invitation / Referral Context Banner */}
                    {inviteParam && !isVerifyingOtp && (
                        <div className="mb-5 p-3 rounded-lg bg-primary/10 border border-primary/20 text-xs text-foreground flex items-center gap-2.5 animate-in fade-in-50 duration-200">
                            <Sparkles className="w-4 h-4 text-primary shrink-0" />
                            <span>
                                You have been invited to join <strong>NetworkBase</strong>. Complete registration to accept.
                            </span>
                        </div>
                    )}

                    {isVerifyingOtp ? (
                        /* In-App 6-Digit OTP Email Verification State */
                        <div className="space-y-6 animate-in fade-in-50 duration-300">
                            <div className="text-center space-y-2">
                                <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-3">
                                    <Mail className="w-6 h-6" />
                                </div>
                                <h1 className="text-2xl font-semibold tracking-tight">
                                    Verify your email
                                </h1>
                                <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
                                    We sent a 6-digit confirmation code and link to{' '}
                                    <span className="font-semibold text-foreground">{email}</span>.
                                    Enter the code below or click the email link.
                                </p>
                            </div>

                            {otpError && (
                                <div
                                    role="alert"
                                    className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2.5 animate-in fade-in-50 duration-200"
                                >
                                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                    <span>{otpError}</span>
                                </div>
                            )}

                            {resendMessage && (
                                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-200 text-sm flex items-start gap-2.5 animate-in fade-in-50 duration-200">
                                    <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                                    <span>{resendMessage}</span>
                                </div>
                            )}

                            <form onSubmit={handleVerifyOtp} className="space-y-5">
                                <div className="flex justify-center gap-2 sm:gap-2.5">
                                    {otpDigits.map((digit, idx) => (
                                        <input
                                            key={idx}
                                            ref={(el) => {
                                                otpInputRefs.current[idx] = el
                                            }}
                                            type="text"
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            maxLength={1}
                                            value={digit}
                                            onChange={(e) => handleOtpChange(idx, e.target.value)}
                                            onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                                            className="w-11 h-12 sm:w-12 sm:h-14 text-center text-xl font-bold rounded-lg border border-border bg-background focus-visible:border-neutral-400 dark:focus-visible:border-neutral-500 focus-visible:ring-0 focus:outline-none transition-colors"
                                            disabled={isOtpLoading}
                                        />
                                    ))}
                                </div>

                                <Button
                                    type="submit"
                                    className="w-full h-11 font-medium shadow-sm transition-transform duration-200 active:scale-[0.99]"
                                    disabled={isOtpLoading || otpDigits.some((d) => !d)}
                                >
                                    {isOtpLoading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Verifying...
                                        </>
                                    ) : (
                                        'Verify Code'
                                    )}
                                </Button>
                            </form>

                            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground pt-2 border-t border-border/40">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsVerifyingOtp(false)
                                        setShowEmailFields(true)
                                    }}
                                    className="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
                                >
                                    <ArrowLeft className="w-3.5 h-3.5" />
                                    <span>Change email</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={handleResendOtp}
                                    disabled={resendCooldown > 0}
                                    className="hover:text-foreground disabled:opacity-50 transition-colors cursor-pointer"
                                >
                                    {resendCooldown > 0 ? (
                                        <span>Resend code in {resendCooldown}s</span>
                                    ) : (
                                        <span className="font-medium text-primary hover:underline">Resend code</span>
                                    )}
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* Standard Progressive Disclosure Signup Form */
                        <>
                            {/* Title Header */}
                            <div className="space-y-1.5 mb-6">
                                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                                    Create an account
                                </h1>
                                <p className="text-sm text-muted-foreground">
                                    Join NetworkBase and build with your network
                                </p>
                            </div>

                            {/* Side-by-Side Social Auth Buttons */}
                            <div className="grid grid-cols-2 gap-3 mb-6">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-11 w-full font-medium border-border/80 hover:bg-muted/50 transition-colors"
                                    onClick={handleGoogleSignIn}
                                    disabled={isLoading || oauthProviderLoading !== null}
                                >
                                    {oauthProviderLoading === 'google' ? (
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin text-muted-foreground shrink-0" />
                                    ) : (
                                        <GoogleIcon className="w-4 h-4 mr-2 shrink-0" />
                                    )}
                                    <span className="truncate">
                                        {oauthProviderLoading === 'google' ? 'Redirecting...' : 'Google'}
                                    </span>
                                </Button>

                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-11 w-full font-medium border-border/80 hover:bg-muted/50 transition-colors"
                                    onClick={handleGitHubSignIn}
                                    disabled={isLoading || oauthProviderLoading !== null}
                                >
                                    {oauthProviderLoading === 'github' ? (
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin text-muted-foreground shrink-0" />
                                    ) : (
                                        <Github className="w-4 h-4 mr-2 shrink-0" />
                                    )}
                                    <span className="truncate">
                                        {oauthProviderLoading === 'github' ? 'Redirecting...' : 'GitHub'}
                                    </span>
                                </Button>
                            </div>

                            {/* Divider */}
                            <div className="relative mb-6">
                                <div className="absolute inset-0 flex items-center">
                                    <hr className="w-full border-border/60" />
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowEmailFields(true)
                                            setTimeout(() => fullNameInputRef.current?.focus({ preventScroll: true }), 50)
                                        }}
                                        className="bg-background px-3 text-muted-foreground hover:text-foreground font-medium text-[11px] tracking-wider transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-0 rounded py-0.5"
                                    >
                                        or register with email
                                    </button>
                                </div>
                            </div>

                            {/* Registration Form */}
                            <form onSubmit={handleSubmit} className="w-full">
                                {/* Invisible Honeypot Field for automated scraper detection */}
                                <input
                                    type="text"
                                    name="website_hp"
                                    value={honeypot}
                                    onChange={(e) => setHoneypot(e.target.value)}
                                    tabIndex={-1}
                                    autoComplete="off"
                                    style={{
                                        position: 'absolute',
                                        opacity: 0,
                                        pointerEvents: 'none',
                                        height: 0,
                                        width: 0,
                                        margin: 0,
                                        padding: 0,
                                        zIndex: -1,
                                    }}
                                    aria-hidden="true"
                                />
                                {error && (
                                    <div
                                        role="alert"
                                        className="mb-5 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2.5 animate-in fade-in-50 duration-200"
                                    >
                                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                        <span>{error}</span>
                                    </div>
                                )}

                                {success && (
                                    <div className="mb-5 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-200 text-sm flex items-start gap-2.5 animate-in fade-in-50 duration-200">
                                        <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                                        <span>{success}</span>
                                    </div>
                                )}

                                {/* Smooth Progressive Expansion: Fields expand, pushing button in lockstep */}
                                <div
                                    className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                                        isEmailSectionOpen
                                            ? 'grid-rows-[1fr] opacity-100 mb-6'
                                            : 'grid-rows-[0fr] opacity-0 mb-0 pointer-events-none'
                                    }`}
                                >
                                    <div className="overflow-hidden space-y-4 pt-1">
                                        <div className="space-y-1.5">
                                            <label htmlFor="fullName" className="text-sm font-medium leading-none text-foreground">
                                                Full Name
                                            </label>
                                            <Input
                                                ref={fullNameInputRef}
                                                id="fullName"
                                                type="text"
                                                autoComplete="name"
                                                placeholder="Your full name"
                                                value={fullName}
                                                onChange={(e) => {
                                                    setError(null)
                                                    setFullName(e.target.value)
                                                }}
                                                className="h-11 border-border/80 bg-background focus-visible:border-neutral-400 dark:focus-visible:border-neutral-500 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none"
                                                required={isEmailSectionOpen}
                                                disabled={isLoading}
                                            />
                                            {/* Live Handle Preview with Debounced Availability Check */}
                                            {suggestedHandle.length >= 2 && (
                                                <div className="flex items-center justify-between text-[11px] text-muted-foreground/80 pt-0.5 animate-in fade-in-50 duration-200">
                                                    <div className="flex items-center gap-1.5 truncate">
                                                        <Sparkles className="w-3 h-3 text-primary/70 shrink-0" />
                                                        <span className="truncate">
                                                            Your handle will be <strong className="font-mono text-foreground font-medium">@{suggestedHandle}</strong>
                                                        </span>
                                                    </div>
                                                    {handleStatus === 'checking' && (
                                                        <span className="flex items-center gap-1 text-muted-foreground shrink-0">
                                                            <Loader2 className="w-3 h-3 animate-spin" />
                                                            <span>checking...</span>
                                                        </span>
                                                    )}
                                                    {handleStatus === 'available' && (
                                                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium shrink-0">
                                                            <Check className="w-3 h-3" />
                                                            <span>Available</span>
                                                        </span>
                                                    )}
                                                    {handleStatus === 'taken' && (
                                                        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium shrink-0">
                                                            <span>Taken (customizable in onboarding)</span>
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        <div className="space-y-1.5">
                                            <label htmlFor="email" className="text-sm font-medium leading-none text-foreground">
                                                Email
                                            </label>
                                            <Input
                                                id="email"
                                                type="email"
                                                autoComplete="username email"
                                                placeholder="name@example.com"
                                                value={email}
                                                onChange={(e) => {
                                                    setError(null)
                                                    setEmail(e.target.value)
                                                }}
                                                className="h-11 border-border/80 bg-background focus-visible:border-neutral-400 dark:focus-visible:border-neutral-500 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none"
                                                required={isEmailSectionOpen}
                                                disabled={isLoading}
                                            />
                                            {/* Disposable Domain Warning */}
                                            {isDisposable && (
                                                <div className="flex items-center gap-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-200 animate-in fade-in-50 duration-200">
                                                    <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                                                    <span>Please use a permanent email address (disposable emails are not permitted).</span>
                                                </div>
                                            )}
                                            {/* Instant Domain Typo Suggestion */}
                                            {emailTypo.hasTypo && emailTypo.suggestedEmail && !isDisposable && (
                                                <div className="flex items-center justify-between gap-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-200 animate-in fade-in-50 duration-200">
                                                    <div className="flex items-center gap-1.5 truncate">
                                                        <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                                                        <span className="truncate">
                                                            Did you mean <strong className="font-medium underline">{emailTypo.suggestedEmail}</strong>?
                                                        </span>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (emailTypo.suggestedEmail) {
                                                                setEmail(emailTypo.suggestedEmail)
                                                                setError(null)
                                                            }
                                                        }}
                                                        className="text-[11px] font-medium bg-background px-2 py-0.5 rounded border border-border shadow-xs hover:bg-muted text-foreground cursor-pointer shrink-0 transition-colors"
                                                    >
                                                        Fix typo
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <div className="space-y-1.5">
                                            <label htmlFor="password" className="text-sm font-medium leading-none text-foreground">
                                                Password
                                            </label>
                                            <div className="relative">
                                                <Input
                                                    id="password"
                                                    type={showPassword ? 'text' : 'password'}
                                                    autoComplete="new-password"
                                                    placeholder="Create a strong password"
                                                    value={password}
                                                    onChange={(e) => {
                                                        setError(null)
                                                        setPassword(e.target.value)
                                                    }}
                                                    className="pr-10 h-11 border-border/80 bg-background focus-visible:border-neutral-400 dark:focus-visible:border-neutral-500 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none"
                                                    required={isEmailSectionOpen}
                                                    disabled={isLoading}
                                                />
                                                <button
                                                    type="button"
                                                    tabIndex={-1}
                                                    onClick={() => setShowPassword(!showPassword)}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
                                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                                >
                                                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                </button>
                                            </div>

                                            {/* Password strength indicator */}
                                            {password && (
                                                <div className="space-y-2 pt-2 animate-in fade-in-50 duration-200">
                                                    <div className="flex gap-1">
                                                        {[1, 2, 3, 4].map((level) => (
                                                            <div
                                                                key={level}
                                                                className={`h-1 flex-1 rounded-full transition-colors ${
                                                                    Math.min(passwordStrength, 4) >= level
                                                                        ? passwordStrength >= 3
                                                                            ? 'bg-green-500'
                                                                            : passwordStrength >= 2
                                                                              ? 'bg-yellow-500'
                                                                              : 'bg-red-500'
                                                                        : 'bg-muted'
                                                                }`}
                                                            />
                                                        ))}
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-1 text-xs">
                                                        {[
                                                            {
                                                                check: passwordChecks.minLength,
                                                                label: `${PASSWORD_MIN_LENGTH}+ characters`,
                                                            },
                                                            { check: passwordChecks.uppercase, label: 'Uppercase' },
                                                            { check: passwordChecks.lowercase, label: 'Lowercase' },
                                                            { check: passwordChecks.number, label: 'Number' },
                                                            { check: passwordChecks.symbol, label: 'Symbol (recommended)' },
                                                        ].map(({ check, label }) => (
                                                            <div key={label} className="flex items-center gap-1">
                                                                {check ? (
                                                                    <Check className="w-3 h-3 text-green-500" />
                                                                ) : (
                                                                    <X className="w-3 h-3 text-muted-foreground" />
                                                                )}
                                                                <span
                                                                    className={check ? 'text-green-500' : 'text-muted-foreground'}
                                                                >
                                                                    {label}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Confirm Password Field */}
                                        <div className="space-y-1.5">
                                            <label htmlFor="confirmPassword" className="text-sm font-medium leading-none text-foreground">
                                                Confirm Password
                                            </label>
                                            <div className="relative">
                                                <Input
                                                    id="confirmPassword"
                                                    type={showConfirmPassword ? 'text' : 'password'}
                                                    autoComplete="new-password"
                                                    placeholder="Re-enter your password"
                                                    value={confirmPassword}
                                                    onChange={(e) => {
                                                        setError(null)
                                                        setConfirmPassword(e.target.value)
                                                    }}
                                                    className="pr-10 h-11 border-border/80 bg-background focus-visible:border-neutral-400 dark:focus-visible:border-neutral-500 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none"
                                                    required={isEmailSectionOpen}
                                                    disabled={isLoading}
                                                />
                                                <button
                                                    type="button"
                                                    tabIndex={-1}
                                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
                                                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                                                >
                                                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                </button>
                                            </div>
                                            {confirmPassword && (
                                                <div className="flex items-center gap-1.5 text-xs pt-0.5 animate-in fade-in-50 duration-200">
                                                    {password === confirmPassword ? (
                                                        <>
                                                            <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                                                            <span className="text-green-500 font-medium">Passwords match</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <X className="w-3.5 h-3.5 text-destructive shrink-0" />
                                                            <span className="text-destructive font-medium">Passwords do not match</span>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {/* Account creation captcha: Cloudflare Turnstile if configured, interactive fallback if unconfigured */}
                                        {hasTurnstileSiteKey() ? (
                                            <div className="flex justify-center my-2">
                                                <TurnstileWidget
                                                    action="signup"
                                                    onVerify={(token) => {
                                                        setCaptchaToken(token)
                                                        setError(null)
                                                    }}
                                                    onExpire={() => {
                                                        setCaptchaToken(null)
                                                    }}
                                                />
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-between p-3 rounded-xl border border-border/80 bg-muted/20 my-2 transition-colors">
                                                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                                                    <input
                                                        type="checkbox"
                                                        checked={Boolean(captchaToken)}
                                                        onChange={(e) => {
                                                            setCaptchaToken(e.target.checked ? 'dev-verified-token' : null)
                                                            setError(null)
                                                        }}
                                                        className="h-4 w-4 rounded border-border text-primary cursor-pointer accent-primary"
                                                        required={isEmailSectionOpen}
                                                    />
                                                    <span className="text-xs font-medium text-foreground">Verify you are human</span>
                                                </label>
                                                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground select-none">
                                                    <ShieldCheck className="w-3.5 h-3.5 text-primary/80" />
                                                    <span>Turnstile Captcha</span>
                                                </div>
                                            </div>
                                        )}

                                        {/* Streamlined legal agreement checkbox */}
                                        <label className="flex items-start gap-2.5 text-xs text-muted-foreground leading-relaxed cursor-pointer select-none py-1">
                                            <input
                                                type="checkbox"
                                                checked={legalAccepted}
                                                onChange={(event) => {
                                                    setLegalAccepted(event.target.checked)
                                                    setError(null)
                                                }}
                                                className="mt-0.5 h-3.5 w-3.5 rounded border-border text-primary focus-visible:ring-0 focus-visible:outline-none cursor-pointer"
                                                required={isEmailSectionOpen}
                                            />
                                            <span>
                                                I am at least 18 and agree to the{' '}
                                                <Link
                                                    className="font-medium text-foreground underline underline-offset-2 hover:text-primary transition-colors"
                                                    href="/terms"
                                                    target="_blank"
                                                >
                                                    Terms of Service
                                                </Link>{' '}
                                                and{' '}
                                                <Link
                                                    className="font-medium text-foreground underline underline-offset-2 hover:text-primary transition-colors"
                                                    href="/eula"
                                                    target="_blank"
                                                >
                                                    EULA
                                                </Link>
                                                . I have read the{' '}
                                                <Link
                                                    className="font-medium text-foreground underline underline-offset-2 hover:text-primary transition-colors"
                                                    href="/privacy"
                                                    target="_blank"
                                                >
                                                    Privacy Policy
                                                </Link>
                                                .
                                            </span>
                                        </label>
                                    </div>
                                </div>

                                {/* Create account button: glides down with fields in lockstep */}
                                <Button
                                    type="submit"
                                    className="w-full h-11 font-medium shadow-sm transition-transform duration-200 active:scale-[0.99]"
                                    disabled={isLoading}
                                >
                                    {isLoading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Creating account...
                                        </>
                                    ) : (
                                        'Create account'
                                    )}
                                </Button>
                            </form>
                        </>
                    )}

                    {/* Integrated Sign-in & Legal Section */}
                    <div className="mt-8 mb-4 pt-6 border-t border-border/40 text-center space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Already have an account?{' '}
                            <Link
                                href={loginHref}
                                className="text-primary font-medium hover:underline underline-offset-4"
                            >
                                Sign in
                            </Link>
                        </p>
                        <LegalLinks className="text-[11px] text-muted-foreground/80" />
                    </div>
                </div>
            </div>

            {/* Right Panel: Reusable Kinetic Ambient Canvas */}
            <AuthAmbientCanvas />
        </main>
    )
}

function SignupPageFallback() {
    return (
        <main className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2 bg-background text-foreground">
            <div className="flex flex-col justify-center items-center p-6 sm:p-10 lg:p-12 xl:p-16 w-full min-h-screen">
                <div className="w-full max-w-md my-auto space-y-4">
                    <div className="h-8 w-48 bg-muted rounded-md animate-pulse" />
                    <div className="h-4 w-64 bg-muted/60 rounded-md animate-pulse" />
                    <div className="grid grid-cols-2 gap-3 pt-4">
                        <div className="h-11 bg-muted/40 rounded-md animate-pulse" />
                        <div className="h-11 bg-muted/40 rounded-md animate-pulse" />
                    </div>
                    <div className="h-11 bg-muted/40 rounded-md animate-pulse mt-4" />
                </div>
            </div>
            <AuthAmbientCanvas />
        </main>
    )
}

export default function SignupPage() {
    return (
        <Suspense fallback={<SignupPageFallback />}>
            <SignupPageInner />
        </Suspense>
    )
}
