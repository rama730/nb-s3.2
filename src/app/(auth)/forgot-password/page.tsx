"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import TurnstileWidget, { hasTurnstileSiteKey } from "@/components/auth/TurnstileWidget";
import { buildOAuthRedirectTo, resolveAuthBaseUrl } from "@/lib/auth/redirects";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);
    const [email, setEmail] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);
    const [captchaToken, setCaptchaToken] = useState<string | null>(null);
    const requiresCaptcha = hasTurnstileSiteKey();

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setError(null);

        if (requiresCaptcha && !captchaToken) {
            setError("Please complete the Turnstile check.");
            return;
        }

        setIsSubmitting(true);
        try {
            const redirectTo = buildOAuthRedirectTo(
                resolveAuthBaseUrl({ browserOrigin: typeof window !== "undefined" ? window.location.origin : null }),
                "/reset-password"
            );

            const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
                redirectTo,
                captchaToken: captchaToken || undefined,
            });

            if (resetError) {
                throw resetError;
            }

            setSent(true);
        } catch (submitError) {
            setCaptchaToken(null);
            setError(submitError instanceof Error ? submitError.message : "Unable to send reset email.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
            <div className="w-full max-w-md space-y-6">
                <div className="text-center space-y-2">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-primary-foreground font-bold text-xl">
                        E
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
                    <p className="text-muted-foreground">We will send a secure recovery link to your email.</p>
                </div>

                <Card className="border-0 shadow-xl bg-card/50 backdrop-blur-sm">
                    <CardHeader className="space-y-1 pb-4">
                        <CardTitle className="text-xl">Forgot password</CardTitle>
                        <CardDescription>
                            Enter the email address you use for this account.
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-4">
                        {sent ? (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200">
                                If the account exists, a reset link has been sent. Check your inbox and spam folder.
                            </div>
                        ) : (
                            <form onSubmit={handleSubmit} className="space-y-4">
                                {error ? (
                                    <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                                        {error}
                                    </div>
                                ) : null}

                                <div className="space-y-2">
                                    <Label htmlFor="email">Email</Label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            id="email"
                                            type="email"
                                            placeholder="name@example.com"
                                            value={email}
                                            onChange={(event) => setEmail(event.target.value)}
                                            className="pl-10 h-11"
                                            required
                                            disabled={isSubmitting}
                                        />
                                    </div>
                                </div>

                                {requiresCaptcha ? (
                                    <TurnstileWidget
                                        action="forgot-password"
                                        onVerify={(token) => {
                                            setCaptchaToken(token);
                                            setError(null);
                                        }}
                                        onExpire={() => setCaptchaToken(null)}
                                    />
                                ) : null}

                                <Button type="submit" className="w-full h-11" disabled={isSubmitting}>
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Sending reset link...
                                        </>
                                    ) : (
                                        "Send reset link"
                                    )}
                                </Button>
                            </form>
                        )}
                    </CardContent>

                    <CardFooter className="flex justify-center pb-6">
                        <p className="text-sm text-muted-foreground">
                            Back to{" "}
                            <Link href="/login" className="text-primary font-medium hover:underline">
                                Sign in
                            </Link>
                        </p>
                    </CardFooter>
                </Card>
            </div>
        </div>
    );
}
