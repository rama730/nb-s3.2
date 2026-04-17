import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const root = process.cwd();
  const docsPath = path.join(root, "docs/security/remediation-evidence.md");
  const artifactDir = path.join(root, "artifacts/security");
  const artifactPath = path.join(artifactDir, "remediation-report.json");

  const docs = await readFile(docsPath, "utf8");
  const report = {
    generatedAt: new Date().toISOString(),
    summaryDocument: "docs/security/remediation-evidence.md",
    checks: {
      hasCsrfEvidence: docs.includes("CSRF"),
      hasCspEvidence: docs.includes("CSP"),
      hasUploadLifecycleEvidence: docs.includes("Upload lifecycle"),
      hasProfilePrivacyEvidence: docs.includes("Profile/privacy"),
      hasRouteBundleEvidence: docs.includes("E2E auth route"),
    },
  };

  const failures = Object.entries(report.checks)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (failures.length > 0) {
    throw new Error(`security evidence document is incomplete: ${failures.join(", ")}`);
  }

  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactPath, JSON.stringify(report, null, 2));
  console.log(`[security-evidence] wrote ${path.relative(root, artifactPath)}`);
}

main().catch((error) => {
  console.error("[security-evidence] failed:", error);
  process.exit(1);
});
