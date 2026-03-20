'use client'

import { Suspense, useMemo, useState } from 'react'
import Link from 'next/link'

import { Mail, Loader2, RefreshCcw } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

function VerifyEmailPageInner() {
    const { user, signOut } = useAuth()
    const supabase = useMemo(() => createClient(), [])
    const [isSending, setIsSending] = useState(false)
    const [message, setMessage] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const handleResend = async () => {
        if (!user?.email) {
            setError('Sign in again to resend the verification email.')
            return
        }

        setIsSending(true)
        setMessage(null)
        setError(null)

        try {
            const { error: resendError } = await supabase.auth.resend({
                type: 'signup',
                email: user.email,
            })

            if (resendError) {
                setError(resendError.message || 'Unable to resend verification email.')
                return
            }

            setMessage(`Verification email sent to ${user.email}.`)
        } catch (resendError) {
            setError(resendError instanceof Error ? resendError.message : 'Unable to resend verification email.')
        } finally {
            setIsSending(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
            <div className="w-full max-w-md">
                <Card className="border-0 shadow-xl bg-card/60 backdrop-blur-sm">
                    <CardHeader className="space-y-3 text-center">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                            <Mail className="h-7 w-7" />
                        </div>
                        <div className="space-y-1">
                            <CardTitle className="text-2xl">Verify Your Email</CardTitle>
                            <CardDescription>
                                Confirm your email address before opening onboarding, messaging, and workspace surfaces.
                            </CardDescription>
                        </div>
                    </CardHeader>

                    <CardContent className="space-y-4 text-sm text-muted-foreground">
                        <p>
                            We sent a verification link to <span className="font-medium text-foreground">{user?.email || 'your email address'}</span>.
                            Open that link, then come back here.
                        </p>
                        <p>
                            Keeping onboarding and the authenticated app behind verified email blocks disposable-account abuse before it reaches the expensive paths.
                        </p>

                        {message ? (
                            <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-emerald-700 dark:text-emerald-300">
                                {message}
                            </div>
                        ) : null}
                        {error ? (
                            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">
                                {error}
                            </div>
                        ) : null}
                    </CardContent>

                    <CardFooter className="flex flex-col gap-3">
                        <Button className="w-full" onClick={handleResend} disabled={isSending}>
                            {isSending ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Sending...
                                </>
                            ) : (
                                <>
                                    <RefreshCcw className="mr-2 h-4 w-4" />
                                    Resend Verification Email
                                </>
                            )}
                        </Button>
                        <div className="flex w-full items-center justify-between text-sm">
                            <Link href="/login" className="text-primary hover:underline">
                                Back to login
                            </Link>
                            <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground"
                                onClick={() => {
                                    void signOut()
                                }}
                            >
                                Sign out
                            </button>
                        </div>
                    </CardFooter>
                </Card>
            </div>
        </div>
    )
}

export default function VerifyEmailPage() {
    return (
        <Suspense>
            <VerifyEmailPageInner />
        </Suspense>
    )
}
