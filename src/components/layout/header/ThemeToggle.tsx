"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export default function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const toggleTheme = () => {
        // Cycle: system -> light -> dark -> system
        const newTheme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
        setTheme(newTheme);
    };

    if (!mounted) {
        return (
            <button className="p-2 rounded-lg hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 transition-colors" aria-label="Toggle theme">
                <div className="w-5 h-5" />
            </button>
        );
    }

    return (
        <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 transition-colors group relative overflow-hidden"
            aria-label="Toggle theme"
            title={`Current: ${theme}`}
        >
            <div className="relative w-5 h-5 flex items-center justify-center">
                {/* Sun (Light) */}
                <Sun className={`absolute w-5 h-5 text-zinc-600 dark:text-zinc-400 transition-all duration-300 ${theme === 'light' ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-0 opacity-0'
                    }`} />

                {/* Moon (Dark) */}
                <Moon className={`absolute w-5 h-5 text-zinc-600 dark:text-zinc-400 transition-all duration-300 ${theme === 'dark' ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0'
                    }`} />

                {/* Laptop (System) - Only visible when theme is system */}
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`absolute w-5 h-5 text-zinc-600 dark:text-zinc-400 transition-all duration-300 ${theme === 'system' ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
                        }`}
                >
                    <rect width="20" height="14" x="2" y="3" rx="2" />
                    <line x1="2" x2="22" y1="21" y2="21" />
                </svg>
            </div>
        </button>
    );
}
