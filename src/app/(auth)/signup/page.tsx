'use client'

import { Suspense, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Github, Mail, Loader2, Eye, EyeOff, User, Check, X } from 'lucide-react'
import { buildAuthPageHref, resolveAuthRedirectPath } from '@/lib/auth/redirects'

function SignupPageInner() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { signUp, signInWithGoogle, signInWithGitHub } = useAuth()
    const redirectPath = resolveAuthRedirectPath(searchParams.get('redirect'))
    const loginHref = buildAuthPageHref('/login', redirectPath)

    const [fullName, setFullName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)
    const submitRequestIdRef = useRef(0)

    const DUPLICATE_EMAIL_MESSAGE = 'This email has already been used to create an account'

    const toErrorMessage = (authError: unknown): string => {
        if (!authError) return 'Unable to create account'
        const raw = typeof authError === 'object' && authError !== null && 'message' in authError
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
    const passwordChecks = {
        length: password.length >= 8,
        uppercase: /[A-Z]/.test(password),
        lowercase: /[a-z]/.test(password),
        number: /[0-9]/.test(password),
    }
    const passwordStrength = Object.values(passwordChecks).filter(Boolean).length

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        setSuccess(null)

        if (passwordStrength < 3) {
            setError('Please create a stronger password')
            return
        }

        const requestId = ++submitRequestIdRef.current
        setIsLoading(true)

        try {
            const signUpResult = await Promise.race([
                signUp(email.trim(), password, fullName.trim()),
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
                router.push(redirectPath)
                return
            }

            if (data?.user) {
                setSuccess('Account created. Please check your email and verify your account before signing in.')
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

    const handleGoogleSignIn = async () => {
        setError(null)
        const { error } = await signInWithGoogle(redirectPath)
        if (error) {
            setError(error.message)
        }
    }

    const handleGitHubSignIn = async () => {
        setError(null)
        const { error } = await signInWithGitHub(redirectPath)
        if (error) {
            setError(error.message)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
            <div className="w-full max-w-md space-y-6">
                {/* Logo/Brand */}
                <div className="text-center space-y-2">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-primary-foreground font-bold text-xl">
                        E
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight">Create an account</h1>
                    <p className="text-muted-foreground">Join Edge and start building your network</p>
                </div>

                <Card className="border-0 shadow-xl bg-card/50 backdrop-blur-sm">
                    <CardHeader className="space-y-1 pb-4">
                        <CardTitle className="text-xl">Sign up</CardTitle>
                        <CardDescription>
                            Choose your preferred sign up method
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-4">
                        {/* Social Auth */}
                        <div className="grid grid-cols-2 gap-3">
                            <Button
                                variant="outline"
                                className="h-11"
                                onClick={handleGoogleSignIn}
                                disabled={isLoading}
                            >
                                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                                    <path
                                        fill="currentColor"
                                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                    />
                                    <path
                                        fill="currentColor"
                                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                    />
                                    <path
                                        fill="currentColor"
                                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                    />
                                    <path
                                        fill="currentColor"
                                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                    />
                                </svg>
                                Google
                            </Button>
                            <Button
                                variant="outline"
                                className="h-11"
                                onClick={handleGitHubSignIn}
                                disabled={isLoading}
                            >
                                <Github className="w-5 h-5 mr-2" />
                                GitHub
                            </Button>
                        </div>

                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <Separator className="w-full" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-card px-2 text-muted-foreground">
                                    or continue with email
                                </span>
                            </div>
                        </div>

                        {/* Email Form */}
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {error && (
                                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                                    {error}
                                </div>
                            )}
                            {success && (
                                <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-sm">
                                    {success}
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label htmlFor="fullName">Full Name</Label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    <Input
                                        id="fullName"
                                        type="text"
                                        placeholder="John Doe"
                                        value={fullName}
                                        onChange={(e) => setFullName(e.target.value)}
                                        className="pl-10 h-11"
                                        required
                                        disabled={isLoading}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="name@example.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="pl-10 h-11"
                                        required
                                        disabled={isLoading}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="password">Password</Label>
                                <div className="relative">
                                    <Input
                                        id="password"
                                        type={showPassword ? 'text' : 'password'}
                                        placeholder="Create a strong password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="pr-10 h-11"
                                        required
                                        disabled={isLoading}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    >
                                        {showPassword ? (
                                            <EyeOff className="w-4 h-4" />
                                        ) : (
                                            <Eye className="w-4 h-4" />
                                        )}
                                    </button>
                                </div>

                                {/* Password strength indicator */}
                                {password && (
                                    <div className="space-y-2 pt-2">
                                        <div className="flex gap-1">
                                            {[1, 2, 3, 4].map((level) => (
                                                <div
                                                    key={level}
                                                    className={`h-1 flex-1 rounded-full transition-colors ${passwordStrength >= level
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
                                                { check: passwordChecks.length, label: '8+ characters' },
                                                { check: passwordChecks.uppercase, label: 'Uppercase' },
                                                { check: passwordChecks.lowercase, label: 'Lowercase' },
                                                { check: passwordChecks.number, label: 'Number' },
                                            ].map(({ check, label }) => (
                                                <div key={label} className="flex items-center gap-1">
                                                    {check ? (
                                                        <Check className="w-3 h-3 text-green-500" />
                                                    ) : (
                                                        <X className="w-3 h-3 text-muted-foreground" />
                                                    )}
                                                    <span className={check ? 'text-green-500' : 'text-muted-foreground'}>
                                                        {label}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <Button
                                type="submit"
                                className="w-full h-11"
                                disabled={isLoading || passwordStrength < 3}
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
                    </CardContent>

                    <CardFooter className="flex justify-center pb-6">
                        <p className="text-sm text-muted-foreground">
                            Already have an account?{' '}
                            <Link href={loginHref} className="text-primary font-medium hover:underline">
                                Sign in
                            </Link>
                        </p>
                    </CardFooter>
                </Card>

                <p className="text-center text-xs text-muted-foreground">
                    By creating an account, you agree to our{' '}
                    <Link href="/terms" className="underline hover:text-foreground">
                        Terms of Service
                    </Link>{' '}
                    and{' '}
                    <Link href="/privacy" className="underline hover:text-foreground">
                        Privacy Policy
                    </Link>
                </p>
            </div>
        </div>
    )
}

function SignupPageFallback() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
            <div className="w-full max-w-md">
                <Card className="border-0 shadow-xl bg-card/50 backdrop-blur-sm">
                    <CardHeader className="space-y-1 pb-4">
                        <CardTitle className="text-xl">Sign up</CardTitle>
                        <CardDescription>Loading account creation form...</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

export default function SignupPage() {
    return (
        <Suspense fallback={<SignupPageFallback />}>
            <SignupPageInner />
        </Suspense>
    )
}
