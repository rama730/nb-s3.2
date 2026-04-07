import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { getRegisteredInngestFunctions } from "@/inngest/registry";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: getRegisteredInngestFunctions("web"),
});
