"use client";

import { useState, useEffect } from "react";
import Button from "@/components/ui-custom/Button";
import { Loader2, Shield, ShieldCheck, KeyRound, Trash2 } from "lucide-react";
import type { MfaFactor } from "@/lib/types/settingsTypes";

interface MfaSetupProps {
    initialFactors?: MfaFactor[];
}

export function MfaSetup({ initialFactors = [] }: MfaSetupProps) {
    const [factors, setFactors] = useState<MfaFactor[]>(initialFactors);
    const [loading, setLoading] = useState(!initialFactors.length);
    const [enrolling, setEnrolling] = useState(false);

    useEffect(() => {
        if (!initialFactors.length) {
            loadFactors();
        }
    }, []);

    const loadFactors = async () => {
        try {
            const res = await fetch("/api/v1/auth/mfa/factors");
            const json = await res.json();
            if (json.success) {
                setFactors(json.data.factors || []);
            }
        } catch (error) {
            console.error("Failed to load MFA factors:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleEnroll = async () => {
        setEnrolling(true);
        try {
            // In a real app, this would open MFA enrollment flow
            alert("MFA enrollment would open here");
        } finally {
            setEnrolling(false);
        }
    };

    const handleUnenroll = async (factorId: string) => {
        if (!confirm("Are you sure you want to remove this MFA factor?")) return;

        try {
            const res = await fetch(`/api/v1/auth/mfa/factors/${factorId}`, {
                method: "DELETE",
            });
            if (res.ok) {
                setFactors((prev) => prev.filter((f) => f.id !== factorId));
            }
        } catch (error) {
            console.error("Failed to unenroll factor:", error);
            alert("Failed to remove MFA factor");
        }
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading MFA settings...
            </div>
        );
    }

    const hasVerifiedFactor = factors.some((f) => f.status === "verified");

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                {hasVerifiedFactor ? (
                    <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                        <ShieldCheck className="h-5 w-5" />
                        <span className="text-sm font-medium">MFA Enabled</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                        <Shield className="h-5 w-5" />
                        <span className="text-sm font-medium">MFA Not Enabled</span>
                    </div>
                )}
            </div>

            {factors.length > 0 ? (
                <div className="space-y-2">
                    {factors.map((factor) => (
                        <div
                            key={factor.id}
                            className="flex items-center justify-between p-3 rounded-lg border border-zinc-200 dark:border-zinc-800"
                        >
                            <div className="flex items-center gap-3">
                                <KeyRound className="h-4 w-4 text-zinc-500" />
                                <div>
                                    <div className="text-sm font-medium">
                                        {factor.type === "totp" ? "Authenticator App" : "Phone"}
                                    </div>
                                    <div className="text-xs text-zinc-500">
                                        Added {new Date(factor.created_at).toLocaleDateString()}
                                    </div>
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleUnenroll(factor.id)}
                            >
                                <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-sm text-zinc-500">
                    Add an extra layer of security with a time-based one-time password (TOTP).
                </p>
            )}

            <Button onClick={handleEnroll} disabled={enrolling}>
                {enrolling ? (
                    <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Setting up...
                    </>
                ) : (
                    "Set up authenticator"
                )}
            </Button>
        </div>
    );
}
