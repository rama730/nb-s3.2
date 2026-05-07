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
};

export type ProjectSettingsPreflightInput = {
    status?: "draft" | "active" | "completed" | "archived" | string | null;
    openRolesCount?: number | null;
    pendingApplicationsCount?: number | null;
    activeTasksCount?: number | null;
    canArchive?: boolean | null;
    canDelete?: boolean | null;
};

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
        label: "Roles & Applications",
        description: "Open roles, application intake, and reviewer routing.",
        available: true,
    },
    {
        id: "tasks-workflow",
        label: "Tasks & Workflow",
        description: "Lifecycle stages, task defaults, and workflow guidance.",
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
        description: "Documentation publishing rules for the future README tab.",
        available: false,
        hiddenReason: "README tab is not enforceable yet.",
    },
    {
        id: "updates",
        label: "Updates",
        description: "Project update publishing rules for the future Updates tab.",
        available: false,
        hiddenReason: "Updates tab is not enforceable yet.",
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
        label: "Security & Audit",
        description: "Owner-only actions, audit posture, and permission history.",
        available: true,
    },
    {
        id: "data",
        label: "Data",
        description: "Exportable project settings and future data portability controls.",
        available: true,
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

export function buildProjectRolePolicy(input: {
    isOwner: boolean;
    ownerId?: string | null;
    members?: ProjectSettingsMember[];
}) {
    const members = input.members ?? [];
    const transferCandidates = members.filter((member) => {
        if (!member?.id) return false;
        if (member.id === input.ownerId) return false;
        return member.membershipRole !== "owner";
    });

    const roleCounts = members.reduce<Record<string, number>>((acc, member) => {
        const role = member.membershipRole || (member.id === input.ownerId ? "owner" : "member");
        acc[role] = (acc[role] ?? 0) + 1;
        return acc;
    }, {});

    return {
        canManage: input.isOwner,
        members,
        transferCandidates,
        roleCounts,
        affectedAreas: [
            "Task assignment and ownership routing",
            "Project Files and task Files permissions",
            "Application review and collaborator controls",
            "Danger-zone permissions and audit history",
        ],
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
            "Task-file notes use the task link annotation source of truth",
            "Version history and Open with actions stay on file rows",
            "Folder intake asks before merge/subfolder/replacement decisions",
            "File review notifications target task participants only when responsibility is created",
        ],
        affectedAreas: [
            "Project Files tab",
            "Task panel Files tab",
            "Notification file-review events",
            "Open with defaults and download flows",
        ],
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
