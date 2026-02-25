"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { MapPin, Briefcase, Loader2, Check, Clock, UserPlus, X, Users } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { profileHref } from "@/lib/routing/identifiers";
import type { SuggestedProfile } from "@/app/actions/connections";

interface PersonCardProps {
    profile: SuggestedProfile;
    onConnect: (userId: string) => Promise<void>;
    onDismiss?: (userId: string) => Promise<void>;
    isConnecting?: boolean;
    /** Render as a large spotlight card */
    variant?: "default" | "spotlight";
}

function PersonCard({ profile, onConnect, onDismiss, isConnecting, variant = "default" }: PersonCardProps) {
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
                return (<><Check className="w-4 h-4" /><span>Connected</span></>);
            case 'pending_sent':
                return (<><Clock className="w-4 h-4" /><span>Pending</span></>);
            case 'pending_received':
                return (<><UserPlus className="w-4 h-4" /><span>Accept</span></>);
            default:
                return (<><UserPlus className="w-4 h-4" /><span>Connect</span></>);
        }
    };

    const getButtonStyles = () => {
        switch (localStatus) {
            case 'connected':
                return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 cursor-default';
            case 'pending_sent':
                return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 cursor-default';
            case 'pending_received':
            default:
                return 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-700 hover:to-purple-700 shadow-md shadow-indigo-500/20';
        }
    };

    const isSpotlight = variant === "spotlight";

    // ---------- SPOTLIGHT VARIANT ----------
    if (isSpotlight) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative rounded-2xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-zinc-200/60 dark:border-white/10 overflow-hidden hover:shadow-2xl hover:-translate-y-0.5 transition-all duration-300 min-w-[320px] max-w-[380px] shrink-0"
            >
                {/* Gradient accent top */}
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-indigo-500 to-purple-500" />

                {onDismiss && (
                    <button
                        type="button"
                        onClick={handleDismiss}
                        className="absolute right-3 top-4 z-10 rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors"
                        aria-label={`Dismiss ${profile.fullName || "suggestion"}`}
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}

                <Link href={profileHref(profile)} className="block p-5">
                    <div className="flex items-start gap-4">
                        {profile.avatarUrl ? (
                            <Image
                                src={profile.avatarUrl}
                                alt={profile.fullName || profile.username || "User"}
                                width={64}
                                height={64}
                                className="w-16 h-16 rounded-full object-cover flex-shrink-0 ring-2 ring-indigo-500/20"
                            />
                        ) : (
                            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-2xl font-semibold flex-shrink-0 ring-2 ring-indigo-500/20">
                                {(profile.fullName || profile.username || "U")[0]?.toUpperCase()}
                            </div>
                        )}
                        <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 truncate text-base">
                                {profile.fullName || profile.username || "User"}
                            </h3>
                            {profile.headline && (
                                <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2 mt-0.5">
                                    {profile.headline}
                                </p>
                            )}
                            {profile.location && (
                                <p className="text-xs text-zinc-500 flex items-center gap-1 mt-1.5">
                                    <MapPin className="w-3 h-3" />
                                    {profile.location}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Recommendation + Mutual */}
                    <div className="flex items-center gap-3 mt-4">
                        {profile.mutualConnections != null && profile.mutualConnections > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-1 rounded-full">
                                <Users className="w-3 h-3" />
                                {profile.mutualConnections} mutual
                            </span>
                        )}
                        {profile.recommendationReason && (
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                💡 {profile.recommendationReason}
                            </span>
                        )}
                    </div>

                    {/* Featured project */}
                    {profile.projects && profile.projects.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                            <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                                <Briefcase className="w-3.5 h-3.5" />
                                <span className="font-medium truncate">{profile.projects[0].title}</span>
                                <span className={cn(
                                    "ml-auto text-[10px] px-1.5 py-0.5 rounded-full capitalize",
                                    profile.projects[0].status === "active"
                                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                        : profile.projects[0].status === "completed"
                                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                                )}>
                                    {profile.projects[0].status || "draft"}
                                </span>
                            </div>
                        </div>
                    )}
                </Link>

                <div className="px-5 pb-5">
                    <button
                        onClick={handleConnect}
                        disabled={isConnecting || localStatus === 'connected' || localStatus === 'pending_sent'}
                        className={cn(
                            "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all",
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

    // ---------- DEFAULT VARIANT ----------
    return (
        <motion.div
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            layout
            className="relative rounded-2xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-zinc-200/60 dark:border-white/5 overflow-hidden hover:shadow-2xl hover:-translate-y-0.5 transition-all duration-300"
        >
            {onDismiss && (
                <AnimatePresence>
                    {isHovered && (
                        <motion.button
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            type="button"
                            onClick={handleDismiss}
                            className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors"
                            aria-label={`Dismiss ${profile.fullName || profile.username || "suggestion"}`}
                        >
                            <X className="w-4 h-4" />
                        </motion.button>
                    )}
                </AnimatePresence>
            )}
            <Link href={profileHref(profile)} className="block p-4">
                {/* Main Content */}
                <div className="flex items-start gap-3">
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

                {/* Tags row: mutual connections + recommendation */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                    {profile.mutualConnections != null && profile.mutualConnections > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 rounded-full">
                            <Users className="w-3 h-3" />
                            {profile.mutualConnections} mutual
                        </span>
                    )}
                    {profile.recommendationReason && (
                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                            💡 {profile.recommendationReason}
                        </span>
                    )}
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
                            <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                                <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                                    <Briefcase className="w-3.5 h-3.5" />
                                    Projects
                                </div>
                                <div className="space-y-1.5">
                                    {profile.projects.slice(0, 3).map((proj) => (
                                        <div key={proj.id} className="flex items-center justify-between text-sm">
                                            <span className="text-zinc-700 dark:text-zinc-300 truncate">
                                                {proj.title}
                                            </span>
                                            <span className={cn(
                                                "text-xs px-2 py-0.5 rounded-full capitalize",
                                                proj.status === "active"
                                                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                                    : proj.status === "completed"
                                                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                                            )}>
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

export default React.memo(PersonCard);
