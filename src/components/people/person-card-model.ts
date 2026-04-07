import type { SuggestedProfile } from "@/app/actions/connections";

export type RelationshipState = SuggestedProfile["connectionStatus"] | "blocked";

export type RelationshipMenuActionKey =
    | "message"
    | "view_profile"
    | "invite_to_project"
    | "disconnect";

export type RelationshipMenuAction = {
    key: RelationshipMenuActionKey;
    label: string;
    href?: string;
    destructive?: boolean;
};

export type RelationshipActionModel = {
    state: RelationshipState;
    canConnect: boolean;
    canAccept: boolean;
    isPendingSent: boolean;
    isConnected: boolean;
    canSendMessage: boolean;
    connectedMenu: RelationshipMenuAction[];
    secondaryMenu: RelationshipMenuAction[];
};

export type DiscoverMatchBadge = {
    key: "similar-stack" | "same-location" | "open-to-collaboration" | "mutual-connections";
    label: "Similar stack" | "Same location" | "Open to collaboration" | "Mutual connection";
    tone: "sky" | "violet" | "emerald" | "amber";
};

function normalizeLocation(value: string | null | undefined) {
    return (value || "").trim().toLowerCase();
}

export function buildDiscoverMatchBadges(input: {
    profileSkills?: string[] | null;
    viewerSkills?: string[] | null;
    profileLocation?: string | null;
    viewerLocation?: string | null;
    openTo?: string[] | null;
    mutualConnections?: number | null;
}): DiscoverMatchBadge[] {
    const normalizedViewerSkills = new Set(
        (input.viewerSkills ?? [])
            .map((skill) => skill.trim().toLowerCase())
            .filter(Boolean),
    );
    const hasSimilarStack = (input.profileSkills ?? []).some((skill) =>
        normalizedViewerSkills.has(skill.trim().toLowerCase()),
    );
    const hasSameLocation =
        Boolean(input.viewerLocation)
        && Boolean(input.profileLocation)
        && normalizeLocation(input.viewerLocation) === normalizeLocation(input.profileLocation);
    const hasOpenToCollaboration = (input.openTo?.length ?? 0) > 0;
    const hasMutualConnections = (input.mutualConnections ?? 0) > 0;

    const badges: DiscoverMatchBadge[] = [];
    if (hasSimilarStack) {
        badges.push({ key: "similar-stack", label: "Similar stack", tone: "sky" });
    }
    if (hasSameLocation) {
        badges.push({ key: "same-location", label: "Same location", tone: "violet" });
    }
    if (hasOpenToCollaboration) {
        badges.push({ key: "open-to-collaboration", label: "Open to collaboration", tone: "emerald" });
    }
    if (hasMutualConnections) {
        badges.push({ key: "mutual-connections", label: "Mutual connection", tone: "amber" });
    }

    return badges;
}

export function resolveRelationshipActionModel(input: {
    state: RelationshipState;
    canSendMessage: boolean;
    profileHref: string;
    messageHref: string;
    inviteHref?: string | null;
}): RelationshipActionModel {
    const connectedMenu: RelationshipMenuAction[] = [];
    const secondaryMenu: RelationshipMenuAction[] = [];

    if (input.canSendMessage) {
        connectedMenu.push({ key: "message", label: "Message", href: input.messageHref });
        secondaryMenu.push({ key: "message", label: "Message", href: input.messageHref });
    }

    connectedMenu.push({ key: "view_profile", label: "View profile", href: input.profileHref });
    secondaryMenu.push({ key: "view_profile", label: "View profile", href: input.profileHref });

    if (input.inviteHref) {
        connectedMenu.push({ key: "invite_to_project", label: "Invite to project", href: input.inviteHref });
    }

    if (input.state === "connected") {
        connectedMenu.push({ key: "disconnect", label: "Disconnect", destructive: true });
    }

    return {
        state: input.state,
        canConnect: input.state === "none",
        canAccept: input.state === "pending_received",
        isPendingSent: input.state === "pending_sent",
        isConnected: input.state === "connected",
        canSendMessage: input.canSendMessage,
        connectedMenu,
        secondaryMenu,
    };
}
