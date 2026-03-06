"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { MapPin, Briefcase, Loader2, Check, Clock, UserPlus, X, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { profileHref } from "@/lib/routing/identifiers";
import type { SuggestedProfile } from "@/app/actions/connections";

export interface PersonCardProps {
    profile: SuggestedProfile;
    onConnect: (userId: string) => Promise<void>;
    onDismiss?: (userId: string) => Promise<void>;
    isConnecting?: boolean;
    /** Render as either a compact grid card or a full recommended dossier */
    variant?: "compact" | "recommended";
    /** True if this card renders above the fold, forces NextJS priority image loading */
    priority?: boolean;
}

function PersonCard({ profile, onConnect, onDismiss, isConnecting, variant = "compact", priority = false }: PersonCardProps) {
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
                return 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400 cursor-default hover:bg-green-50 dark:hover:bg-green-900/20';
            case 'pending_sent':
                return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 cursor-default hover:bg-zinc-100 dark:hover:bg-zinc-800';
            case 'pending_received':
            default:
                return 'bg-indigo-600 text-white hover:bg-indigo-700'; // Flat indigo matching Hub headers
        }
    };

    const getAvatarRingStyle = () => {
        switch (localStatus) {
            case 'connected': return 'ring-green-500';
            case 'pending_received': return 'ring-indigo-500';
            case 'pending_sent': return 'ring-yellow-500';
            default: return 'ring-zinc-200 dark:ring-zinc-700';
        }
    };

    const isRecommended = variant === "recommended";

    if (isRecommended) {
        return (
            <div className="relative flex flex-col rounded-2xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-zinc-200/60 dark:border-white/5 overflow-hidden transition-all duration-200 hover:border-indigo-500/30">
                
                {/* Header Strip & Dismiss */}
                <div className="flex items-center justify-between px-4 pt-4 pb-2">
                    <span className="text-[10px] font-bold tracking-wider text-indigo-600 dark:text-indigo-400 uppercase">
                        Recommended For You
                    </span>
                    {onDismiss && (
                        <button
                            type="button"
                            onClick={handleDismiss}
                            className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors"
                            aria-label={`Dismiss ${profile.fullName || "suggestion"}`}
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>

                <Link href={profileHref(profile)} className="flex flex-col group/link">
                    {/* Zone 1: Identity */}
                    <div className="px-4 pb-4">
                        <div className="flex items-start gap-4">
                            {profile.avatarUrl ? (
                                <Image
                                    src={profile.avatarUrl}
                                    alt={profile.fullName || profile.username || "User"}
                                    width={56}
                                    height={56}
                                    className={cn("w-14 h-14 rounded-full object-cover flex-shrink-0 ring-2 ring-offset-2 dark:ring-offset-zinc-900", getAvatarRingStyle())}
                                    priority={priority}
                                />
                            ) : (
                                <div className={cn("w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xl font-semibold flex-shrink-0 ring-2 ring-offset-2 dark:ring-offset-zinc-900", getAvatarRingStyle())}>
                                    {(profile.fullName || profile.username || "U")[0]?.toUpperCase()}
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 truncate text-sm group-hover/link:text-indigo-600 dark:group-hover/link:text-indigo-400 transition-colors">
                                    {profile.fullName || profile.username || "User"}
                                </h3>
                                {(profile.username || profile.fullName) && (
                                    <p className="text-xs text-zinc-500 truncate mt-0.5">
                                        @{profile.username || (profile.fullName?.toLowerCase().replace(/\s+/g, ''))}
                                    </p>
                                )}
                                <div className="h-4 mt-1">
                                    {profile.headline ? (
                                        <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-1">
                                            {profile.headline}
                                        </p>
                                    ) : null}
                                </div>
                                <div className="h-4 mt-1">
                                    {profile.location ? (
                                        <p className="text-[11px] text-zinc-500 flex items-center gap-1">
                                            <MapPin className="w-3 h-3" />
                                            {profile.location}
                                        </p>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="h-[1px] bg-zinc-100 dark:bg-zinc-800/50 w-full" />

                    {/* Zone 2: Signals & Connection Strength */}
                    <div className="px-4 py-3 bg-zinc-50/50 dark:bg-zinc-800/20">
                        <div className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider mb-2">Connection Strength</div>
                        <div className="h-[36px] flex flex-col justify-center gap-1.5">
                            {(profile.mutualConnections != null && profile.mutualConnections > 0) || profile.recommendationReason ? (
                                <>
                                    {profile.mutualConnections != null && profile.mutualConnections > 0 && (
                                        <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                                            <Users className="w-3.5 h-3.5 text-indigo-500" />
                                            {profile.mutualConnections} Mutual Connections
                                        </div>
                                    )}
                                    {profile.recommendationReason && (
                                        <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
                                            <span className="text-[10px]">💡</span>
                                            {profile.recommendationReason}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="text-xs text-zinc-400 italic">Suggested by network</div>
                            )}
                        </div>
                    </div>

                    <div className="h-[1px] bg-zinc-100 dark:bg-zinc-800/50 w-full" />

                    {/* Zone 3: Featured Project */}
                    <div className="px-4 py-3">
                         <div className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider mb-2">Current Focus</div>
                         <div className="h-[28px]">
                            {profile.projects && profile.projects.length > 0 ? (
                                <div className="flex items-center justify-between text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-1.5">
                                    <div className="flex items-center gap-1.5 min-w-0 pr-2">
                                        <Briefcase className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                                        <span className="font-medium text-zinc-700 dark:text-zinc-300 truncate">{profile.projects[0].title}</span>
                                    </div>
                                    <span className={cn(
                                        "text-[10px] px-2 py-0.5 rounded-full capitalize whitespace-nowrap flex-shrink-0",
                                        profile.projects[0].status === "active"
                                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                            : profile.projects[0].status === "completed"
                                                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                                    )}>
                                        {profile.projects[0].status || "draft"}
                                    </span>
                                </div>
                            ) : (
                                <div className="text-xs text-zinc-400 italic flex items-center h-full px-1">Available for opportunities</div>
                            )}
                         </div>
                    </div>
                </Link>

                {/* Zone 4: Action */}
                <div className="px-4 pb-4 mt-auto">
                    <button
                        onClick={handleConnect}
                        disabled={isConnecting || localStatus === 'connected' || localStatus === 'pending_sent'}
                        className={cn(
                            "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm ring-1 ring-inset ring-transparent",
                            getButtonStyles(),
                            (isConnecting || localStatus === 'connected' || localStatus === 'pending_sent') && "opacity-90 shadow-none hover:ring-transparent"
                        )}
                    >
                        {getButtonContent()}
                    </button>
                </div>
            </div>
        );
    }

    // ---------- COMPACT VARIANT ----------
    return (
        <div className="relative flex flex-col h-[200px] rounded-2xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-zinc-200/60 dark:border-white/5 overflow-hidden transition-all duration-200 hover:border-indigo-500/30 group">
            <Link href={profileHref(profile)} className="flex-1 flex flex-col p-4 group/link focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500">
                <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                        {profile.avatarUrl ? (
                            <Image
                                src={profile.avatarUrl}
                                alt={profile.fullName || profile.username || "User"}
                                width={48}
                                height={48}
                                className={cn("w-12 h-12 rounded-full object-cover flex-shrink-0 ring-2 ring-offset-2 dark:ring-offset-zinc-900", getAvatarRingStyle())}
                                priority={priority}
                            />
                        ) : (
                            <div className={cn("w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-lg font-bold flex-shrink-0 ring-2 ring-offset-2 dark:ring-offset-zinc-900", getAvatarRingStyle())}>
                                {(profile.fullName || profile.username || "U")[0]?.toUpperCase()}
                            </div>
                        )}
                        
                        <div className="flex-1 min-w-0 pt-0.5 group-hover/link:text-indigo-600 dark:group-hover/link:text-indigo-400 transition-colors">
                            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 truncate text-sm leading-tight pr-6 relative">
                                {profile.fullName || profile.username || "User"}
                                {onDismiss && (
                                    <button
                                        type="button"
                                        onClick={handleDismiss}
                                        className="absolute -right-2 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
                                        aria-label={`Dismiss ${profile.fullName || profile.username || "suggestion"}`}
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </h3>
                            <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                                @{profile.username || (profile.fullName?.toLowerCase().replace(/\s+/g, ''))}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="mt-3 flex-1">
                    <div className="h-[20px]">
                        {profile.headline ? (
                            <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-1">
                                {profile.headline}
                            </p>
                        ) : null}
                    </div>
                    <div className="h-[20px] mt-1">
                        {profile.location ? (
                            <p className="text-[11px] text-zinc-500 flex items-center gap-1">
                                <MapPin className="w-3 h-3" />
                                {profile.location}
                            </p>
                        ) : null}
                    </div>
                </div>
            </Link>

            <div className="px-4 pb-4">
                <button
                    onClick={handleConnect}
                    disabled={isConnecting || localStatus === 'connected' || localStatus === 'pending_sent'}
                    className={cn(
                        "w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-sm ring-1 ring-inset ring-transparent",
                        getButtonStyles(),
                        (isConnecting || localStatus === 'connected' || localStatus === 'pending_sent') && "opacity-90 shadow-none hover:ring-transparent"
                    )}
                >
                    {getButtonContent()}
                </button>
            </div>
        </div>
    );
}

const areCardsEqual = (prevProps: PersonCardProps, nextProps: PersonCardProps) => {
    return (
        prevProps.profile.id === nextProps.profile.id &&
        prevProps.profile.connectionStatus === nextProps.profile.connectionStatus &&
        prevProps.isConnecting === nextProps.isConnecting &&
        prevProps.variant === nextProps.variant
    );
};

export default React.memo(PersonCard, areCardsEqual);
