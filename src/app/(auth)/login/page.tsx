'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import TurnstileWidget, { hasTurnstileSiteKey } from '@/components/auth/TurnstileWidget'
import { GoogleOneTap } from '@/components/auth/GoogleOneTap'
import { AuthAmbientCanvas } from '@/components/auth/AuthAmbientCanvas'
import { Github, Loader2, Eye, EyeOff, AlertCircle, Check, X, ShieldCheck } from 'lucide-react'
import { buildAuthPageHref, resolveAuthRedirectPath } from '@/lib/auth/redirects'
import { resolveAuthPageErrorMessage } from '@/lib/auth/error-messages'
import { getPasswordPolicyResult, PASSWORD_MIN_LENGTH } from '@/lib/security/password-policy'
import { LegalLinks } from '@/components/legal/LegalLinks'
import { isDisposableEmail } from '@/lib/validations/disposable-email'

const LOGIN_REQUEST_TIMEOUT_MS = 25_000
const SIGNUP_REQUEST_TIMEOUT_MS = 15_000
const DUPLICATE_EMAIL_MESSAGE = 'This email has already been used to create an account'

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

function toSignupErrorMessage(authError: unknown): string {
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

function isDuplicateObfuscatedResponse(payload: unknown): boolean {
    const data = (payload as { data?: { user?: { identities?: unknown[] } } } | null)?.data
    const identities = data?.user?.identities
    return Array.isArray(identities) && identities.length === 0
}

function LoginPageInner() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { signIn, signUp, signInWithGoogle, signInWithGitHub } = useAuth()
    const redirectPath = resolveAuthRedirectPath(searchParams.get('redirect'))
    const searchErrorCode = searchParams.get('error')
    const signupHref = buildAuthPageHref('/signup', redirectPath)
    const loginHref = buildAuthPageHref('/login', redirectPath)

    // Interactive Mode State ('signin' ⟷ 'signup')
    const initialMode = searchParams.get('mode') === 'signup' ? 'signup' : 'signin'
    const [mode, setMode] = useState<'signin' | 'signup'>(initialMode)
    const isSignUp = mode === 'signup'

    // Sign In State
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [showEmailFields, setShowEmailFields] = useState(false)
    const [isSignInLoading, setIsSignInLoading] = useState(false)
    const [oauthProviderLoading, setOauthProviderLoading] = useState<'google' | 'github' | null>(null)
    const [signInError, setSignInError] = useState<string | null>(null)
    const [dismissedSearchErrorCode, setDismissedSearchErrorCode] = useState<string | null>(null)
    const [signInCaptchaToken, setSignInCaptchaToken] = useState<string | null>(null)
    const signInSubmitRequestIdRef = useRef(0)
    const emailInputRef = useRef<HTMLInputElement | null>(null)

    // Sign Up State
    const [signUpFullName, setSignUpFullName] = useState('')
    const [signUpEmail, setSignUpEmail] = useState('')
    const [signUpPassword, setSignUpPassword] = useState('')
    const [signUpConfirmPassword, setSignUpConfirmPassword] = useState('')
    const [signUpShowPassword, setSignUpShowPassword] = useState(false)
    const [showSignUpConfirmPassword, setShowSignUpConfirmPassword] = useState(false)
    const [isSignUpLoading, setIsSignUpLoading] = useState(false)
    const [signUpError, setSignUpError] = useState<string | null>(null)
    const [signUpSuccess, setSignUpSuccess] = useState<string | null>(null)
    const [signUpCaptchaToken, setSignUpCaptchaToken] = useState<string | null>(null)
    const [signUpLegalAccepted, setSignUpLegalAccepted] = useState(false)
    const [signUpHoneypot, setSignUpHoneypot] = useState('')
    const signUpSubmitRequestIdRef = useRef(0)

    const isSignUpDisposable = isDisposableEmail(signUpEmail)

    const requiresCaptcha = hasTurnstileSiteKey()
    const queryError =
        searchErrorCode && dismissedSearchErrorCode !== searchErrorCode
            ? resolveAuthPageErrorMessage(searchErrorCode)
            : null
    const displaySignInError = signInError ?? queryError
    const isSignInBusy = isSignInLoading || oauthProviderLoading !== null
    const isEmailSectionOpen = showEmailFields || Boolean(displaySignInError) || Boolean(email)

    // Real-time password policy for sign-up
    const signUpPasswordPolicy = getPasswordPolicyResult(signUpPassword)
    const signUpPasswordChecks = signUpPasswordPolicy.checks
    const signUpPasswordStrength = signUpPasswordPolicy.score

    // Sync browser history state
    useEffect(() => {
        const handlePopState = () => {
            if (window.location.pathname === '/signup') {
                setMode('signup')
            } else if (window.location.pathname === '/login') {
                setMode('signin')
            }
        }
        window.addEventListener('popstate', handlePopState)
        return () => window.removeEventListener('popstate', handlePopState)
    }, [])

    useEffect(() => {
        setDismissedSearchErrorCode(null)
    }, [searchErrorCode])

    // Smooth field-focused mode switching
    const handleSwitchToSignUp = () => {
        setSignInError(null)
        setSignUpError(null)
        setShowEmailFields(true)
        setMode('signup')
        if (typeof window !== 'undefined') {
            window.history.pushState(null, '', signupHref)
        }
    }

    const handleSwitchToSignIn = () => {
        setSignInError(null)
        setSignUpError(null)
        setMode('signin')
        if (typeof window !== 'undefined') {
            window.history.pushState(null, '', loginHref)
        }
    }

    const clearSignInError = () => {
        setSignInError(null)
        if (searchErrorCode) {
            setDismissedSearchErrorCode(searchErrorCode)
        }
    }

    // Sign In Submission
    const handleSignInSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        clearSignInError()

        if (!isEmailSectionOpen) {
            setShowEmailFields(true)
            setTimeout(() => {
                emailInputRef.current?.focus({ preventScroll: true })
            }, 50)
            return
        }

        if (requiresCaptcha && !signInCaptchaToken) {
            setSignInError('Please complete the Turnstile check')
            return
        }
        setIsSignInLoading(true)
        const currentRequestId = ++signInSubmitRequestIdRef.current

        try {
            const result = await Promise.race([
                signIn(email, password, signInCaptchaToken || undefined),
                new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('LOGIN_TIMEOUT')), LOGIN_REQUEST_TIMEOUT_MS)
                }),
            ])

            if (currentRequestId !== signInSubmitRequestIdRef.current) return
            if (result.error) {
                setSignInError(result.error.message)
            } else {
                router.push(redirectPath)
            }
        } catch (loginError) {
            if (currentRequestId !== signInSubmitRequestIdRef.current) return
            if (loginError instanceof Error && loginError.message === 'LOGIN_TIMEOUT') {
                setSignInError('Sign in is taking too long. Please try again.')
            } else {
                setSignInError('An unexpected error occurred')
            }
        } finally {
            if (currentRequestId === signInSubmitRequestIdRef.current) {
                setIsSignInLoading(false)
            }
        }
    }

    // Sign Up Submission
    const handleSignUpSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSignUpError(null)
        setSignUpSuccess(null)

        if (isSignUpDisposable) {
            setSignUpError('Disposable or temporary email addresses are not permitted. Please use a permanent email.')
            return
        }

        if (!signUpPasswordPolicy.ok) {
            setSignUpError(signUpPasswordPolicy.error || 'Please create a stronger password')
            return
        }

        if (signUpPassword !== signUpConfirmPassword) {
            setSignUpError('Passwords do not match')
            return
        }

        if (!signUpCaptchaToken) {
            setSignUpError('Please complete the human verification check')
            return
        }

        if (!signUpLegalAccepted) {
            setSignUpError('Please accept the Terms of Service and EULA to create an account')
            return
        }

        const requestId = ++signUpSubmitRequestIdRef.current
        setIsSignUpLoading(true)

        try {
            const signUpResult = await Promise.race([
                signUp(
                    signUpEmail.trim(),
                    signUpPassword,
                    signUpFullName.trim(),
                    signUpCaptchaToken || undefined,
                    signUpLegalAccepted,
                    {
                        website_hp: signUpHoneypot || undefined,
                    }
                ),
                new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('Request timeout')), SIGNUP_REQUEST_TIMEOUT_MS)
                }),
            ])

            if (requestId !== signUpSubmitRequestIdRef.current) return

            if (isDuplicateObfuscatedResponse(signUpResult)) {
                setSignUpError(DUPLICATE_EMAIL_MESSAGE)
                return
            }

            const authError = (signUpResult as { error?: unknown } | null)?.error
            if (authError) {
                setSignUpError(toSignupErrorMessage(authError))
                return
            }

            const data = (signUpResult as { data?: { session?: unknown; user?: unknown } } | null)?.data
            if (data?.session) {
                router.push(redirectPath)
                return
            }

            if (data?.user) {
                setSignUpSuccess('Account created. Please check your email and verify your account before signing in.')
                return
            }

            setSignUpError('Unable to create account. Please try again.')
        } catch (error_) {
            if (requestId !== signUpSubmitRequestIdRef.current) return
            if (error_ instanceof Error && error_.message === 'Request timeout') {
                setSignUpError('Signup is taking too long. Please try again.')
            } else {
                setSignUpError('An unexpected error occurred')
            }
        } finally {
            if (requestId === signUpSubmitRequestIdRef.current) {
                setIsSignUpLoading(false)
            }
        }
    }

    // OAuth Handlers
    const handleGoogleSignIn = async () => {
        clearSignInError()
        setOauthProviderLoading('google')
        try {
            const legalNext = `/legal/accept?context=oauth_signup&next=${encodeURIComponent(redirectPath)}`
            const { error: oauthErr } = await signInWithGoogle(legalNext)
            if (oauthErr) {
                setSignInError(oauthErr.message)
                setOauthProviderLoading(null)
            }
        } catch {
            setSignInError('Unable to start Google sign-in. Please try again.')
            setOauthProviderLoading(null)
        }
    }

    const handleGitHubSignIn = async () => {
        clearSignInError()
        setOauthProviderLoading('github')
        try {
            const legalNext = `/legal/accept?context=oauth_signup&next=${encodeURIComponent(redirectPath)}`
            const { error: oauthErr } = await signInWithGitHub(legalNext)
            if (oauthErr) {
                setSignInError(oauthErr.message)
                setOauthProviderLoading(null)
            }
        } catch {
            setSignInError('Unable to start GitHub sign-in. Please try again.')
            setOauthProviderLoading(null)
        }
    }

    const handleSignUpGoogle = async () => {
        setSignUpError(null)
        const legalNext = `/legal/accept?context=oauth_signup&next=${encodeURIComponent(redirectPath)}`
        const { error: oauthErr } = await signInWithGoogle(legalNext)
        if (oauthErr) {
            setSignUpError(oauthErr.message)
        }
    }

    const handleSignUpGitHub = async () => {
        setSignUpError(null)
        const legalNext = `/legal/accept?context=oauth_signup&next=${encodeURIComponent(redirectPath)}`
        const { error: oauthErr } = await signInWithGitHub(legalNext)
        if (oauthErr) {
            setSignUpError(oauthErr.message)
        }
    }

    return (
        <main className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2 bg-background text-foreground">
            <GoogleOneTap nextPath={redirectPath} onError={setSignInError} />
            {/* Left Panel: Clean Interactive Authentication View */}
            <div className="flex flex-col justify-center items-center py-8 sm:py-12 px-6 sm:px-10 lg:px-12 xl:p-16 w-full min-h-screen">
                <div className="w-full max-w-md my-auto sm:mt-2 transition-all duration-300 ease-out">

                    {/* 1. Anchored Title Header (Smooth in-place text update) */}
                    <div className="space-y-1.5 mb-6">
                        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight transition-opacity duration-200">
                            {isSignUp ? 'Create an account' : 'Welcome back'}
                        </h1>
                        <p className="text-sm text-muted-foreground transition-opacity duration-200">
                            {isSignUp
                                ? 'Join NetworkBase and build with your network'
                                : 'Sign in to your NetworkBase account'}
                        </p>
                    </div>

                    {/* 2. Anchored Social Auth Buttons (Fixed at top, never shifts away) */}
                    <div className="grid grid-cols-2 gap-3 mb-6">
                        <Button
                            type="button"
                            variant="outline"
                            className="h-11 w-full font-medium border-border/80 hover:bg-muted/50 transition-colors"
                            onClick={isSignUp ? handleSignUpGoogle : handleGoogleSignIn}
                            disabled={isSignInBusy || (isSignUp && isSignUpLoading) || oauthProviderLoading !== null}
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
                            onClick={isSignUp ? handleSignUpGitHub : handleGitHubSignIn}
                            disabled={isSignInBusy || (isSignUp && isSignUpLoading) || oauthProviderLoading !== null}
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

                    {/* 3. Anchored Divider (Evenly spaced between social and email fields) */}
                    <div className="relative mb-6">
                        <div className="absolute inset-0 flex items-center">
                            <hr className="w-full border-border/60" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            {isSignUp ? (
                                <span className="bg-background px-3 text-muted-foreground font-medium text-[11px] tracking-wider">
                                    or register with email
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowEmailFields(true)
                                        setTimeout(() => emailInputRef.current?.focus({ preventScroll: true }), 50)
                                    }}
                                    className="bg-background px-3 text-muted-foreground hover:text-foreground font-medium text-[11px] tracking-wider transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-0 rounded py-0.5"
                                >
                                    Continue with email
                                </button>
                            )}
                        </div>
                    </div>

                    {/* 4. Cohesive Form Container: Natural layout flow, zero lag or clipping */}
                    <div className="relative w-full overflow-hidden">
                        {/* Slide 1: Sign In View (Natural flow when active; password field glides left on sign-up) */}
                        <div
                            inert={isSignUp ? true : undefined}
                            className={`w-full transition-all duration-400 ease-in-out ${
                                isSignUp
                                    ? 'absolute top-0 left-0 -translate-x-full opacity-0 pointer-events-none'
                                    : 'relative translate-x-0 opacity-100'
                            }`}
                        >
                            <form onSubmit={handleSignInSubmit} className="w-full">
                                {displaySignInError && (
                                    <div
                                        role="alert"
                                        className="mb-5 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2.5 animate-in fade-in-50 duration-200"
                                    >
                                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                        <span>{displaySignInError}</span>
                                    </div>
                                )}

                                {/* Smooth Progressive Expansion: Mail and Password expand, pushing button in lockstep */}
                                <div
                                    className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                                        isEmailSectionOpen
                                            ? 'grid-rows-[1fr] opacity-100 mb-6'
                                            : 'grid-rows-[0fr] opacity-0 mb-0 pointer-events-none'
                                    }`}
                                >
                                    <div className="overflow-hidden space-y-4 pt-1">
                                        <div className="space-y-1.5">
                                            <label
                                                htmlFor="email"
                                                className="text-sm font-medium leading-none text-foreground"
                                            >
                                                Email
                                            </label>
                                            <Input
                                                ref={emailInputRef}
                                                id="email"
                                                type="email"
                                                autoComplete="username email"
                                                placeholder="you@example.com"
                                                value={email}
                                                onChange={(e) => {
                                                    clearSignInError()
                                                    setEmail(e.target.value)
                                                }}
                                                className="h-11 border-border/80 bg-background focus-visible:border-neutral-400 dark:focus-visible:border-neutral-500 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none"
                                                required={isEmailSectionOpen && !isSignUp}
                                                disabled={isSignInBusy}
                                            />
                                        </div>

                                        <div className="space-y-1.5">
                                            <div className="flex items-center justify-between">
                                                <label
                                                    htmlFor="password"
                                                    className="text-sm font-medium leading-none text-foreground"
                                                >
                                                    Password
                                                </label>
                                                <Link
                                                    href="/forgot-password"
                                                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                                                >
                                                    Forgot password?
                                                </Link>
                                            </div>
                                            <div className="relative">
                                                <Input
                                                    id="password"
                                                    type={showPassword ? 'text' : 'password'}
                                                    autoComplete="current-password"
                                                    placeholder="Enter your password"
                                                    value={password}
                                                    onChange={(e) => {
                                                        clearSignInError()
                                                        setPassword(e.target.value)
                                                    }}
                                                    className="pr-10 h-11 border-border/80 bg-background focus-visible:border-neutral-400 dark:focus-visible:border-neutral-500 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none"
                                                    required={isEmailSectionOpen && !isSignUp}
                                                    disabled={isSignInBusy}
                                                />
                                                <button
                                                    type="button"
                                                    tabIndex={-1}
                                                    onClick={() => setShowPassword(!showPassword)}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
                                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                                >
                                                    {showPassword ? (
                                                        <EyeOff className="w-4 h-4" />
                                                    ) : (
                                                        <Eye className="w-4 h-4" />
                                                    )}
                                                </button>
                                            </div>
                                        </div>

                                        {requiresCaptcha ? (
                                            <div className="flex justify-center my-2">
                                                <TurnstileWidget
                                                    action="login"
                                                    onVerify={(token) => {
                                                        setSignInCaptchaToken(token)
                                                        clearSignInError()
                                                    }}
                                                    onExpire={() => {
                                                        setSignInCaptchaToken(null)
                                                    }}
                                                    onError={() => {
                                                        setSignInCaptchaToken(null)
                                                        clearSignInError()
                                                        setSignInError(
                                                            'CAPTCHA failed to load — please try again or disable ad blockers.'
                                                        )
                                                    }}
                                                />
                                            </div>
                                        ) : null}
                                    </div>
                                </div>

                                {/* Sign In Button: Perfectly aligned, glides down with fields in lockstep */}
                                <Button
                                    type="submit"
                                    className="w-full h-11 font-medium shadow-sm transition-transform duration-200 active:scale-[0.99]"
                                    disabled={isSignInBusy}
                                >
                                    {isSignInLoading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Signing in...
                                        </>
                                    ) : (
                                        'Sign in'
                                    )}
                                </Button>
                            </form>
                        </div>

                        {/* Slide 2: Sign Up View (Slides smoothly in from the right when Sign Up is clicked) */}
                        <div
                            inert={!isSignUp ? true : undefined}
                            className={`w-full transition-all duration-400 ease-in-out ${
                                isSignUp
                                    ? 'relative translate-x-0 opacity-100'
                                    : 'absolute top-0 left-0 translate-x-full opacity-0 pointer-events-none'
                            }`}
                        >
                            <form onSubmit={handleSignUpSubmit} className="space-y-4">
                                {/* Invisible Honeypot Field */}
                                <input
                                    type="text"
                                    name="website_hp"
                                    value={signUpHoneypot}
                                    onChange={(e) => setSignUpHoneypot(e.target.value)}
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
                                {signUpError && (
                                    <div
                                        role="alert"
                                        className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2.5 animate-in fade-in-50 duration-200"
                                    >
                                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                        <span>{signUpError}</span>
                                    </div>
                                )}

                                {signUpSuccess && (
                                    <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-200 text-sm flex items-start gap-2.5 animate-in fade-in-50 duration-200">
                                        <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                                        <span>{signUpSuccess}</span>
                                    </div>
                                )}

                                <div className="space-y-1.5">
                                    <label
                                        htmlFor="signup-fullName"
                                        className="text-sm font-medium leading-none text-foreground"
                                    >
                                        Full Name
                                    </label>
                                    <Input
                                        id="signup-fullName"
                                        type="text"
                                        autoComplete="name"
                                        placeholder="Your full name"
                                        value={signUpFullName}
                                        onChange={(e) => {
                                            setSignUpError(null)
                                            setSignUpFullName(e.target.value)
                                        }}
                                        className="h-11 border-border/80 bg-background focus-visible:border-neutral-400 dark:focus-visible:border-neutral-500 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none"
                                        required={isSignUp}
                                        disabled={isSignUpLoading}
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <label
                                        htmlFor="signup-email"
                                        className="text-sm font-medium leading-none text-foreground"
                                    >
                                        Email
                                    </label>
                                    <Input
                                        id="signup-email"
                                        type="email"
                                        autoComplete="username email"
                                        placeholder="name@example.com"
                                        value={signUpEmail}
                                        onChange={(e) => {
                                            setSignUpError(null)
                                            setSignUpEmail(e.target.value)
                                        }}
                                        className="h-11 border-border/80 bg-background focus-visible:border-neutral-400 dark:focus-visible:border-neutral-500 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none"
                                        required={isSignUp}
                                        disabled={isSignUpLoading}
                                    />
                                    {/* Disposable Email Warning */}
                                    {isSignUpDisposable && (
                                        <div className="flex items-center gap-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-200 animate-in fade-in-50 duration-200">
                                            <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                                            <span>Please use a permanent email address (disposable emails are not permitted).</span>
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-1.5">
                                    <label
                                        htmlFor="signup-password"
                                        className="text-sm font-medium leading-none text-foreground"
                                    >
                                        Password
                                    </label>
                                    <div className="relative">
                                        <Input
                                            id="signup-password"
                                            type={signUpShowPassword ? 'text' : 'password'}
                                            autoComplete="new-password"
                                            placeholder="Create a strong password"
                                            value={signUpPassword}
                                            onChange={(e) => {
                                                setSignUpError(null)
                                                setSignUpPassword(e.target.value)
                                            }}
                                            className="pr-10 h-11 border-border/80 bg-background focus-visible:border-neutral-400 dark:focus-visible:border-neutral-500 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none"
                                            required={isSignUp}
                                            disabled={isSignUpLoading}
                                        />
                                        <button
                                            type="button"
                                            tabIndex={-1}
                                            onClick={() => setSignUpShowPassword(!signUpShowPassword)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
                                            aria-label={signUpShowPassword ? 'Hide password' : 'Show password'}
                                        >
                                            {signUpShowPassword ? (
                                                <EyeOff className="w-4 h-4" />
                                            ) : (
                                                <Eye className="w-4 h-4" />
                                            )}
                                        </button>
                                    </div>

                                    {/* Password Strength Indicator */}
                                    {signUpPassword && (
                                        <div className="space-y-2 pt-2 animate-in fade-in-50 duration-200">
                                            <div className="flex gap-1">
                                                {[1, 2, 3, 4].map((level) => (
                                                    <div
                                                        key={level}
                                                        className={`h-1 flex-1 rounded-full transition-colors ${
                                                            Math.min(signUpPasswordStrength, 4) >= level
                                                                ? signUpPasswordStrength >= 3
                                                                    ? 'bg-green-500'
                                                                    : signUpPasswordStrength >= 2
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
                                                        check: signUpPasswordChecks.minLength,
                                                        label: `${PASSWORD_MIN_LENGTH}+ characters`,
                                                    },
                                                    {
                                                        check: signUpPasswordChecks.uppercase,
                                                        label: 'Uppercase',
                                                    },
                                                    {
                                                        check: signUpPasswordChecks.lowercase,
                                                        label: 'Lowercase',
                                                    },
                                                    {
                                                        check: signUpPasswordChecks.number,
                                                        label: 'Number',
                                                    },
                                                    {
                                                        check: signUpPasswordChecks.symbol,
                                                        label: 'Symbol (recommended)',
                                                    },
                                                ].map(({ check, label }) => (
                                                    <div key={label} className="flex items-center gap-1">
                                                        {check ? (
                                                            <Check className="w-3 h-3 text-green-500" />
                                                        ) : (
                                                            <X className="w-3 h-3 text-muted-foreground" />
                                                        )}
                                                        <span
                                                            className={
                                                                check
                                                                    ? 'text-green-500'
                                                                    : 'text-muted-foreground'
                                                            }
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
                                    <label
                                        htmlFor="signup-confirm-password"
                                        className="text-sm font-medium leading-none text-foreground"
                                    >
                                        Confirm Password
                                    </label>
                                    <div className="relative">
                                        <Input
                                            id="signup-confirm-password"
                                            type={showSignUpConfirmPassword ? 'text' : 'password'}
                                            autoComplete="new-password"
                                            placeholder="Re-enter your password"
                                            value={signUpConfirmPassword}
                                            onChange={(e) => {
                                                setSignUpError(null)
                                                setSignUpConfirmPassword(e.target.value)
                                            }}
                                            className="pr-10 h-11 border-border/80 bg-background focus-visible:border-neutral-400 dark:focus-visible:border-neutral-500 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none"
                                            required={isSignUp}
                                            disabled={isSignUpLoading}
                                        />
                                        <button
                                            type="button"
                                            tabIndex={-1}
                                            onClick={() => setShowSignUpConfirmPassword(!showSignUpConfirmPassword)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
                                            aria-label={showSignUpConfirmPassword ? 'Hide password' : 'Show password'}
                                        >
                                            {showSignUpConfirmPassword ? (
                                                <EyeOff className="w-4 h-4" />
                                            ) : (
                                                <Eye className="w-4 h-4" />
                                            )}
                                        </button>
                                    </div>
                                    {signUpConfirmPassword && (
                                        <div className="flex items-center gap-1.5 text-xs pt-0.5 animate-in fade-in-50 duration-200">
                                            {signUpPassword === signUpConfirmPassword ? (
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
                                                setSignUpCaptchaToken(token)
                                                setSignUpError(null)
                                            }}
                                            onExpire={() => setSignUpCaptchaToken(null)}
                                        />
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between p-3 rounded-xl border border-border/80 bg-muted/20 my-2 transition-colors">
                                        <label className="flex items-center gap-2.5 cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={Boolean(signUpCaptchaToken)}
                                                onChange={(e) => {
                                                    setSignUpCaptchaToken(e.target.checked ? 'dev-verified-token' : null)
                                                    setSignUpError(null)
                                                }}
                                                className="h-4 w-4 rounded border-border text-primary cursor-pointer accent-primary"
                                                required={isSignUp}
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
                                        checked={signUpLegalAccepted}
                                        onChange={(event) => {
                                            setSignUpLegalAccepted(event.target.checked)
                                            setSignUpError(null)
                                        }}
                                        className="mt-0.5 h-3.5 w-3.5 rounded border-border text-primary focus-visible:ring-0 focus-visible:outline-none cursor-pointer"
                                        required={isSignUp}
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

                                <Button
                                    type="submit"
                                    className="w-full h-11 font-medium shadow-sm transition-all duration-300"
                                    disabled={
                                        isSignUpLoading ||
                                        !signUpPasswordPolicy.ok ||
                                        !signUpLegalAccepted
                                    }
                                >
                                    {isSignUpLoading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Creating account...
                                        </>
                                    ) : (
                                        'Create account'
                                    )}
                                </Button>
                            </form>
                        </div>
                    </div>

                    {/* 5. Anchored Footer: Seamlessly glides down in lockstep with the fields */}
                    <div className="mt-7 pt-5 border-t border-border/40 text-center space-y-3.5 transition-all duration-300 ease-out">
                        <p className="text-sm text-muted-foreground">
                            {isSignUp ? (
                                <>
                                    Already have an account?{' '}
                                    <button
                                        type="button"
                                        onClick={handleSwitchToSignIn}
                                        className="text-primary font-medium hover:underline underline-offset-4 cursor-pointer focus-visible:outline-none focus-visible:ring-0 rounded"
                                    >
                                        Sign in
                                    </button>
                                </>
                            ) : (
                                <>
                                    Don&apos;t have an account?{' '}
                                    <button
                                        type="button"
                                        onClick={handleSwitchToSignUp}
                                        className="text-primary font-medium hover:underline underline-offset-4 cursor-pointer focus-visible:outline-none focus-visible:ring-0 rounded"
                                    >
                                        Sign up
                                    </button>
                                </>
                            )}
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

function LoginPageFallback() {
    return (
        <main className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2 bg-background text-foreground">
            <div className="flex flex-col justify-center items-center p-6 sm:p-10 lg:p-12 xl:p-16 w-full min-h-screen">
                <div className="w-full max-w-md -mt-6 sm:-mt-10 space-y-4">
                    <div className="h-8 w-48 bg-muted rounded-md animate-pulse" />
                    <div className="h-4 w-64 bg-muted/60 rounded-md animate-pulse" />
                    <div className="grid grid-cols-2 gap-3 pt-4">
                        <div className="h-11 bg-muted/40 rounded-md animate-pulse" />
                        <div className="h-11 bg-muted/40 rounded-md animate-pulse" />
                    </div>
                    <div className="h-11 bg-muted/40 rounded-md animate-pulse mt-4" />
                    <div className="h-11 bg-muted/40 rounded-md animate-pulse" />
                    <div className="h-11 bg-muted/60 rounded-md animate-pulse" />
                </div>
            </div>
            <AuthAmbientCanvas />
        </main>
    )
}

export default function LoginPage() {
    return (
        <Suspense fallback={<LoginPageFallback />}>
            <LoginPageInner />
        </Suspense>
    )
}
