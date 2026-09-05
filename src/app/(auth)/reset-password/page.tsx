'use client'

import Link from 'next/link'
import type { FormEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordStrengthMeter } from '@/components/settings/PasswordStrengthMeter'
import { AuthAmbientCanvas } from '@/components/auth/AuthAmbientCanvas'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { getPasswordPolicyResult } from '@/lib/security/password-policy'
import { LegalLinks } from '@/components/legal/LegalLinks'

type RecoveryState = 'loading' | 'ready' | 'invalid' | 'success'

export default function ResetPasswordPage() {
    const router = useRouter()
    const supabase = useMemo(() => createSupabaseBrowserClient(), [])
    const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const [status, setStatus] = useState<RecoveryState>('loading')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        return () => {
            if (redirectTimeoutRef.current !== undefined) {
                clearTimeout(redirectTimeoutRef.current)
                redirectTimeoutRef.current = undefined
            }
        }
    }, [])

    useEffect(() => {
        let active = true

        const syncSession = async () => {
            const { data } = await supabase.auth.getSession()
            if (!active) return
            setStatus(data.session ? 'ready' : 'invalid')
        }

        void syncSession()

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
            if (!active) return
            if (session) {
                setStatus('ready')
            }
        })

        return () => {
            active = false
            subscription.unsubscribe()
        }
    }, [supabase])

    const passwordPolicy = useMemo(() => getPasswordPolicyResult(newPassword), [newPassword])

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault()
        setError(null)

        if (!passwordPolicy.ok) {
            setError(passwordPolicy.error || 'Password does not meet security requirements.')
            return
        }

        if (newPassword !== confirmPassword) {
            setError('Passwords do not match.')
            return
        }

        setSubmitting(true)
        try {
            const safetyResponse = await fetch('/api/v1/auth/password-safety', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ password: newPassword }),
            })
            const safetyBody = (await safetyResponse.json().catch(() => null)) as { message?: string } | null
            if (!safetyResponse.ok) {
                throw new Error(safetyBody?.message || 'Unable to verify password safety.')
            }

            const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
            if (updateError) {
                throw updateError
            }

            await supabase.auth.signOut().catch(() => null)
            setStatus('success')
            if (redirectTimeoutRef.current !== undefined) {
                clearTimeout(redirectTimeoutRef.current)
            }
            redirectTimeoutRef.current = setTimeout(() => {
                redirectTimeoutRef.current = undefined
                router.replace('/login')
            }, 1200)
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'Unable to update password.')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <main className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2 bg-background text-foreground">
            {/* Left Panel: Clean Interactive Password Reset Form */}
            <div className="flex flex-col justify-center items-center py-8 sm:py-12 px-6 sm:px-10 lg:px-12 xl:p-16 w-full min-h-screen">
                <div className="w-full max-w-md my-auto sm:mt-2 transition-all duration-500 ease-out">
                    {/* Title Header */}
                    <div className="space-y-1.5 mb-8">
                        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                            Choose a new password
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Finish account recovery with a strong new password of at least 12 characters.
                        </p>
                    </div>

                    {status === 'loading' && (
                        <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/40 border border-border/60 text-sm text-muted-foreground animate-in fade-in-50 duration-200">
                            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                            <span>Preparing recovery session...</span>
                        </div>
                    )}

                    {status === 'invalid' && (
                        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-sm text-amber-800 dark:text-amber-200 space-y-2 animate-in fade-in-50 duration-200">
                            <p className="font-medium">Invalid or Expired Link</p>
                            <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                                This recovery link is invalid or has expired. Please request a new password reset email to continue.
                            </p>
                            <div className="pt-2">
                                <Link
                                    href="/forgot-password"
                                    className="text-xs font-semibold underline underline-offset-4 hover:text-foreground"
                                >
                                    Request a new reset link &rarr;
                                </Link>
                            </div>
                        </div>
                    )}

                    {status === 'success' && (
                        <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-sm text-emerald-800 dark:text-emerald-200 flex items-start gap-3 animate-in fade-in-50 duration-200">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="font-medium">Password updated successfully</p>
                                <p className="text-xs text-emerald-700/90 dark:text-emerald-300/90 mt-0.5">
                                    Redirecting you to sign in...
                                </p>
                            </div>
                        </div>
                    )}

                    {status === 'ready' && (
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
                                    htmlFor="new-password"
                                    className="text-sm font-medium leading-none text-foreground"
                                >
                                    New password
                                </label>
                                <Input
                                    id="new-password"
                                    type="password"
                                    autoComplete="new-password"
                                    placeholder="Enter your new password"
                                    value={newPassword}
                                    onChange={(event) => {
                                        setError(null)
                                        setNewPassword(event.target.value)
                                    }}
                                    className="h-11 border-border/80 bg-background focus-visible:border-neutral-400 dark:focus-visible:border-neutral-500 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none"
                                    required
                                    disabled={submitting}
                                />
                                <PasswordStrengthMeter password={newPassword} result={passwordPolicy} />
                            </div>

                            <div className="space-y-1.5">
                                <label
                                    htmlFor="confirm-password"
                                    className="text-sm font-medium leading-none text-foreground"
                                >
                                    Confirm password
                                </label>
                                <Input
                                    id="confirm-password"
                                    type="password"
                                    autoComplete="new-password"
                                    placeholder="Confirm your new password"
                                    value={confirmPassword}
                                    onChange={(event) => {
                                        setError(null)
                                        setConfirmPassword(event.target.value)
                                    }}
                                    className="h-11 border-border/80 bg-background focus-visible:border-neutral-400 dark:focus-visible:border-neutral-500 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none"
                                    required
                                    disabled={submitting}
                                />
                            </div>

                            <Button
                                type="submit"
                                className="w-full h-11 font-medium shadow-sm transition-all duration-300"
                                disabled={submitting || !passwordPolicy.ok}
                            >
                                {submitting ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Updating password...
                                    </>
                                ) : (
                                    'Update password'
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
