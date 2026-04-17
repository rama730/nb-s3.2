import { readFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const root = process.cwd();
  const source = await readFile(path.join(root, "src/app/api/v1/webhooks/github/route.ts"), "utf8");

  const checks: Array<[string, boolean]> = [
    ["webhook route deduplicates GitHub delivery IDs", source.includes("claimGithubDeliveryId")],
    ["webhook route verifies immutable repository identity", source.includes("identity.repoId !== payloadRepoId")],
    ["webhook route verifies installation identity", source.includes("identity.installationId !== payloadInstallationId")],
    ["webhook-enqueued git pulls include a signed job request", source.includes("createSignedJobRequestToken")],
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
