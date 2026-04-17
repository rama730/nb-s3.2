"use client";

import { useMemo, memo } from "react";
import { getPasswordPolicyResult, PASSWORD_MIN_LENGTH } from "@/lib/security/password-policy";

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

    const result = getPasswordPolicyResult(password);
    const satisfiedChecks = Object.values(result.checks).filter(Boolean).length;
    const score = Math.min(
        4,
        result.ok
            ? Math.max(3, satisfiedChecks - 1)
            : Math.max(1, [result.checks.minLength, result.checks.uppercase, result.checks.lowercase, result.checks.number]
                .filter(Boolean)
                .length),
    );

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
    const passwordPolicy = useMemo(() => getPasswordPolicyResult(password), [password]);

    if (!password) return null;

    const guidance = !passwordPolicy.checks.minLength
        ? `Use ${PASSWORD_MIN_LENGTH}+ characters`
        : !passwordPolicy.checks.uppercase
            ? "Add an uppercase letter"
            : !passwordPolicy.checks.lowercase
                ? "Add a lowercase letter"
                : !passwordPolicy.checks.number
                    ? "Add a number"
                    : !passwordPolicy.checks.symbol
                        ? "Add a symbol for extra strength"
                        : null;

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
                {guidance ? (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {guidance}
                    </span>
                ) : null}
            </div>
        </div>
    );
});

export default PasswordStrengthMeter;
