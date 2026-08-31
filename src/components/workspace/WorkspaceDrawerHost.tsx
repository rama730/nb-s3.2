"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useUIStore } from "@/lib/stores/ui-store";

const WorkspaceDrawer = dynamic(() => import("./WorkspaceDrawer"), { ssr: false });

export function WorkspaceDrawerHost() {
    const isOpen = useUIStore((state) => state.isWorkspaceOpen);
    const setWorkspaceOpen = useUIStore((state) => state.setWorkspaceOpen);
    const setWorkspaceTab = useUIStore((state) => state.setWorkspaceTab);
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const drawerDeepLink = searchParams?.get("drawerType") === "workspace";
    const workspaceDeepLink = searchParams?.get("workspace");
    const isDeepLinked = drawerDeepLink || Boolean(workspaceDeepLink);
    const requestedTab = workspaceDeepLink || searchParams?.get("workspaceTab");
    const [hasMounted, setHasMounted] = useState(isOpen || isDeepLinked);

    useEffect(() => {
        if (isOpen || isDeepLinked) setHasMounted(true);
    }, [isDeepLinked, isOpen]);

    useEffect(() => {
        if (!isDeepLinked) return;
        setWorkspaceTab(requestedTab === "requests" ? "requests" : "tasks");
        setWorkspaceOpen(true);
        // Legacy links need one ephemeral instruction to open the drawer; the
        // URL is immediately returned to the clean hub route.
        if (isDeepLinked) {
            const params = new URLSearchParams(searchParams?.toString());
            if (workspaceDeepLink) params.delete("workspace");
            if (drawerDeepLink) {
                params.delete("drawerType");
                params.delete("workspaceTab");
            }
            const query = params.toString();
            router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        }
    }, [drawerDeepLink, isDeepLinked, pathname, requestedTab, router, searchParams, setWorkspaceOpen, setWorkspaceTab, workspaceDeepLink]);

    // ponytail: keep the lazily loaded host after its first open so Radix can
    // play the closed-state animation instead of being unmounted immediately.
    return hasMounted ? <WorkspaceDrawer /> : null;
}
