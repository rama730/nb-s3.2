'use client'

import React from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { Ban, Lock, MapPin, Link2, Pencil, MessageSquare, UserPlus, UserCheck, UserMinus, Clock, Shield, Users } from 'lucide-react'
import { buildPrivacyPresentation } from '@/lib/privacy/presentation'
import type { ConnectionState, ProfilePrivacyRelationship } from './types'
import { normalizeProfileVM } from './utils/normalizeProfileVM'

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
            aria-disabled={disabled}
            className={cn(
                'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                variant === 'solid'
                    ? 'app-accent-solid hover:bg-primary/90 transition-[background-color,box-shadow]'
                    : 'border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-700'
            )}
        >
            {children}
        </button>
    )
}

export const ProfileHeader = React.memo(function ProfileHeader({
    profile,
    viewerId,
    isOwner,
    isAuthenticated,
    connectionState,
    onEdit,
    onConnectPrimary,
    onConnectSecondary,
    onMessage,
    onInvite,
    onToggleBlock,
    isAdaptive = false,
    isLoadingConnection = false,
    isBlocking = false,
    mutualCount = 0,
    privacyRelationship,
    lockedShell = false,
}: {
    profile: any
    viewerId?: string | null
    isOwner: boolean
    isAuthenticated: boolean
    connectionState: ConnectionState
    onEdit: () => void
    onConnectPrimary: () => void
    onConnectSecondary?: () => void
    onMessage: () => void
    onInvite: () => void
    onToggleBlock?: () => void
    isAdaptive?: boolean
    isLoadingConnection?: boolean
    isBlocking?: boolean
    mutualCount?: number
    privacyRelationship: ProfilePrivacyRelationship
    lockedShell?: boolean
}) {
    // CamelCase accessors
    const vm = normalizeProfileVM(profile)
    const name = vm.fullName || vm.username || 'User'
    const username = vm.username ? `@${vm.username}` : ''
    const headline = vm.headline || ''
    const location = vm.location || ''
    const openTo = vm.openTo
    const avatarSrc = vm.avatarUrl || null

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

    const blockActionLabel = privacyRelationship.blockedByViewer ? 'Unblock' : 'Block'
    const privacyPresentation = buildPrivacyPresentation({
        viewerId: viewerId ?? null,
        targetUserId: profile.id,
        isSelf: isOwner,
        isConnected: connectionState === 'accepted',
        hasPendingIncomingRequest: connectionState === 'pending_incoming',
        hasPendingOutgoingRequest: connectionState === 'pending_outgoing',
        blockedByViewer: privacyRelationship.blockedByViewer,
        blockedByTarget: privacyRelationship.blockedByTarget,
        profileVisibility: profile.visibility || 'public',
        messagePrivacy: privacyRelationship.canSendMessage ? 'everyone' : 'connections',
        connectionPrivacy: privacyRelationship.canSendConnectionRequest ? 'everyone' : 'nobody',
        canViewProfile: privacyRelationship.canViewProfile,
        canSendConnectionRequest: privacyRelationship.canSendConnectionRequest,
        canSendMessage: privacyRelationship.canSendMessage,
        shouldHideFromDiscovery: false,
        visibilityReason: privacyRelationship.visibilityReason,
        connectionState:
            privacyRelationship.connectionState === 'blocked_by_viewer'
                ? 'blocked_by_viewer'
                : privacyRelationship.connectionState === 'blocked_by_target'
                    ? 'blocked_by_target'
                    : privacyRelationship.connectionState === 'connected'
                        ? 'connected'
                        : privacyRelationship.connectionState === 'pending_incoming'
                            ? 'pending_incoming'
                            : privacyRelationship.connectionState === 'pending_outgoing'
                                ? 'pending_outgoing'
                                : 'none',
        latestConnectionId: null,
    })
    const showConnectAction = !privacyRelationship.blockedByViewer && !privacyRelationship.blockedByTarget
    const canMessage = privacyPresentation.canSendMessage && !privacyRelationship.blockedByViewer && !privacyRelationship.blockedByTarget
    const lockLabel = privacyPresentation.relationshipBadgeText

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
                                    sizes="(max-width: 640px) 80px, 96px"
                                    priority={true}
                                />
                            ) : avatarSrc && isAdaptive ? (
                                <Image src={avatarSrc} alt={name} fill className="object-cover" sizes="(max-width: 640px) 80px, 96px" />
                            ) : (
                                <div className="w-full h-full app-accent-gradient flex items-center justify-center text-xl font-bold text-white">
                                    {String(name).slice(0, 1).toUpperCase()}
                                </div>
                            )}
                        </div>
                        <div className="pb-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900 dark:text-zinc-100">{name}</h1>
                                {username ? <span className="text-sm text-zinc-500 dark:text-zinc-400">{username}</span> : null}
                                {vm.profileStrength ? (
                                    <Chip className="hidden sm:inline-flex">
                                        <Shield className="w-3.5 h-3.5 mr-1" />
                                        {vm.profileStrength}% complete
                                    </Chip>
                                ) : null}
                            </div>
                            {headline ? <p className="mt-1 text-sm sm:text-base text-zinc-700 dark:text-zinc-300">{headline}</p> : null}

                            {mutualCount > 0 ? (
                                <div className="mt-2 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                                    <Users className="w-3 h-3 inline mr-1" />
                                    <span className="text-xs">{mutualCount} mutual connections</span>
                                </div>
                            ) : null}

                            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                                {lockLabel ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                        <Lock className="w-3.5 h-3.5" />
                                        {lockLabel}
                                    </span>
                                ) : null}
                                {location ? (
                                    <span className="inline-flex items-center gap-1">
                                        <MapPin className="w-4 h-4" />
                                        {location}
                                    </span>
                                ) : null}
                                {vm.website ? (
                                    <a
                                        href={vm.website}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 hover:text-primary"
                                    >
                                        <Link2 className="w-4 h-4" />
                                        {vm.website}
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
                                {showConnectAction ? (
                                    <>
                                        <PrimaryButton
                                            onClick={onConnectPrimary}
                                            disabled={!isAuthenticated || (!privacyRelationship.canSendConnectionRequest && connectionState === 'none')}
                                        >
                                            {connectIcon}
                                            {connectLabel}
                                        </PrimaryButton>
                                        <PrimaryButton onClick={onMessage} variant="outline" disabled={!isAuthenticated || !canMessage}>
                                            <MessageSquare className="w-4 h-4" />
                                            Message
                                        </PrimaryButton>
                                        {!lockedShell ? (
                                            <PrimaryButton onClick={onInvite} variant="outline" disabled={!isAuthenticated}>
                                                Invite
                                            </PrimaryButton>
                                        ) : null}
                                        {secondaryConnectLabel && onConnectSecondary ? (
                                            <PrimaryButton onClick={onConnectSecondary} variant="outline">
                                                {secondaryConnectIcon}
                                                {secondaryConnectLabel}
                                            </PrimaryButton>
                                        ) : null}
                                    </>
                                ) : (
                                    <Chip className="border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300">
                                        <Ban className="mr-1 w-3.5 h-3.5" />
                                        {privacyPresentation.blockedBannerText || 'You cannot interact with this account'}
                                    </Chip>
                                )}
                                {isAuthenticated && onToggleBlock && !privacyRelationship.blockedByTarget ? (
                                    <PrimaryButton onClick={onToggleBlock} variant="outline" disabled={isBlocking}>
                                        <Ban className="w-4 h-4" />
                                        {blockActionLabel}
                                    </PrimaryButton>
                                ) : null}
                            </>
                        )}
                    </div>
                </div>

                {!lockedShell && openTo.length ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                        {openTo.slice(0, 8).map((item: string) => (
                            <Chip key={item}>{item}</Chip>
                        ))}
                    </div>
                ) : null}
                {lockedShell ? (
                    <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-300">
                        {privacyRelationship.blockedByViewer
                            ? `${privacyPresentation.blockedBannerText || 'You blocked this account'}. Their profile remains limited until you unblock them.`
                            : privacyRelationship.blockedByTarget
                                ? 'This account is not available for profile viewing or interaction.'
                                : privacyRelationship.visibilityReason === 'connections_only'
                                    ? 'Only accepted connections can view the full profile.'
                                    : 'This account is private. Limited identity is shown until you are allowed to view more.'}
                    </div>
                ) : null}
            </div>
        </div>
    )
})
