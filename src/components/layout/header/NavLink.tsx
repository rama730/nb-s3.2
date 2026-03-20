"use client";

import Link from "next/link";
import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";
import { useRouteWarmPrefetch } from "@/hooks/useRouteWarmPrefetch";

interface NavLinkProps extends React.ComponentProps<typeof Link> {
    href: string;
    icon: LucideIcon;
    label: string;
    isActive: boolean;
    badge?: ReactNode;
}

export default function NavLink({ href, icon: Icon, label, isActive, badge, ...props }: NavLinkProps) {
    const warmPrefetchRoute = useRouteWarmPrefetch();
    const { onPointerEnter, onFocus, ...restProps } = props;

    return (
        <Link
            href={href}
            prefetch={true}
            onPointerEnter={(event) => {
                warmPrefetchRoute(href);
                onPointerEnter?.(event);
            }}
            onFocus={(event) => {
                warmPrefetchRoute(href);
                onFocus?.(event);
            }}
        className={`
        relative flex items-center gap-2 rounded-lg text-sm font-medium app-density-nav-item
        transition-all duration-200
        ${isActive
                    ? 'app-selected-surface'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800'
                }
      `}
            {...restProps}
        >
            <Icon className="w-4 h-4" strokeWidth={2} />
            <span>{label}</span>

            {/* Badge */}
            {badge && (
                <div className="ml-auto">
                    {badge}
                </div>
            )}
        </Link>
    );
}
