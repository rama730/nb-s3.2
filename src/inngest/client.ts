
import { Inngest } from "inngest";
import { schemas } from "./types";

// Create a client to send and receive events
// Note: In local development, if you don't have an INNGEST_EVENT_KEY,
// we default to "local". You MUST run `npx inngest-cli dev` to process events locally.
export const inngest = new Inngest({
    id: "nb-s3",
    schemas,
    eventKey: process.env.INNGEST_EVENT_KEY || "local"
});
