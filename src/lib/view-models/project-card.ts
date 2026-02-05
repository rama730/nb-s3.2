import { Project } from '@/types/hub';
import { PROJECT_STATUS, ProjectStatus } from '@/constants/hub';
import { formatDistanceToNow } from 'date-fns';

export interface ProjectCardViewModel {
    id: string;
    slug: string | null;
    title: string;
    description: string;
    shortDescription: string | null;
    status: {
        label: string;
        bgClass: string;
        textClass: string;
        gradient: string;
    };
    category: string;
    techStack: string[];
    lastActive: string;
    viewCount: number;

    // Collaborators
    collaborators: Array<{
        full_name?: string | null;
        avatar_url?: string | null;
        username?: string | null;
    }>;

    // Roles
    totalOpenRoles: number;
    openRoles: Array<{
        id: string;
        title: string;
        count: number;
        filled: number;
        available: number;
    }>;
}

const statusConfig = {
    [PROJECT_STATUS.IDEA]: {
        label: 'Idea',
        bgClass: 'bg-yellow-100 dark:bg-yellow-900/30',
        textClass: 'text-yellow-800 dark:text-yellow-200',
        gradient: 'from-yellow-400 to-orange-500',
    },
    [PROJECT_STATUS.IN_PROGRESS]: {
        label: 'In Progress',
        bgClass: 'bg-blue-100 dark:bg-blue-900/30',
        textClass: 'text-blue-800 dark:text-blue-200',
        gradient: 'from-blue-400 to-indigo-500',
    },
    [PROJECT_STATUS.LAUNCHED]: {
        label: 'Launched',
        bgClass: 'bg-green-100 dark:bg-green-900/30',
        textClass: 'text-green-800 dark:text-green-200',
        gradient: 'from-emerald-400 to-green-500',
    },
    // Fallback
    open: {
        label: 'Open',
        bgClass: 'bg-zinc-100 dark:bg-zinc-800',
        textClass: 'text-zinc-800 dark:text-zinc-200',
        gradient: 'from-zinc-400 to-zinc-500',
    },
};

export function toProjectCardViewModel(project: Project): ProjectCardViewModel {
    const extendedProject = project as any; // Handle flexible types

    // Status
    const statusKey = project.status as keyof typeof statusConfig;
    const status = statusConfig[statusKey] || statusConfig.open;

    // Tech Stack
    const techStack = extendedProject.technologies_used || extendedProject.skills || [];

    // Last Active
    const lastActiveDate = extendedProject.updated_at || extendedProject.created_at || new Date().toISOString();

    // Collaborators
    const collaborators = [];
    if (extendedProject.profiles) {
        collaborators.push({
            full_name: extendedProject.profiles.full_name,
            avatar_url: extendedProject.profiles.avatar_url,
            username: extendedProject.profiles.username,
        });
    }

    // Open Roles
    const rawRoles = extendedProject.project_open_roles || [];
    let totalOpenRoles = 0;
    const openRoles = rawRoles.map((role: any) => {
        const available = Math.max(0, (role.count || 0) - (role.filled || 0));
        totalOpenRoles += available;
        return {
            id: role.id,
            title: role.title || role.role || 'Role',
            count: role.count || 0,
            filled: role.filled || 0,
            available,
        };
    }).filter((r: any) => r.available > 0);

    return {
        id: project.id,
        slug: project.slug || null,
        title: project.title,
        description: project.description || '',
        shortDescription: project.short_description || null,
        status,
        category: extendedProject.category || extendedProject.custom_project_type || extendedProject.project_type || 'Project',
        techStack,
        lastActive: lastActiveDate,
        viewCount: project.view_count || 0,
        collaborators,
        totalOpenRoles,
        openRoles,
    };
}
