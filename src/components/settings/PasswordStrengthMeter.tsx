"use client";

import { useMemo, memo } from "react";

interface PasswordStrengthMeterProps {
    password: string;
}

interface StrengthResult {
    score: number; // 0-4
    label: string;
    color: string;
    bgColor: string;
}

function calculateStrength(password: string): StrengthResult {
    if (!password) {
        return { score: 0, label: "", color: "text-zinc-400", bgColor: "bg-zinc-200" };
    }

    let score = 0;

    // Length checks
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;

    // Character diversity
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 1;
    if (/[^a-zA-Z0-9]/.test(password)) score += 1;

    // Cap at 4
    score = Math.min(score, 4);

    const strengthLevels: Record<number, Omit<StrengthResult, "score">> = {
        0: { label: "", color: "text-zinc-400", bgColor: "bg-zinc-200" },
        1: { label: "Weak", color: "text-red-600", bgColor: "bg-red-500" },
        2: { label: "Fair", color: "text-orange-600", bgColor: "bg-orange-500" },
        3: { label: "Good", color: "text-yellow-600", bgColor: "bg-yellow-500" },
        4: { label: "Strong", color: "text-green-600", bgColor: "bg-green-500" },
    };

    return { score, ...(strengthLevels[score] as Omit<StrengthResult, "score">) };
}

export const PasswordStrengthMeter = memo(function PasswordStrengthMeter({
    password,
}: PasswordStrengthMeterProps) {
    const strength = useMemo(() => calculateStrength(password), [password]);

    if (!password) return null;

    return (
        <div className="space-y-2">
            {/* Progress bar */}
            <div className="flex gap-1">
                {[1, 2, 3, 4].map((level) => (
                    <div
                        key={level}
                        className={`h-1.5 flex-1 rounded-full transition-colors duration-200 ${level <= strength.score
                            ? strength.bgColor
                            : "bg-zinc-200 dark:bg-zinc-700"
                            }`}
                    />
                ))}
            </div>

            {/* Label */}
            <div className="flex items-center justify-between">
                <span className={`text-xs font-medium ${strength.color}`}>
                    {strength.label}
                </span>
                {strength.score > 0 && strength.score < 3 && (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        Add {strength.score < 2 ? "uppercase, numbers, or symbols" : "more characters"}
                    </span>
                )}
            </div>
        </div>
    );
});

export default PasswordStrengthMeter;
