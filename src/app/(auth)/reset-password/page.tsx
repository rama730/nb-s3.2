"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordStrengthMeter } from "@/components/settings/PasswordStrengthMeter";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type RecoveryState = "loading" | "ready" | "invalid" | "success";

export default function ResetPasswordPage() {
    const router = useRouter();
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);
    const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [status, setStatus] = useState<RecoveryState>("loading");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        return () => {
            if (redirectTimeoutRef.current !== undefined) {
                clearTimeout(redirectTimeoutRef.current);
                redirectTimeoutRef.current = undefined;
            }
        };
    }, []);

    useEffect(() => {
        let active = true;

        const syncSession = async () => {
            const { data } = await supabase.auth.getSession();
            if (!active) return;
            setStatus(data.session ? "ready" : "invalid");
        };

        void syncSession();

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
            if (!active) return;
            if (session) {
                setStatus("ready");
            }
        });

        return () => {
            active = false;
            subscription.unsubscribe();
        };
    }, [supabase]);

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setError(null);

        if (newPassword.length < 12) {
            setError("Password must be at least 12 characters.");
            return;
        }

        if (newPassword !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }

        setSubmitting(true);
        try {
            const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
            if (updateError) {
                throw updateError;
            }

            await supabase.auth.signOut().catch(() => null);
            setStatus("success");
            if (redirectTimeoutRef.current !== undefined) {
                clearTimeout(redirectTimeoutRef.current);
            }
            redirectTimeoutRef.current = setTimeout(() => {
                redirectTimeoutRef.current = undefined;
                router.replace("/login");
            }, 1200);
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "Unable to update password.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
            <div className="w-full max-w-md space-y-6">
                <div className="text-center space-y-2">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-primary-foreground font-bold text-xl">
                        E
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
                    <p className="text-muted-foreground">Finish account recovery with a strong new password of at least 12 characters.</p>
                </div>

                <Card className="border-0 shadow-xl bg-card/50 backdrop-blur-sm">
                    <CardHeader className="space-y-1 pb-4">
                        <CardTitle className="text-xl">Reset password</CardTitle>
                        <CardDescription>
                            Set a new password for your account.
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-4">
                        {status === "loading" ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Preparing recovery session...
                            </div>
                        ) : null}

                        {status === "invalid" ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
                                This recovery link is invalid or has expired. Request a new password reset email to continue.
                            </div>
                        ) : null}

                        {status === "success" ? (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200">
                                Password updated. Redirecting you to sign in...
                            </div>
                        ) : null}

                        {status === "ready" ? (
                            <form onSubmit={handleSubmit} className="space-y-4">
                                {error ? (
                                    <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                                        {error}
                                    </div>
                                ) : null}

                                <div className="space-y-2">
                                    <Label htmlFor="new-password">New password</Label>
                                    <Input
                                        id="new-password"
                                        type="password"
                                        value={newPassword}
                                        onChange={(event) => setNewPassword(event.target.value)}
                                        className="h-11"
                                        required
                                        disabled={submitting}
                                    />
                                    <PasswordStrengthMeter password={newPassword} />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="confirm-password">Confirm password</Label>
                                    <Input
                                        id="confirm-password"
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(event) => setConfirmPassword(event.target.value)}
                                        className="h-11"
                                        required
                                        disabled={submitting}
                                    />
                                </div>

                                <Button type="submit" className="w-full h-11" disabled={submitting}>
                                    {submitting ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Updating password...
                                        </>
                                    ) : (
                                        "Update password"
                                    )}
                                </Button>
                            </form>
                        ) : null}
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
