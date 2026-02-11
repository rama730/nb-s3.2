"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/constants/routes";
import { usePeopleNotifications } from "@/hooks/usePeopleNotifications";

export default function WorkspaceIndicator() {
    const pathname = usePathname();
    const isActive = pathname === ROUTES.WORKSPACE;
    const { totalPending } = usePeopleNotifications();

    return (
        <Link
            href={ROUTES.WORKSPACE}
            className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors group",
                isActive
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            )}
        >
            <div
                className={cn(
                    "relative flex items-center justify-center w-5 h-5 rounded transition-colors",
                    isActive
                        ? "bg-blue-100 text-blue-600 dark:bg-blue-800/50 dark:text-blue-400"
                        : "bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 group-hover:text-blue-600 dark:group-hover:text-blue-400"
                )}
            >
                <Briefcase className="w-3 h-3" />
                {totalPending > 0 && (
                    <span
                        className="absolute -top-1 -right-1 min-w-[14px] h-[14px] text-[9px] font-bold bg-rose-500 text-white rounded-full flex items-center justify-center leading-none"
                        aria-label={`${totalPending} items need attention`}
                    >
                        {totalPending > 9 ? '9+' : totalPending}
                    </span>
                )}
            </div>
            <span className="hidden md:inline">Workspace</span>
            <ChevronRight className="hidden md:block w-3 h-3 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors" />
        </Link>
    );
}
