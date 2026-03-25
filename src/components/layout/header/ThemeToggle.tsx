"use client";

import { Laptop, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/providers/theme-provider";

export default function ThemeToggle() {
    const { theme, resolvedTheme, setThemeWithTransition } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const quickToggleTheme = useCallback(() => {
        const current = resolvedTheme === "dark" ? "dark" : "light";
        const next = current === "dark" ? "light" : "dark";
        void setThemeWithTransition(next);
    }, [resolvedTheme, setThemeWithTransition]);

    const icon = useMemo(() => {
        if (theme === "dark") return <Moon className="w-5 h-5 text-zinc-600 dark:text-zinc-300" />;
        if (theme === "light") return <Sun className="w-5 h-5 text-zinc-600 dark:text-zinc-300" />;
        return <Laptop className="w-5 h-5 text-zinc-600 dark:text-zinc-300" />;
    }, [theme]);

    if (!mounted) {
        return (
            <Button
                variant="ghost"
                size="sm"
                className="opacity-50 cursor-not-allowed"
                aria-label="Theme (loading)"
                disabled
            />
        );
    }

    return (
        <button
            type="button"
            onClick={quickToggleTheme}
            className="flex h-[var(--ui-control-height)] w-[var(--ui-control-height)] items-center justify-center rounded-lg transition-colors hover:bg-zinc-100 focus:outline-none dark:hover:bg-zinc-800"
            aria-label="Toggle theme"
            title={`Theme: ${theme}`}
        >
            {icon}
        </button>
    );
}
