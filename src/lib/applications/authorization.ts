const REVIEWER_ROLE_SET = new Set(['owner', 'admin']);

export function isApplicationReviewerRole(role: string | null | undefined): boolean {
    if (!role) return false;
    return REVIEWER_ROLE_SET.has(role.trim().toLowerCase());
}
