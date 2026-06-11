import { inngest } from "../client";
import {
  resolveGithubProjectImportQueueAgeMs,
  runGithubProjectImport,
} from "@/lib/github/project-import-runner";

export const projectImport = inngest.createFunction(
  { id: "project-import", concurrency: 5 },
  { event: "project/import" },
  async ({ event, step }) => {
    const { projectId, importSource, userId } = event.data;

    await step.run("clone-and-process", async () =>
      runGithubProjectImport({
        projectId,
        importSource,
        userId,
        importEventId: event.id || null,
        queueAgeMs: resolveGithubProjectImportQueueAgeMs(event),
      }),
    );
  },
);
