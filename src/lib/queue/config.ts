
export const QUEUES = {
    PROJECT_IMPORTS: 'project-imports',
} as const;

export interface ImportJobData {
    projectId: string;
    importSource: {
        type: 'github';
        repoUrl: string;
        branch?: string;
        metadata?: Record<string, any>;
    };
    accessToken?: string; // GitHub Access Token for private repos
    userId: string; // To notify the user
}
