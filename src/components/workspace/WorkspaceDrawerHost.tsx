"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

import { useUIStore } from "@/lib/stores/ui-store";

const WorkspaceDrawer = dynamic(() => import("./WorkspaceDrawer"), { ssr: false });

export function WorkspaceDrawerHost() {
    const isOpen = useUIStore((state) => state.isWorkspaceOpen);
    const searchParams = useSearchParams();
    const isDeepLinked = searchParams?.get("drawerType") === "workspace";

    return isOpen || isDeepLinked ? <WorkspaceDrawer /> : null;
}
