"use client";

import { User, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import AboutTab from "./AboutTab";
import PostsTab from "./PostsTab";
import type { Profile } from "@/lib/db/schema";

interface ProfileTabsProps {
    activeTab: "about" | "posts";
    onTabChange: (tab: "about" | "posts") => void;
    profile: Profile;
    isOwner: boolean;
}

export default function ProfileTabs({ activeTab, onTabChange, profile, isOwner }: ProfileTabsProps) {
    const tabs = [
        { id: "about" as const, label: "About", icon: User },
        { id: "posts" as const, label: "Posts", icon: FileText },
    ];

    return (
        <div className="space-y-6">
            {/* Tab Navigation */}
            <div className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800">
                {tabs.map((tab) => {
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => onTabChange(tab.id)}
                            className={cn(
                                "relative px-6 py-3 font-semibold text-sm transition-all duration-200 flex items-center gap-2",
                                "hover:text-zinc-900 dark:hover:text-white",
                                activeTab === tab.id
                                    ? "text-zinc-900 dark:text-white"
                                    : "text-zinc-500 dark:text-zinc-400"
                            )}
                        >
                            <Icon className="w-4 h-4" />
                            <span>{tab.label}</span>
                            {activeTab === tab.id && (
                                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400 animate-in slide-in-from-left duration-300" />
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Tab Content */}
            <div className="animate-in fade-in duration-300">
                {activeTab === "about" && <AboutTab profile={profile} isOwner={isOwner} />}
                {activeTab === "posts" && <PostsTab profile={profile} isOwner={isOwner} />}
            </div>
        </div>
    );
}
