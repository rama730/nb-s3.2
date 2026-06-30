
import { EventSchemas } from "inngest";
import type { NotificationFanoutEvent } from "@/lib/notifications/types";

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
        jobSignature: string;
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
        jobSignature: string;
    };
};

type AccountCleanupEvent = {
    data: {
        userId: string;
        deletionId: string;
        jobSignature: string;
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

type NotificationFanoutInngestEvent = {
    data: NotificationFanoutEvent;
};

type NotificationDeliveryRefreshEvent = {
    data: {
        userId?: string | null;
        reason?: "snooze_due" | "pause_due" | "quiet_hours_due" | "reconnect" | "manual";
        requestedAt?: string | null;
    };
};

type ProjectUpdateCleanupEvent = {
    data: {
        projectId: string;
        updateId: string;
        media: Array<{
            url?: string | null;
            bucket?: string | null;
            storageKey?: string | null;
        }>;
    };
};

type ProjectDocsCleanupEvent = {
    data: {
        projectId: string;
        assets: Array<{
            id: string;
            bucket: string;
            storageKey: string;
        }>;
    };
};

export const schemas = new EventSchemas().fromRecord<{
    "project/import": ProjectImportEvent;
    "project/import.hydrate": ProjectImportEvent;
    "git/push": GitPushEvent;
    "git/pull": GitPullEvent;
    "account/cleanup": AccountCleanupEvent;
    "workspace/counters.refresh": WorkspaceCountersRefreshEvent;
    "workspace/connections.bulk": ConnectionsBulkEvent;
    "workspace/connections.sync_suggestions": ConnectionsSyncSuggestionsEvent;
    "notification/fanout": NotificationFanoutInngestEvent;
    "notification/burst": NotificationFanoutInngestEvent;
    "notification/delivery.refresh": NotificationDeliveryRefreshEvent;
    "project/updates.cleanup": ProjectUpdateCleanupEvent;
    "project/docs.cleanup": ProjectDocsCleanupEvent;
}>();
