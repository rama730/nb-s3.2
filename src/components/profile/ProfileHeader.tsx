"use client";

import { MapPin, Globe, Edit2, Share2, MessageCircle, Github, Linkedin, Twitter } from "lucide-react";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { buildIdentityPresentation } from "@/lib/ui/identity";
import type { Profile } from "@/lib/db/schema";

interface ProfileHeaderProps {
    profile: Profile;
    isOwner: boolean;
}

export default function ProfileHeader({ profile, isOwner }: ProfileHeaderProps) {
    const socialLinks = (profile?.socialLinks as Record<string, string>) || {};
    const identity = buildIdentityPresentation(profile);
    const usernameLabel =
        identity.usernameLabel ||
        (typeof profile?.username === "string" && profile.username.trim()
            ? `@${profile.username.trim().replace(/^@+/, "")}`
            : null);

    return (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden mb-6 shadow-sm hover:shadow-md transition-shadow duration-300">
            {/* Profile Info - Clean design without cover image */}
            <div className="p-6">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
                    {/* Avatar and Basic Info */}
                    <div className="flex flex-col sm:flex-row items-start gap-5 flex-1 min-w-0">
                        {/* Avatar */}
                        <div className="relative group">
                            <UserAvatar
                                identity={profile}
                                className="w-24 h-24 sm:w-28 sm:h-28 shadow-xl ring-4 ring-zinc-100 transition-all duration-300 group-hover:scale-105 dark:ring-zinc-800"
                                fallbackClassName="text-2xl sm:text-3xl font-bold text-white"
                            />
                        </div>

                        {/* Name and Info */}
                        <div className="flex-1 min-w-0">
                            <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900 dark:text-white mb-1 truncate">
                                {identity.displayName}
                            </h1>
                            {usernameLabel ? (
                                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">
                                    {usernameLabel}
                                </p>
                            ) : null}
                            {profile?.headline && (
                                <p className="text-base sm:text-lg text-zinc-600 dark:text-zinc-400 mb-3 line-clamp-2">
                                    {profile.headline}
                                </p>
                            )}

                            {/* Location and Website */}
                            <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                                {profile?.location && (
                                    <div className="flex items-center gap-1.5">
                                        <MapPin className="w-4 h-4 flex-shrink-0" />
                                        <span className="truncate">{profile.location}</span>
                                    </div>
                                )}
                                {profile?.website && (
                                    <a
                                        href={profile.website}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1.5 hover:text-primary transition-colors truncate"
                                    >
                                        <Globe className="w-4 h-4 flex-shrink-0" />
                                        <span className="truncate max-w-xs">{profile.website.replace(/^https?:\/\//, "")}</span>
                                    </a>
                                )}
                            </div>

                            {/* Bio */}
                            {profile?.bio && (
                                <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap mb-4 line-clamp-3">
                                    {profile.bio}
                                </p>
                            )}

                            {/* Social Links */}
                            {(socialLinks.github || socialLinks.linkedin || socialLinks.twitter) && (
                                <div className="flex items-center gap-3 flex-wrap mb-4">
                                    {socialLinks.github && (
                                        <a
                                            href={socialLinks.github}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all duration-200 hover:scale-110"
                                        >
                                            <Github className="w-5 h-5" />
                                        </a>
                                    )}
                                    {socialLinks.linkedin && (
                                        <a
                                            href={socialLinks.linkedin}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all duration-200 hover:scale-110"
                                        >
                                            <Linkedin className="w-5 h-5" />
                                        </a>
                                    )}
                                    {socialLinks.twitter && (
                                        <a
                                            href={socialLinks.twitter}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all duration-200 hover:scale-110"
                                        >
                                            <Twitter className="w-5 h-5" />
                                        </a>
                                    )}
                                </div>
                            )}

                            {/* Skills badges */}
                            {profile?.skills && (profile.skills as string[]).length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {(profile.skills as string[]).slice(0, 5).map((skill: string, idx: number) => (
                                        <span
                                            key={idx}
                                            className="px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20 animate-in fade-in slide-in-from-bottom-2 duration-300"
                                            style={{ animationDelay: `${idx * 50}ms` }}
                                        >
                                            {skill}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {isOwner ? (
                            <>
                                <button className="px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all duration-200 flex items-center gap-2 hover:scale-105 active:scale-95">
                                    <Edit2 className="w-4 h-4" />
                                    <span className="hidden sm:inline">Edit Profile</span>
                                </button>
                                <button
                                    className="p-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all duration-200 hover:scale-105 active:scale-95"
                                    aria-label="Share profile"
                                >
                                    <Share2 className="w-4 h-4" />
                                </button>
                            </>
                        ) : (
                            <>
                                <button className="px-4 py-2 rounded-xl app-accent-solid font-semibold transition-[background-color,transform,box-shadow] duration-200 flex items-center gap-2 hover:bg-primary/90 hover:scale-105 active:scale-95 shadow-lg shadow-primary/30">
                                    <MessageCircle className="w-4 h-4" />
                                    <span className="hidden sm:inline">Message</span>
                                </button>
                                <button className="px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all duration-200 hover:scale-105 active:scale-95">
                                    Connect
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
