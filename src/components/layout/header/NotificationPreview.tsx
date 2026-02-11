"use client";

import { Bell } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";

export default function NotificationPreview() {
    const { unreadCount } = useNotifications();

    return (
        <button className="relative p-2 rounded-lg hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 transition-colors">
            <Bell className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
            {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
            )}
        </button>
    );
}
