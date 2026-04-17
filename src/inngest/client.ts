
import { Inngest } from "inngest";
import { schemas } from "./types";

const inngestEventKey = process.env.INNGEST_EVENT_KEY?.trim() || "";

if (process.env.NODE_ENV === "production" && !inngestEventKey) {
    throw new Error("INNGEST_EVENT_KEY must be configured in production");
}

export const inngest = new Inngest({
    id: "nb-s3",
    schemas,
    ...(inngestEventKey ? { eventKey: inngestEventKey } : {}),
});
