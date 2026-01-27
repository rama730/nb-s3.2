"use client";

import Link from "next/link";
import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

interface NavLinkProps extends React.ComponentProps<typeof Link> {
    href: string;
    icon: LucideIcon;
    label: string;
    isActive: boolean;
    badge?: ReactNode;
}

export default function NavLink({ href, icon: Icon, label, isActive, badge, ...props }: NavLinkProps) {
    return (
        <Link
            href={href}
            prefetch={true}
            className={`
        relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
        transition-all duration-200
        ${isActive
                    ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800'
                }
      `}
            {...props}
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
