export function isProjectGuidanceInvitationEnabled() {
    const value = process.env.NEXT_PUBLIC_PROJECT_GUIDANCE_INVITATIONS;
    return value !== "0" && value !== "false";
}
