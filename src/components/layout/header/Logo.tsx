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
                <div className="absolute inset-0 app-accent-gradient rounded-lg opacity-100 group-hover:opacity-90 transition-opacity" />

                <div className="relative p-1.5">
                    <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
                </div>
            </div>

            <span className="text-xl font-bold app-accent-gradient-text">
                NB
            </span>
        </Link>
    );
}
