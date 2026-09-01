import { readFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const root = process.cwd();
  const source = await readFile(path.join(root, "src/app/api/v1/webhooks/github/route.ts"), "utf8");

  const checks: Array<[string, boolean]> = [
    ["webhook route records durable idempotent notifications", source.includes("incomingSha: payload.after!")],
    ["webhook route verifies immutable repository identity", source.includes("githubSyncConnections.repositoryId, repositoryId!")],
    ["webhook route verifies installation identity", source.includes("connection.installationId !== installationId")],
    ["webhooks cannot bypass the reviewed pull workflow", !source.includes("inngest.send") && source.includes("requiresReview: true")],
    ["webhook raw payload authentication is retained", source.includes("timingSafeEqual") && source.includes("createHmac")],
  ];

  const failed = checks.filter(([, passed]) => !passed);
  if (failed.length > 0) {
    throw new Error(`Webhook identity contract failed: ${failed.map(([label]) => label).join(", ")}`);
  }

  console.log("[webhook-identity-contract] ok");
}

main().catch((error) => {
  console.error("[webhook-identity-contract] failed:", error);
  process.exit(1);
});

export {};
