
import { EventSchemas } from "inngest";

type ProjectImportEvent = {
    data: {
        projectId: string;
        importSource: {
            type: 'github';
            repoUrl: string;
            branch?: string;
            metadata?: any;
        };
        userId: string;
    };
};

type GitPushEvent = {
    data: {
        projectId: string;
        commitMessage: string;
        userId: string;
    };
};

type GitPullEvent = {
    data: {
        projectId: string;
        userId: string;
        branch?: string | null;
        deliveryId?: string | null;
        afterSha?: string | null;
        source?: "webhook" | "manual" | "system";
    };
};

export const schemas = new EventSchemas().fromRecord<{
    "project/import": ProjectImportEvent;
    "git/push": GitPushEvent;
    "git/pull": GitPullEvent;
}>();
