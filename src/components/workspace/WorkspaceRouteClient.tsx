"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUIStore } from "@/lib/stores/ui-store";

export default function WorkspaceRouteClient() {
    const router = useRouter();
    const setWorkspaceOpen = useUIStore((s) => s.setWorkspaceOpen);
    const setWorkspaceTab = useUIStore((s) => s.setWorkspaceTab);

    useEffect(() => {
        setWorkspaceOpen(true);
        setWorkspaceTab("overview");
        router.replace("/hub");
    }, [router, setWorkspaceOpen, setWorkspaceTab]);

    return (
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 p-8 text-center bg-zinc-50 dark:bg-zinc-950">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
            <div className="space-y-1">
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">Opening Workspace...</h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Redirecting you to the hub page where your workspace will open.
                </p>
            </div>
        </div>
    );
}
