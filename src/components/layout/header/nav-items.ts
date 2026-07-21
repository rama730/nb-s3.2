import { LayoutGrid, MessageSquare, Settings, Users } from "lucide-react";

import { ROUTES } from "@/constants/routes";

export const MAIN_NAV_ITEMS = [
    { href: ROUTES.HUB, label: "Hub", icon: LayoutGrid },
    { href: ROUTES.PEOPLE, label: "Connections", icon: Users },
    { href: ROUTES.MESSAGES, label: "Messages", icon: MessageSquare },
    { href: ROUTES.SETTINGS, label: "Settings", icon: Settings },
] as const;

export function isMainNavRouteActive(pathname: string | null, href: string) {
    return pathname === href || Boolean(pathname?.startsWith(`${href}/`));
}
