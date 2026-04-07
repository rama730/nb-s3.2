
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

type AccountCleanupEvent = {
    data: {
        userId: string;
        deletionId: string;
    };
};

type WorkspaceCountersRefreshEvent = {
    data: {
        userId: string;
    };
};

type ConnectionsBulkEvent = {
    data: {
        userId: string;
        action: 'accept' | 'reject';
        limit: number;
        jobId?: string;
    };
};

type ConnectionsSyncSuggestionsEvent = {
    data: {
        userId: string;
    };
};

export const schemas = new EventSchemas().fromRecord<{
    "project/import": ProjectImportEvent;
    "git/push": GitPushEvent;
    "git/pull": GitPullEvent;
    "account/cleanup": AccountCleanupEvent;
    "workspace/counters.refresh": WorkspaceCountersRefreshEvent;
    "workspace/connections.bulk": ConnectionsBulkEvent;
    "workspace/connections.sync_suggestions": ConnectionsSyncSuggestionsEvent;
}>();

