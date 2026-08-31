import { inngest } from "../client";
import { startDueSprints } from "@/lib/projects/sprint-schedule";

// Starts are automatic; close-out remains deliberate because it moves work.
export const reconcileSprintSchedule = inngest.createFunction(
  { id: "sprint-schedule", retries: 1, concurrency: { limit: 1 } },
  { cron: "* * * * *" },
  () => startDueSprints(),
);
