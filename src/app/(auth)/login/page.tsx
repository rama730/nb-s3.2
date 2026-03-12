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
import { Github, Mail, Loader2, Eye, EyeOff } from 'lucide-react'
import { buildAuthPageHref, resolveAuthRedirectPath } from '@/lib/auth/redirects'

const LOGIN_REQUEST_TIMEOUT_MS = 25_000

function LoginPageInner() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { signIn, signInWithGoogle, signInWithGitHub } = useAuth()
    const redirectPath = resolveAuthRedirectPath(searchParams.get('redirect'))
    const signupHref = buildAuthPageHref('/signup', redirectPath)

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const submitRequestIdRef = useRef(0)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        setIsLoading(true)
        const currentRequestId = ++submitRequestIdRef.current

        try {
            const result = await Promise.race([
                signIn(email, password),
                new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('LOGIN_TIMEOUT')), LOGIN_REQUEST_TIMEOUT_MS)
                }),
            ])

            if (currentRequestId !== submitRequestIdRef.current) return
            if (result.error) {
                setError(result.error.message)
            } else {
                router.push(redirectPath)
            }
        } catch (loginError) {
            if (currentRequestId !== submitRequestIdRef.current) return
            if (loginError instanceof Error && loginError.message === 'LOGIN_TIMEOUT') {
                setError('Sign in is taking too long. Please try again.')
            } else {
                setError('An unexpected error occurred')
            }
        } finally {
            if (currentRequestId === submitRequestIdRef.current) {
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
                    <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
                    <p className="text-muted-foreground">Sign in to your Edge account</p>
                </div>

                <Card className="border-0 shadow-xl bg-card/50 backdrop-blur-sm">
                    <CardHeader className="space-y-1 pb-4">
                        <CardTitle className="text-xl">Sign in</CardTitle>
                        <CardDescription>
                            Choose your preferred sign in method
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
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="password">Password</Label>
                                    <Link
                                        href="/forgot-password"
                                        className="text-sm text-primary hover:underline"
                                    >
                                        Forgot password?
                                    </Link>
                                </div>
                                <div className="relative">
                                    <Input
                                        id="password"
                                        type={showPassword ? 'text' : 'password'}
                                        placeholder="Enter your password"
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
                            </div>

                            <Button
                                type="submit"
                                className="w-full h-11"
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Signing in...
                                    </>
                                ) : (
                                    'Sign in'
                                )}
                            </Button>
                        </form>
                    </CardContent>

                    <CardFooter className="flex justify-center pb-6">
                        <p className="text-sm text-muted-foreground">
                            Don&apos;t have an account?{' '}
                            <Link href={signupHref} className="text-primary font-medium hover:underline">
                                Sign up
                            </Link>
                        </p>
                    </CardFooter>
                </Card>

                <p className="text-center text-xs text-muted-foreground">
                    By continuing, you agree to our{' '}
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

function LoginPageFallback() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
            <div className="w-full max-w-md">
                <Card className="border-0 shadow-xl bg-card/50 backdrop-blur-sm">
                    <CardHeader className="space-y-1 pb-4">
                        <CardTitle className="text-xl">Sign in</CardTitle>
                        <CardDescription>Loading authentication form...</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

export default function LoginPage() {
    return (
        <Suspense fallback={<LoginPageFallback />}>
            <LoginPageInner />
        </Suspense>
    )
}
