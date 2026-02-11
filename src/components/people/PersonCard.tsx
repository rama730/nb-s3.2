"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { MapPin, Briefcase, Loader2, Check, Clock, UserPlus, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { profileHref } from "@/lib/routing/identifiers";
import type { SuggestedProfile } from "@/app/actions/connections";

interface PersonCardProps {
    profile: SuggestedProfile;
    onConnect: (userId: string) => Promise<void>;
    onDismiss?: (userId: string) => Promise<void>;
    isConnecting?: boolean;
}

export default function PersonCard({ profile, onConnect, onDismiss, isConnecting }: PersonCardProps) {
    const [isHovered, setIsHovered] = useState(false);
    const [localStatus, setLocalStatus] = useState(profile.connectionStatus);

    useEffect(() => {
        setLocalStatus(profile.connectionStatus);
    }, [profile.connectionStatus]);

    const handleConnect = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (localStatus !== 'none') return;

        setLocalStatus('pending_sent');
        try {
            await onConnect(profile.id);
        } catch {
            setLocalStatus('none');
        }
    };

    const handleDismiss = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!onDismiss) return;
        await onDismiss(profile.id);
    };

    const getButtonContent = () => {
        if (isConnecting) {
            return (
                <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Connecting...</span>
                </>
            );
        }

        switch (localStatus) {
            case 'connected':
                return (
                    <>
                        <Check className="w-4 h-4" />
                        <span>Connected</span>
                    </>
                );
            case 'pending_sent':
                return (
                    <>
                        <Clock className="w-4 h-4" />
                        <span>Pending</span>
                    </>
                );
            case 'pending_received':
                return (
                    <>
                        <UserPlus className="w-4 h-4" />
                        <span>Accept</span>
                    </>
                );
            default:
                return (
                    <>
                        <UserPlus className="w-4 h-4" />
                        <span>Connect</span>
                    </>
                );
        }
    };

    const getButtonStyles = () => {
        switch (localStatus) {
            case 'connected':
                return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 cursor-default';
            case 'pending_sent':
                return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 cursor-default';
            case 'pending_received':
                return 'bg-indigo-600 text-white hover:bg-indigo-700';
            default:
                return 'bg-indigo-600 text-white hover:bg-indigo-700';
        }
    };

    return (
        <motion.div
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            layout
            className="relative rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden transition-shadow hover:shadow-xl"
        >
            {onDismiss && (
                <button
                    type="button"
                    onClick={handleDismiss}
                    className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors"
                    aria-label={`Dismiss ${profile.fullName || profile.username || "suggestion"}`}
                >
                    <X className="w-4 h-4" />
                </button>
            )}
            <Link href={profileHref(profile)} className="block p-4">
                {/* Main Content - Always Visible */}
                <div className="flex items-start gap-3">
                    {/* Avatar */}
                    {profile.avatarUrl ? (
                        <Image
                            src={profile.avatarUrl}
                            alt={profile.fullName || profile.username || "User"}
                            width={56}
                            height={56}
                            className="w-14 h-14 rounded-full object-cover flex-shrink-0"
                        />
                    ) : (
                        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xl font-semibold flex-shrink-0">
                            {(profile.fullName || profile.username || "U")[0]?.toUpperCase()}
                        </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                            {profile.fullName || profile.username || "User"}
                        </h3>

                        {profile.headline && (
                            <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-1 mt-0.5">
                                {profile.headline}
                            </p>
                        )}

                        {profile.location && (
                            <p className="text-xs text-zinc-500 dark:text-zinc-500 flex items-center gap-1 mt-1">
                                <MapPin className="w-3 h-3" />
                                {profile.location}
                            </p>
                        )}
                    </div>
                </div>

                {/* Expandable Projects Section */}
                <AnimatePresence>
                    {isHovered && profile.projects && profile.projects.length > 0 && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: "easeInOut" }}
                            className="overflow-hidden"
                        >
                            <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                                <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                                    <Briefcase className="w-3.5 h-3.5" />
                                    Projects
                                </div>
                                <div className="space-y-1.5">
                                    {profile.projects.slice(0, 3).map((proj) => (
                                        <div
                                            key={proj.id}
                                            className="flex items-center justify-between text-sm"
                                        >
                                            <span className="text-zinc-700 dark:text-zinc-300 truncate">
                                                {proj.title}
                                            </span>
                                            <span
                                                className={cn(
                                                    "text-xs px-2 py-0.5 rounded-full capitalize",
                                                    proj.status === "active"
                                                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                                        : proj.status === "completed"
                                                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                                                )}
                                            >
                                                {proj.status || "draft"}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </Link>

            {/* Connect Button */}
            <div className="px-4 pb-4">
                <button
                    onClick={handleConnect}
                    disabled={isConnecting || localStatus === 'connected' || localStatus === 'pending_sent'}
                    className={cn(
                        "w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all",
                        getButtonStyles(),
                        (isConnecting || localStatus === 'connected' || localStatus === 'pending_sent') && "opacity-80"
                    )}
                >
                    {getButtonContent()}
                </button>
            </div>
        </motion.div>
    );
}
