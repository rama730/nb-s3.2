
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
        accessToken?: string;
    };
};

export const schemas = new EventSchemas().fromRecord<{
    "project/import": ProjectImportEvent;
}>();
