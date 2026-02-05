"use client";

import { Moon, Sun, Laptop } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";

export default function ThemeToggle() {
    const { theme, resolvedTheme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    const isTransitioningRef = useRef(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const prefersReducedMotion = useCallback(() => {
        try {
            if (document.documentElement.hasAttribute("data-reduce-motion")) return true;
            return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
        } catch {
            return false;
        }
    }, []);

    const withThemeTransition = useCallback(async (apply: () => void | Promise<void>) => {
        if (isTransitioningRef.current) return;
        isTransitioningRef.current = true;
        const root = document.documentElement;
        root.classList.add("theme-transition");

        try {
            const canUseViewTransition = !!(document as any).startViewTransition && !prefersReducedMotion();
            if (!canUseViewTransition) {
                await apply();
                return;
            }

            const transition = (document as any).startViewTransition(() => apply());
            await transition.finished;
        } finally {
            // Keep the transition class only briefly; prevents “always-on” transitions.
            window.setTimeout(() => root.classList.remove("theme-transition"), 220);
            isTransitioningRef.current = false;
        }
    }, [prefersReducedMotion]);

    const toggleLightDark = useCallback(async () => {
        const current = (resolvedTheme === "dark" ? "dark" : "light");
        const next = current === "dark" ? "light" : "dark";
        await withThemeTransition(() => setTheme(next));
    }, [resolvedTheme, setTheme, withThemeTransition]);

    if (!mounted) {
        return (
            <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0 opacity-50 cursor-not-allowed"
                aria-label="Theme (loading)"
                disabled
            />
        );
    }

    const currentIcon = (() => {
        switch (theme) {
            case 'dark': return <Moon className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />;
            case 'light': return <Sun className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />;
            default: return <Laptop className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />;
        }
    })();

    return (
        <button
            onClick={() => void toggleLightDark()}
            className="relative p-2 rounded-lg hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            aria-label="Toggle theme"
            title={`Theme: ${theme} (${resolvedTheme})`}
        >
            {currentIcon}
        </button>
    );
}
