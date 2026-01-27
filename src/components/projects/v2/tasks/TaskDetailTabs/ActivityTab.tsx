"use client";

import React from "react";
import { Clock } from "lucide-react";

export default function ActivityTab() {
    return (
        <div className="p-6 flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
                <Clock className="w-8 h-8 text-zinc-400" />
            </div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Activity Feed Coming Soon</h3>
            <p className="text-sm text-zinc-500 text-center max-w-sm">
                Track all changes, updates, and interactions on this task in one place.
            </p>
        </div>
    );
}
