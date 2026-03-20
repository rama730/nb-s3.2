"use client";

import { ChevronDown, Laptop, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
        <div className="inline-flex items-center overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <button
                type="button"
                onClick={quickToggleTheme}
                className="relative flex h-[var(--ui-control-height)] w-[var(--ui-control-height)] items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-ring/50"
                aria-label="Quick toggle theme"
                title={`Theme: ${theme} (${resolvedTheme})`}
            >
                {icon}
            </button>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        className="flex h-[var(--ui-control-height)] items-center border-l border-zinc-200 dark:border-zinc-800 px-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-ring/50"
                        aria-label="Choose theme mode"
                    >
                        <ChevronDown className="w-4 h-4" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuLabel>Theme Mode</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => void setThemeWithTransition("light")}>
                        <Sun className="w-4 h-4" />
                        Light
                        {theme === "light" ? <span className="ml-auto text-[10px] uppercase text-primary">Active</span> : null}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void setThemeWithTransition("dark")}>
                        <Moon className="w-4 h-4" />
                        Dark
                        {theme === "dark" ? <span className="ml-auto text-[10px] uppercase text-primary">Active</span> : null}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void setThemeWithTransition("system")}>
                        <Laptop className="w-4 h-4" />
                        System
                        {theme === "system" ? <span className="ml-auto text-[10px] uppercase text-primary">Active</span> : null}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
