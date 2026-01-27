"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";

export default function Logo() {
    return (
        <Link
            href="/"
            className="flex items-center gap-2 group"
            aria-label="Navigate to home"
        >
            <div className="relative">
                {/* Gradient background */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg opacity-100 group-hover:opacity-90 transition-opacity" />

                {/* Icon */}
                <div className="relative p-1.5">
                    <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
                </div>
            </div>

            {/* Text logo */}
            <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 bg-clip-text text-transparent">
                NB
            </span>
        </Link>
    );
}
