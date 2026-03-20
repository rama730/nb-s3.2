import { jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { analyzeGithubRepoAction } from "@/app/actions/github";
import { readGithubImportAccessCookie } from "@/lib/github/import-access-cookie";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sealedImportToken = await readGithubImportAccessCookie();

  const result = await analyzeGithubRepoAction(
    searchParams.get("repoUrl") || "",
    searchParams.get("installationId"),
    sealedImportToken,
  );

  if (!result.success) {
    const message = result.error || "Failed to analyze repository.";
    return jsonError(
      message,
      /unauthorized/i.test(message) ? 401 : 400,
      /unauthorized/i.test(message) ? "UNAUTHORIZED" : "BAD_REQUEST",
    );
  }

  return jsonSuccess(result);
}
