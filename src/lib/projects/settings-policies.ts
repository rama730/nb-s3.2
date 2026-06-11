import {
    formatProjectVisibility,
    normalizeProjectVisibility as normalizeCanonicalProjectVisibility,
    type ProjectVisibility,
} from "@/lib/projects/project-visibility";

export type ProjectSettingsVisibility = ProjectVisibility;

export type ProjectSettingsSectionId =
    | "general"
    | "access"
    | "collaborators"
    | "roles-applications"
    | "tasks-workflow"
    | "files-workspace"
    | "readme"
    | "updates"
    | "notifications"
    | "automation"
    | "security-audit"
    | "data"
    | "danger";

export type ProjectSettingsSectionDefinition = {
    id: ProjectSettingsSectionId;
    label: string;
    description: string;
    available: boolean;
    hiddenReason?: string;
};

export type ProjectSettingsMember = {
    id: string;
    fullName?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
    membershipRole?: "owner" | "admin" | "member" | "viewer" | string | null;
    projectRoleTitle?: string | null;
    joinedAt?: string | null;
    fileUploadEnabled?: boolean | null;
    responsibilityCounts?: ProjectMemberResponsibilityCounts | null;
};

export type ProjectMemberRole = "owner" | "admin" | "member" | "viewer";

export type ProjectPublicTabId = "dashboard" | "readme" | "updates" | "sprints" | "tasks" | "analytics" | "files";

export type ProjectPublicTabVisibility = Record<ProjectPublicTabId, boolean>;

export type ProjectMemberCapability =
    | "transfer_ownership"
    | "archive_project"
    | "delete_project"
    | "manage_settings"
    | "manage_public_tabs"
    | "manage_notifications"
    | "manage_collaborators"
    | "manage_roles_applications"
    | "manage_tasks"
    | "manage_files"
    | "review_applications"
    | "assign_tasks"
    | "create_tasks"
    | "upload_files"
    | "comment";

export type ProjectMemberEligibility = "mention" | "assign" | "review";

export type ProjectMemberResponsibilityCounts = {
    activeAssignedTasks: number;
    activeCreatedTasks: number;
    fileReviews: number;
    acceptedApplications: number;
    projectGroupParticipant: boolean;
};

export type ProjectPersonReferenceState =
    | "active_member"
    | "owner"
    | "co_leader"
    | "viewer"
    | "pending_invite"
    | "former_member"
    | "lost_access"
    | "deactivated_user"
    | "unknown_user"
    | "external_user";

export type ProjectPersonReference = {
    id: string | null;
    displayName: string;
    avatarUrl: string | null;
    roleLabel: string;
    subtext: string | null;
    state: ProjectPersonReferenceState;
    isAssignable: boolean;
    isMentionable: boolean;
    canOpenProfile: boolean;
};

export type ProjectSettingsPreflightInput = {
    status?: "draft" | "active" | "completed" | "archived" | string | null;
    openRolesCount?: number | null;
    pendingApplicationsCount?: number | null;
    activeTasksCount?: number | null;
    canArchive?: boolean | null;
    canDelete?: boolean | null;
};

export type ProjectAccessImpactInput = {
    visibility?: unknown;
    membersCount?: number | null;
    followersCount?: number | null;
    openRolesCount?: number | null;
    pendingApplicationsCount?: number | null;
    activeTasksCount?: number | null;
};

export type ProjectAccessTransitionInput = ProjectAccessImpactInput & {
    previousVisibility?: unknown;
    nextVisibility?: unknown;
    hasManagedProjectImage?: boolean | null;
};

export type ProjectMemberRemovalPreflightInput = {
    member?: ProjectSettingsMember | null;
    visibility?: unknown;
    activeAssignedTasks?: number | null;
    activeCreatedTasks?: number | null;
    fileReviews?: number | null;
    acceptedApplications?: number | null;
    projectGroupParticipant?: boolean | null;
};

export const PROJECT_MEMBER_ROLE_LABELS: Record<ProjectMemberRole, string> = {
    owner: "Lead",
    admin: "Co-leader",
    member: "Member",
    viewer: "Viewer",
};

export const PROJECT_MEMBER_ROLE_DESCRIPTIONS: Record<ProjectMemberRole, string> = {
    owner: "Single accountable lead with transfer, archive, delete, and all settings permissions.",
    admin: "Co-leader with collaborator, role/application, task, file, and workflow management.",
    member: "Contributor who can participate in project work by policy.",
    viewer: "Read-focused participant without task assignment or edit rights.",
};

export const PROJECT_MEMBER_ROLE_CAPABILITIES: Record<ProjectMemberRole, ProjectMemberCapability[]> = {
    owner: [
        "transfer_ownership",
        "archive_project",
        "delete_project",
        "manage_settings",
        "manage_public_tabs",
        "manage_notifications",
        "manage_collaborators",
        "manage_roles_applications",
        "manage_tasks",
        "manage_files",
        "review_applications",
        "assign_tasks",
        "create_tasks",
        "upload_files",
        "comment",
    ],
    admin: [
        "manage_public_tabs",
        "manage_notifications",
        "manage_collaborators",
        "manage_roles_applications",
        "manage_tasks",
        "manage_files",
        "review_applications",
        "assign_tasks",
        "create_tasks",
        "upload_files",
        "comment",
    ],
    member: ["assign_tasks", "create_tasks", "upload_files", "comment"],
    viewer: ["comment"],
};

export const DEFAULT_PROJECT_PUBLIC_TAB_VISIBILITY: ProjectPublicTabVisibility = {
    dashboard: true,
    readme: true,
    updates: true,
    files: true,
    sprints: false,
    tasks: false,
    analytics: false,
};

export const PROJECT_PUBLIC_TAB_LABELS: Record<ProjectPublicTabId, string> = {
    dashboard: "Dashboard",
    readme: "README",
    updates: "Updates",
    files: "Files",
    sprints: "Sprints",
    tasks: "Tasks",
    analytics: "Analytics",
};

export const PROJECT_PUBLIC_TAB_DESCRIPTIONS: Record<ProjectPublicTabId, string> = {
    dashboard: "Public project overview, summary, roles, team preview, and high-level progress.",
    readme: "Published project documentation, setup notes, screenshots, commands, and contribution guidance.",
    updates: "Public progress posts, milestone notes, releases, blockers, and follower-facing discussion.",
    files: "Public project files and shared workspace materials that are safe for visitors.",
    sprints: "Sprint history and planning details, usually best kept member-only.",
    tasks: "Task board and work execution details, usually best kept member-only.",
    analytics: "Project analytics and operational metrics, usually best kept member-only.",
};

export function normalizeProjectMemberRole(value: unknown, fallback: ProjectMemberRole = "member"): ProjectMemberRole {
    return value === "owner" || value === "admin" || value === "member" || value === "viewer"
        ? value
        : fallback;
}

export function getProjectMemberRoleLabel(role: unknown) {
    return PROJECT_MEMBER_ROLE_LABELS[normalizeProjectMemberRole(role)] ?? "Member";
}

export function projectMemberCan(role: unknown, capability: ProjectMemberCapability) {
    return PROJECT_MEMBER_ROLE_CAPABILITIES[normalizeProjectMemberRole(role)].includes(capability);
}

export function canProjectMemberUploadFiles(input: { role?: unknown; fileUploadEnabled?: boolean | null }) {
    const role = input.role;
    if (role === "owner" || role === "admin") return true;
    if (role === "viewer") return false;
    if (role !== "member") return false;
    return input.fileUploadEnabled !== false;
}

export function normalizeProjectPublicTabVisibility(value: unknown): ProjectPublicTabVisibility {
    const source = value && typeof value === "object" ? value as Partial<Record<ProjectPublicTabId, unknown>> : {};
    return {
        dashboard: typeof source.dashboard === "boolean" ? source.dashboard : DEFAULT_PROJECT_PUBLIC_TAB_VISIBILITY.dashboard,
        readme: typeof source.readme === "boolean" ? source.readme : DEFAULT_PROJECT_PUBLIC_TAB_VISIBILITY.readme,
        updates: typeof source.updates === "boolean" ? source.updates : DEFAULT_PROJECT_PUBLIC_TAB_VISIBILITY.updates,
        files: typeof source.files === "boolean" ? source.files : DEFAULT_PROJECT_PUBLIC_TAB_VISIBILITY.files,
        sprints: typeof source.sprints === "boolean" ? source.sprints : DEFAULT_PROJECT_PUBLIC_TAB_VISIBILITY.sprints,
        tasks: typeof source.tasks === "boolean" ? source.tasks : DEFAULT_PROJECT_PUBLIC_TAB_VISIBILITY.tasks,
        analytics: typeof source.analytics === "boolean" ? source.analytics : DEFAULT_PROJECT_PUBLIC_TAB_VISIBILITY.analytics,
    };
}

export function areProjectPublicTabVisibilitiesEqual(left: unknown, right: unknown) {
    const normalizedLeft = normalizeProjectPublicTabVisibility(left);
    const normalizedRight = normalizeProjectPublicTabVisibility(right);
    return (Object.keys(DEFAULT_PROJECT_PUBLIC_TAB_VISIBILITY) as ProjectPublicTabId[])
        .every((tabId) => normalizedLeft[tabId] === normalizedRight[tabId]);
}

export function isProjectTabVisibleToViewer(input: {
    tabId: string;
    isOwnerOrMember: boolean;
    canManageSettings?: boolean;
    publicTabVisibility?: unknown;
}) {
    if (input.tabId === "settings") return Boolean(input.canManageSettings);
    if (input.isOwnerOrMember) return true;
    if (!(input.tabId in DEFAULT_PROJECT_PUBLIC_TAB_VISIBILITY)) return false;
    return normalizeProjectPublicTabVisibility(input.publicTabVisibility)[input.tabId as ProjectPublicTabId];
}

export function resolveAllowedProjectTab(input: {
    requestedTab?: string | null;
    isOwnerOrMember: boolean;
    canManageSettings?: boolean;
    publicTabVisibility?: unknown;
}) {
    const requestedTab = input.requestedTab?.trim() || "dashboard";
    if (isProjectTabVisibleToViewer({ ...input, tabId: requestedTab })) return requestedTab;
    if (isProjectTabVisibleToViewer({ ...input, tabId: "dashboard" })) return "dashboard";
    if (isProjectTabVisibleToViewer({ ...input, tabId: "files" })) return "files";
    return "dashboard";
}

export function isAssignableProjectMember(role: unknown) {
    const normalized = normalizeProjectMemberRole(role);
    return normalized !== "viewer";
}

export function isEligibleProjectMember(role: unknown, eligibility: ProjectMemberEligibility) {
    const normalized = normalizeProjectMemberRole(role);
    if (eligibility === "mention") return true;
    if (eligibility === "assign" || eligibility === "review") return normalized !== "viewer";
    return false;
}

export function buildProjectPersonReference(input: {
    person?: {
        id?: string | null;
        fullName?: string | null;
        username?: string | null;
        avatarUrl?: string | null;
    } | null;
    membershipRole?: unknown;
    isActiveMember?: boolean;
    isPendingInvite?: boolean;
    hasLostAccess?: boolean;
    isDeactivated?: boolean;
    isExternal?: boolean;
}): ProjectPersonReference {
    const person = input.person ?? null;
    const id = person?.id?.trim() || null;
    const displayName = person?.fullName?.trim() || person?.username?.trim() || (id ? "Project member" : "User unavailable");
    const avatarUrl = person?.avatarUrl?.trim() || null;
    const role = normalizeProjectMemberRole(input.membershipRole, "member");
    const isActiveMember = Boolean(input.isActiveMember);

    if (input.isDeactivated) {
        return {
            id,
            displayName,
            avatarUrl,
            roleLabel: "Unavailable",
            subtext: "Account unavailable",
            state: "deactivated_user",
            isAssignable: false,
            isMentionable: false,
            canOpenProfile: false,
        };
    }
    if (!id) {
        return {
            id: null,
            displayName,
            avatarUrl: null,
            roleLabel: "Unavailable",
            subtext: "User unavailable",
            state: "unknown_user",
            isAssignable: false,
            isMentionable: false,
            canOpenProfile: false,
        };
    }
    if (input.isPendingInvite) {
        return {
            id,
            displayName,
            avatarUrl,
            roleLabel: "Pending",
            subtext: "Invite pending",
            state: "pending_invite",
            isAssignable: false,
            isMentionable: false,
            canOpenProfile: true,
        };
    }
    if (input.hasLostAccess) {
        return {
            id,
            displayName,
            avatarUrl,
            roleLabel: "No access",
            subtext: "No longer has project access",
            state: "lost_access",
            isAssignable: false,
            isMentionable: false,
            canOpenProfile: true,
        };
    }
    if (!isActiveMember) {
        return {
            id,
            displayName,
            avatarUrl,
            roleLabel: "Former collaborator",
            subtext: "Removed from project",
            state: input.isExternal ? "external_user" : "former_member",
            isAssignable: false,
            isMentionable: false,
            canOpenProfile: true,
        };
    }

    const state: ProjectPersonReferenceState =
        role === "owner" ? "owner" : role === "admin" ? "co_leader" : role === "viewer" ? "viewer" : "active_member";
    return {
        id,
        displayName,
        avatarUrl,
        roleLabel: PROJECT_MEMBER_ROLE_LABELS[role],
        subtext: role === "admin" ? "Co-leader" : role === "viewer" ? "Viewer" : null,
        state,
        isAssignable: isAssignableProjectMember(role),
        isMentionable: true,
        canOpenProfile: true,
    };
}

function formatCount(count: number | null | undefined, singular: string, plural = `${singular}s`) {
    const value = Math.max(0, Math.trunc(Number(count ?? 0)));
    return `${value} ${value === 1 ? singular : plural}`;
}

export const PROJECT_SETTINGS_SECTIONS: ProjectSettingsSectionDefinition[] = [
    {
        id: "general",
        label: "General",
        description: "Project identity, collaboration intent, and public-facing summary.",
        available: true,
    },
    {
        id: "access",
        label: "Access",
        description: "Visibility, discovery, sharing, and follower-facing access behavior.",
        available: true,
    },
    {
        id: "collaborators",
        label: "Collaborators",
        description: "Member visibility, roles, and ownership readiness.",
        available: true,
    },
    {
        id: "roles-applications",
        label: "Project Roles Editor",
        description: "Open roles, application intake, and reviewer routing.",
        available: true,
    },
    {
        id: "tasks-workflow",
        label: "Project Lifecycle",
        description: "Journey stages, task defaults, and workflow guidance.",
        available: true,
    },
    {
        id: "files-workspace",
        label: "Files & Workspace",
        description: "File intake, version behavior, reviews, and open-with guidance.",
        available: true,
    },
    {
        id: "readme",
        label: "README",
        description: "Documentation publishing rules, media policy, and smart blocks.",
        available: true,
    },
    {
        id: "updates",
        label: "Updates",
        description: "Project update publishing, visibility, follower notifications, and discussion rules.",
        available: true,
    },
    {
        id: "notifications",
        label: "Notifications",
        description: "Project event categories and member/follower attention rules.",
        available: true,
    },
    {
        id: "automation",
        label: "Automation",
        description: "Stale-work reminders and cadence automation.",
        available: false,
        hiddenReason: "Automation rules are not enforceable yet.",
    },
    {
        id: "security-audit",
        label: "Security & Data",
        description: "Recent settings audit, protected actions, and project data export.",
        available: true,
    },
    {
        id: "data",
        label: "Data",
        description: "Exportable project settings and future data portability controls.",
        available: false,
        hiddenReason: "Merged into Security & Data.",
    },
    {
        id: "danger",
        label: "Danger Zone",
        description: "Archive, transfer ownership, and delete with preflight checks.",
        available: true,
    },
];

export function getVisibleProjectSettingsSections() {
    return PROJECT_SETTINGS_SECTIONS.filter((section) => section.available);
}

export const normalizeProjectVisibility = normalizeCanonicalProjectVisibility;

export function buildProjectAccessPolicy(project: { visibility?: unknown } | null | undefined) {
    const visibility = normalizeProjectVisibility(project?.visibility);
    const affectedAreasByVisibility: Record<ProjectSettingsVisibility, string[]> = {
        public: [
            "Project cards, Hub discovery, search, and public profile references can show the project",
            "Shared links can show the project title, description, and project image preview",
            "Followers may receive public project updates when an update creates attention",
            "README, Updates, Files, and Applications inherit their own public/member-safe access checks",
        ],
        private: [
            "Only the owner and approved project members can open project detail surfaces",
            "Hub discovery, public search, public profile cards, and anonymous metadata hide the project",
            "Shared links resolve only for members; outsiders get a safe unavailable response",
            "Files, tasks, README, Updates, applications, and notifications use member-only access",
        ],
    };

    return {
        visibility,
        label: formatProjectVisibility(visibility),
        affectedAreas: affectedAreasByVisibility[visibility],
        viewerRows: [
            {
                viewer: "Owner",
                publicAccess: "Full access",
                privateAccess: "Full access",
            },
            {
                viewer: "Approved members",
                publicAccess: "Can view and collaborate by role",
                privateAccess: "Can view and collaborate by role",
            },
            {
                viewer: "Followers",
                publicAccess: "Can discover and receive public updates",
                privateAccess: "Hidden unless also a member",
            },
            {
                viewer: "Pending applicants",
                publicAccess: "Can view public context and their application flow",
                privateAccess: "Only their application/conversation stays available",
            },
            {
                viewer: "Anyone with the link",
                publicAccess: "Can open public project pages and share previews",
                privateAccess: "Cannot view project content or metadata",
            },
        ],
        summary:
            visibility === "private"
                ? "Member-only project access is enforced across project surfaces."
                : "The project is discoverable and visible to everyone.",
    };
}

export function buildProjectAccessImpact(input: ProjectAccessImpactInput | null | undefined) {
    const visibility = normalizeProjectVisibility(input?.visibility);
    const membersCount = Math.max(0, Math.trunc(Number(input?.membersCount ?? 0)));
    const followersCount = Math.max(0, Math.trunc(Number(input?.followersCount ?? 0)));
    const openRolesCount = Math.max(0, Math.trunc(Number(input?.openRolesCount ?? 0)));
    const pendingApplicationsCount = Math.max(0, Math.trunc(Number(input?.pendingApplicationsCount ?? 0)));
    const activeTasksCount = Math.max(0, Math.trunc(Number(input?.activeTasksCount ?? 0)));

    const metrics = [
        { label: "Approved members", value: membersCount, detail: "Keep access in both Public and Private." },
        { label: "Followers", value: followersCount, detail: visibility === "private" ? "Lose public discovery and update visibility unless they are members." : "Can discover public project updates." },
        { label: "Open roles", value: openRolesCount, detail: visibility === "private" ? "Hidden from public application intake." : "Visible in public application intake." },
        { label: "Pending applications", value: pendingApplicationsCount, detail: "Keep their own application/conversation context where available." },
        { label: "Active tasks", value: activeTasksCount, detail: "Remain member-only work surfaces when private." },
    ];

    const transitionChecklist = visibility === "private"
        ? [
            "Hide the project from Hub discovery, public search, and public profile project cards.",
            "Return safe unavailable metadata for anonymous shared links.",
            "Keep owner and approved member access unchanged.",
            "Keep pending applicant context limited to their own application or conversation.",
            "Keep files, tasks, README, Updates, and notifications behind member-safe access checks.",
        ]
        : [
            "Restore Hub discovery, public search, and public profile project cards.",
            "Allow shared links to show project title, description, and project image metadata.",
            "Keep write access role-based; Public does not grant edit rights.",
            "Allow open roles and applications to be discovered publicly.",
            "Keep files/tasks governed by their own member-safe controls where required.",
        ];

    const summary = visibility === "private"
        ? [
            `${formatCount(membersCount, "member")} keep project access.`,
            `${formatCount(followersCount, "follower")} lose public discovery unless already members.`,
            `${formatCount(openRolesCount, "open role")} are hidden from public intake.`,
        ]
        : [
            `${formatCount(followersCount, "follower")} can discover public updates.`,
            `${formatCount(openRolesCount, "open role")} can appear in public intake.`,
            `${formatCount(membersCount, "member")} keep their existing roles.`,
        ];

    return {
        visibility,
        metrics,
        transitionChecklist,
        summary,
        pendingApplicationsCount,
        activeTasksCount,
    };
}

export function buildProjectAccessTransitionPolicy(input: ProjectAccessTransitionInput | null | undefined) {
    const previousVisibility = normalizeProjectVisibility(input?.previousVisibility);
    const nextVisibility = normalizeProjectVisibility(input?.nextVisibility ?? input?.visibility);
    const impact = buildProjectAccessImpact({ ...input, visibility: nextVisibility });
    const direction = `${previousVisibility}_to_${nextVisibility}` as const;
    const hasManagedProjectImage = Boolean(input?.hasManagedProjectImage);

    const requiresConfirmation = previousVisibility !== nextVisibility;
    const riskLabel = nextVisibility === "private"
        ? "Private conversion"
        : nextVisibility === "public"
            ? "Public conversion"
            : "No visibility change";

    const irreversibleNotes = nextVisibility === "private"
        ? [
            "Anonymous project metadata is replaced with safe unavailable copy.",
            hasManagedProjectImage
                ? "The project image is served only through the visibility-aware project image route."
                : "Legacy public image URLs are hidden from public metadata.",
            "Existing external social previews may stay cached outside this app.",
        ]
        : [
            "Project title, description, and image route become public share metadata.",
            "Open roles and application intake become discoverable again.",
            "Followers can discover public updates again.",
        ];

    return {
        previousVisibility,
        nextVisibility,
        direction,
        requiresConfirmation,
        riskLabel,
        confirmationSummary: impact.summary,
        metrics: impact.metrics,
        transitionChecklist: impact.transitionChecklist,
        irreversibleNotes,
    };
}

export function buildProjectRolePolicy(input: {
    isOwner: boolean;
    actorRole?: ProjectMemberRole | null;
    ownerId?: string | null;
    members?: ProjectSettingsMember[];
}) {
    const members = input.members ?? [];
    const normalizedMembers = members.map((member) => ({
        ...member,
        membershipRole: member.id === input.ownerId
            ? "owner"
            : normalizeProjectMemberRole(member.membershipRole, "member"),
    }));
    const transferCandidates = normalizedMembers.filter((member) => {
        if (!member?.id) return false;
        if (member.id === input.ownerId) return false;
        return member.membershipRole !== "owner";
    });

    const roleCounts = normalizedMembers.reduce<Record<ProjectMemberRole, number>>((acc, member) => {
        const role = normalizeProjectMemberRole(member.membershipRole, member.id === input.ownerId ? "owner" : "member");
        acc[role] = (acc[role] ?? 0) + 1;
        return acc;
    }, { owner: 0, admin: 0, member: 0, viewer: 0 });

    const owner = normalizedMembers.find((member) => member.id === input.ownerId || member.membershipRole === "owner") ?? null;
    const coLeaders = normalizedMembers.filter((member) => member.membershipRole === "admin");
    const contributors = normalizedMembers.filter((member) => member.membershipRole === "member");
    const viewers = normalizedMembers.filter((member) => member.membershipRole === "viewer");

    const actorRole = input.isOwner ? "owner" : normalizeProjectMemberRole(input.actorRole, "member");

    return {
        canManage: input.isOwner || actorRole === "admin",
        actorRole,
        members: normalizedMembers,
        owner,
        coLeaders,
        contributors,
        viewers,
        transferCandidates,
        roleCounts,
        roleLabels: PROJECT_MEMBER_ROLE_LABELS,
        capabilityMatrix: PROJECT_MEMBER_ROLE_CAPABILITIES,
        affectedAreas: [
            "Task assignment and ownership routing",
            "Project Files and task Files permissions",
            "Application review and collaborator controls",
            "Danger-zone permissions and audit history",
        ],
    };
}

export function buildProjectMemberMutationPolicy(input: {
    actorIsOwner: boolean;
    actorRole?: ProjectMemberRole | null;
    ownerId?: string | null;
    targetUserId?: string | null;
    targetRole?: unknown;
    nextRole?: unknown;
}) {
    const actorRole = input.actorIsOwner ? "owner" : normalizeProjectMemberRole(input.actorRole, "member");
    const targetRole = normalizeProjectMemberRole(input.targetRole, input.targetUserId === input.ownerId ? "owner" : "member");
    const nextRole = input.nextRole === undefined ? null : normalizeProjectMemberRole(input.nextRole, "member");
    const isSelfOwnerTarget = Boolean(input.ownerId && input.targetUserId && input.ownerId === input.targetUserId);
    const ownerCanManageTarget = Boolean(input.actorIsOwner && input.targetUserId && !isSelfOwnerTarget && targetRole !== "owner");
    const coLeaderCanManageTarget = Boolean(
        !input.actorIsOwner &&
        actorRole === "admin" &&
        input.targetUserId &&
        !isSelfOwnerTarget &&
        (targetRole === "member" || targetRole === "viewer") &&
        (!nextRole || nextRole === "member" || nextRole === "viewer"),
    );
    const canManageTarget = ownerCanManageTarget || coLeaderCanManageTarget;
    return {
        actorRole,
        targetRole,
        canPromoteToCoLeader: ownerCanManageTarget && targetRole !== "admin",
        canChangeRole: canManageTarget,
        canRemove: canManageTarget,
        canTransferOwnership: Boolean(input.actorIsOwner && input.targetUserId && !isSelfOwnerTarget),
        blockedReason: !input.actorIsOwner && actorRole !== "admin"
            ? "Only the project owner or a Co-leader can manage collaborators."
            : isSelfOwnerTarget || targetRole === "owner"
                ? "Ownership changes must use the transfer ownership flow."
                : actorRole === "admin" && (targetRole === "admin" || nextRole === "admin")
                    ? "Co-leaders can manage members and viewers, but not other Co-leaders."
                : null,
    };
}

export function buildProjectMemberRemovalPreflight(input: ProjectMemberRemovalPreflightInput | null | undefined) {
    const member = input?.member ?? null;
    const activeAssignedTasks = Math.max(0, Math.trunc(Number(input?.activeAssignedTasks ?? 0)));
    const activeCreatedTasks = Math.max(0, Math.trunc(Number(input?.activeCreatedTasks ?? 0)));
    const fileReviews = Math.max(0, Math.trunc(Number(input?.fileReviews ?? 0)));
    const acceptedApplications = Math.max(0, Math.trunc(Number(input?.acceptedApplications ?? 0)));
    const projectGroupParticipant = Boolean(input?.projectGroupParticipant);
    const visibility = normalizeProjectVisibility(input?.visibility);
    const displayName = member ? getProjectMemberDisplayName(member) : "This member";
    const affectedAreas = [
        activeAssignedTasks > 0
            ? `${formatCount(activeAssignedTasks, "active assigned task")} will keep ${displayName} as historical assignee and show Needs reassignment.`
            : "No active assigned tasks.",
        activeCreatedTasks > 0
            ? `${formatCount(activeCreatedTasks, "active created task")} keep their creator history.`
            : "No active created tasks.",
        fileReviews > 0
            ? `${formatCount(fileReviews, "file review")} keep historical context.`
            : "No active file review markers.",
        acceptedApplications > 0
            ? `${formatCount(acceptedApplications, "accepted role")} may update role capacity after removal.`
            : "No accepted role capacity impact found.",
        projectGroupParticipant
            ? "Project group conversation access will be removed."
            : "No project group conversation participant row found.",
        visibility === "private"
            ? "Private project access is revoked immediately."
            : "Public project pages may remain visible, but member-only controls are revoked.",
    ];
    const warnings = affectedAreas.filter((item) => !item.startsWith("No "));

    return {
        displayName,
        activeAssignedTasks,
        activeCreatedTasks,
        fileReviews,
        acceptedApplications,
        projectGroupParticipant,
        visibility,
        warnings,
        affectedAreas,
        defaultMode: "preserve_history" as const,
        summary: warnings.length > 0
            ? `${displayName} can be removed safely, but ${warnings.length} affected area${warnings.length === 1 ? "" : "s"} should be reviewed.`
            : `${displayName} can be removed with no active responsibility blockers.`,
    };
}

export function buildProjectNotificationPolicy() {
    return {
        categories: [
            "Updates that create follower/member attention",
            "Task assignment, blocked, and done events",
            "File version, replacement, and review events",
            "Role/application decisions and workflow requests",
        ],
        affectedAreas: [
            "Notification tray and toast policy",
            "Task panel activity and comments",
            "Applications and collaborator flows",
            "Project follower update routing",
        ],
        summary: "Project notifications stay event-based; personal delivery channels stay in global notification settings.",
    };
}

export function buildProjectFilePolicy() {
    return {
        enforcedRules: [
            "Owners and Co-leaders can always upload, replace, organize, and review project files.",
            "Members can upload files only when their per-member upload toggle is on.",
            "Viewers can inspect allowed file surfaces but cannot upload or replace files.",
            "Task-file notes use the task link annotation source of truth.",
            "Version history and Open with actions stay on file rows.",
            "File review notifications target task participants only when responsibility is created.",
        ],
        affectedAreas: [
            "Project Files tab",
            "Task panel Files tab",
            "Direct upload URLs and batch upload URLs",
            "Folder/file creation and file version replacement",
            "Notification file-review events",
            "Open with defaults and download flows",
        ],
        uploadPolicySummary: "File upload permission is checked in server actions before signed URLs, file rows, folders, or replacement versions are created.",
    };
}

export function buildProjectSettingsPreflight(input: ProjectSettingsPreflightInput | null | undefined) {
    const status = input?.status === "active" || input?.status === "completed" || input?.status === "archived"
        ? input.status
        : "draft";
    const openRolesCount = Number(input?.openRolesCount ?? 0);
    const pendingApplicationsCount = Number(input?.pendingApplicationsCount ?? 0);
    const activeTasksCount = Number(input?.activeTasksCount ?? 0);

    return {
        status,
        openRolesCount,
        pendingApplicationsCount,
        activeTasksCount,
        canArchive: input?.canArchive ?? status !== "archived",
        canDelete: input?.canDelete === true,
        affectedAreas: [
            openRolesCount > 0 ? `${openRolesCount} open role${openRolesCount === 1 ? "" : "s"}` : "No open roles",
            pendingApplicationsCount > 0
                ? `${pendingApplicationsCount} pending application${pendingApplicationsCount === 1 ? "" : "s"}`
                : "No pending applications",
            activeTasksCount > 0
                ? `${activeTasksCount} active task${activeTasksCount === 1 ? "" : "s"}`
                : "No active tasks",
        ],
    };
}

export function getProjectMemberDisplayName(member: ProjectSettingsMember) {
    return member.fullName || member.username || "Project member";
}
