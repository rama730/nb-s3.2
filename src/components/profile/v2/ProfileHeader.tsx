'use client'

import { useEffect, useState, useMemo } from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { MapPin, Link2, Pencil, MessageSquare, UserPlus, UserCheck, UserMinus, Clock, Shield, Users } from 'lucide-react'
import type { ConnectionState } from './types'
import { createClient } from '@/lib/supabase/client'

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <span
            className={cn(
                'inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800',
                className
            )}
        >
            {children}
        </span>
    )
}

function PrimaryButton({
    children,
    onClick,
    disabled,
    variant = 'solid',
}: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    variant?: 'solid' | 'outline'
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
                'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                variant === 'solid'
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    : 'border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-700'
            )}
        >
            {children}
        </button>
    )
}

export function ProfileHeader({
    profile,
    isOwner,
    isAuthenticated,
    connectionState,
    onEdit,
    onConnectPrimary,
    onConnectSecondary,
    onMessage,
    onInvite,
    isAdaptive = false,
    isLoadingConnection = false,
}: {
    profile: any
    isOwner: boolean
    isAuthenticated: boolean
    connectionState: ConnectionState
    onEdit: () => void
    onConnectPrimary: () => void
    onConnectSecondary?: () => void
    onMessage: () => void
    onInvite: () => void
    isAdaptive?: boolean
    isLoadingConnection?: boolean
}) {
    const supabase = useMemo(() => createClient(), [])
    // CamelCase accessors
    const name = profile?.fullName || profile?.username || 'User'
    const username = profile?.username ? `@${profile.username}` : ''
    const headline = profile?.headline || ''
    const location = profile?.location || ''
    // Fallback to skills if openTo is missing
    const openTo: string[] = Array.isArray(profile?.openTo) ? profile.openTo : (profile?.skills?.slice(0, 5) || [])
    const avatarSrc = profile?.avatarUrl || null

    const [mutual, setMutual] = useState<{ count: number; users: any[] } | null>(null)

    useEffect(() => {
        async function fetchMutual() {
            if (!isAuthenticated || isOwner || !profile?.id) return

            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const { data, error } = await supabase.rpc('get_mutual_connections', {
                p_viewer_id: user.id,
                p_profile_id: profile.id,
            })

            if (!error && data) {
                setMutual(data as any)
            }
        }
        fetchMutual()
    }, [profile?.id, isAuthenticated, isOwner, supabase])

    const connectLabel =
        connectionState === 'accepted'
            ? 'Connected'
            : connectionState === 'pending_outgoing'
                ? 'Requested'
                : connectionState === 'pending_incoming'
                    ? 'Accept'
                    : 'Connect'

    const connectIcon =
        connectionState === 'accepted' ? <UserCheck className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />

    const secondaryConnectLabel =
        connectionState === 'accepted'
            ? 'Disconnect'
            : connectionState === 'pending_outgoing'
                ? 'Cancel'
                : connectionState === 'pending_incoming'
                    ? 'Decline'
                    : null

    const secondaryConnectIcon =
        connectionState === 'accepted' ? <UserMinus className="w-4 h-4" /> : <Clock className="w-4 h-4" />

    return (
        <div className="rounded-3xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
            <div className="px-5 sm:px-8 py-6">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 flex-shrink-0 relative">
                            {avatarSrc && !isAdaptive ? (
                                <Image
                                    src={avatarSrc}
                                    alt={name}
                                    width={96}
                                    height={96}
                                    className="w-full h-full object-cover"
                                    priority={true}
                                />
                            ) : avatarSrc && isAdaptive ? (
                                <Image src={avatarSrc} alt={name} fill className="object-cover" sizes="(max-width: 640px) 80px, 96px" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-xl font-bold text-zinc-700 dark:text-zinc-200">
                                    {String(name).slice(0, 1).toUpperCase()}
                                </div>
                            )}
                        </div>
                        <div className="pb-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900 dark:text-zinc-100">{name}</h1>
                                {username ? <span className="text-sm text-zinc-500 dark:text-zinc-400">{username}</span> : null}
                                {profile?.profileStrength ? (
                                    <Chip className="hidden sm:inline-flex">
                                        <Shield className="w-3.5 h-3.5 mr-1" />
                                        {profile.profileStrength}% complete
                                    </Chip>
                                ) : null}
                            </div>
                            {headline ? <p className="mt-1 text-sm sm:text-base text-zinc-700 dark:text-zinc-300">{headline}</p> : null}

                            {mutual && mutual.count > 0 ? (
                                <div className="mt-2 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                                    <div className="flex -space-x-2">
                                        {mutual.users.map((u) => (
                                            <div key={u.id} className="w-6 h-6 rounded-full border-2 border-white dark:border-zinc-900 overflow-hidden bg-zinc-100 relative">
                                                {u.avatar_url ? ( // Mutual users might be raw snake_case from RPC
                                                    <Image src={u.avatar_url} alt={u.username || 'User'} fill className="object-cover" sizes="24px" />
                                                ) : null}
                                            </div>
                                        ))}
                                    </div>
                                    <span className="ml-1 text-xs">
                                        <Users className="w-3 h-3 inline mr-1" />
                                        {mutual.count} mutual connections
                                    </span>
                                </div>
                            ) : null}

                            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                                {location ? (
                                    <span className="inline-flex items-center gap-1">
                                        <MapPin className="w-4 h-4" />
                                        {location}
                                    </span>
                                ) : null}
                                {profile?.website ? (
                                    <a
                                        href={profile.website}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 hover:text-indigo-600 dark:hover:text-indigo-400"
                                    >
                                        <Link2 className="w-4 h-4" />
                                        {profile.website}
                                    </a>
                                ) : null}
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 pb-1">
                        {isOwner ? (
                            <PrimaryButton onClick={onEdit} variant="outline">
                                <Pencil className="w-4 h-4" />
                                Edit Profile
                            </PrimaryButton>
                        ) : isLoadingConnection ? (
                            <div className="flex gap-2">
                                <div className="h-10 w-28 bg-zinc-200 dark:bg-zinc-800 rounded-xl animate-pulse" />
                                <div className="h-10 w-28 bg-zinc-200 dark:bg-zinc-800 rounded-xl animate-pulse" />
                            </div>
                        ) : (
                            <>
                                <PrimaryButton
                                    onClick={onConnectPrimary}
                                    disabled={!isAuthenticated && connectionState !== 'none'}
                                >
                                    {connectIcon}
                                    {connectLabel}
                                </PrimaryButton>
                                <PrimaryButton onClick={onMessage} variant="outline" disabled={!isAuthenticated}>
                                    <MessageSquare className="w-4 h-4" />
                                    Message
                                </PrimaryButton>
                                <PrimaryButton onClick={onInvite} variant="outline" disabled={!isAuthenticated}>
                                    Invite
                                </PrimaryButton>
                                {secondaryConnectLabel && onConnectSecondary ? (
                                    <PrimaryButton onClick={onConnectSecondary} variant="outline">
                                        {secondaryConnectIcon}
                                        {secondaryConnectLabel}
                                    </PrimaryButton>
                                ) : null}
                            </>
                        )}
                    </div>
                </div>

                {openTo.length ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                        {openTo.slice(0, 8).map((item: string) => (
                            <Chip key={item}>{item}</Chip>
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    )
}
