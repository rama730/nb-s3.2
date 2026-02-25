export type ProfileVisibility = 'public' | 'connections' | 'private' | null | undefined

export function canViewerAccessProfile(
    visibility: ProfileVisibility,
    isOwner: boolean,
    hasAcceptedConnection: boolean
): boolean {
    if (isOwner) return true
    // Secure-by-default: missing visibility should not be treated as public for non-owners.
    if (visibility == null) return false
    if (visibility === 'private') return false
    if (visibility === 'connections') return hasAcceptedConnection
    return true
}
