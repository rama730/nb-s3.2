'use client'

import Link from 'next/link'
import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import TurnstileWidget, { hasTurnstileSiteKey } from '@/components/auth/TurnstileWidget'
import { AuthAmbientCanvas } from '@/components/auth/AuthAmbientCanvas'
import { buildOAuthRedirectTo, resolveAuthBaseUrl } from '@/lib/auth/redirects'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { LegalLinks } from '@/components/legal/LegalLinks'

export default function ForgotPasswordPage() {
    const supabase = useMemo(() => createSupabaseBrowserClient(), [])
    const [email, setEmail] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [sent, setSent] = useState(false)
    const [captchaToken, setCaptchaToken] = useState<string | null>(null)
    const requiresCaptcha = hasTurnstileSiteKey()

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault()
        setError(null)

        if (requiresCaptcha && !captchaToken) {
            setError('Please complete the Turnstile check.')
            return
        }

        setIsSubmitting(true)
        try {
            const redirectTo = buildOAuthRedirectTo(
                resolveAuthBaseUrl({
                    browserOrigin: typeof window !== 'undefined' ? window.location.origin : null,
                }),
                '/reset-password'
            )

            const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
                redirectTo,
                captchaToken: captchaToken || undefined,
            })

            if (resetError) {
                throw resetError
            }

            setSent(true)
        } catch (submitError) {
            setCaptchaToken(null)
            setError(submitError instanceof Error ? submitError.message : 'Unable to send reset email.')
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <main className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2 bg-background text-foreground">
            {/* Left Panel: Clean Interactive Password Recovery Form */}
            <div className="flex flex-col justify-center items-center py-8 sm:py-12 px-6 sm:px-10 lg:px-12 xl:p-16 w-full min-h-screen">
                <div className="w-full max-w-md my-auto sm:mt-2 transition-all duration-500 ease-out">
                    {/* Title Header */}
                    <div className="space-y-1.5 mb-8">
                        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                            Reset your password
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            We will send a secure recovery link to your email.
                        </p>
                    </div>

                    {sent ? (
                        <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-sm text-emerald-800 dark:text-emerald-200 flex items-start gap-3 animate-in fade-in-50 duration-300">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <p className="font-medium">Reset link sent</p>
                                <p className="text-emerald-700/90 dark:text-emerald-300/90 text-xs leading-relaxed">
                                    If an account matches <span className="font-semibold">{email}</span>, you will receive an email shortly with recovery instructions. Please check your inbox and spam folder.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {error && (
                                <div
                                    role="alert"
                                    className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2.5 animate-in fade-in-50 duration-200"
                                >
                                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                    <span>{error}</span>
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <label
                                    htmlFor="email"
                                    className="text-sm font-medium leading-none text-foreground"
                                >
                                    Email
                                </label>
                                <Input
                                    id="email"
                                    type="email"
                                    autoComplete="username email"
                                    placeholder="name@example.com"
                                    value={email}
                                    onChange={(event) => {
                                        setError(null)
                                        setEmail(event.target.value)
                                    }}
                                    className="h-11 border-border/80 bg-background focus-visible:border-neutral-400 dark:focus-visible:border-neutral-500 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none"
                                    required
                                    disabled={isSubmitting}
                                />
                            </div>

                            {requiresCaptcha ? (
                                <div className="flex justify-center my-2">
                                    <TurnstileWidget
                                        action="forgot-password"
                                        onVerify={(token) => {
                                            setCaptchaToken(token)
                                            setError(null)
                                        }}
                                        onExpire={() => setCaptchaToken(null)}
                                    />
                                </div>
                            ) : null}

                            <Button
                                type="submit"
                                className="w-full h-11 font-medium shadow-sm transition-all duration-300"
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Sending reset link...
                                    </>
                                ) : (
                                    'Send reset link'
                                )}
                            </Button>
                        </form>
                    )}

                    {/* Footer */}
                    <div className="mt-8 pt-6 border-t border-border/40 text-center space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Back to{' '}
                            <Link
                                href="/login"
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
