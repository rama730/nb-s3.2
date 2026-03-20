import { jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { preflightGithubImport } from "@/app/actions/github";
import { readGithubImportAccessCookie } from "@/lib/github/import-access-cookie";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sealedImportToken = await readGithubImportAccessCookie();

  const result = await preflightGithubImport({
    repoUrl: searchParams.get("repoUrl") || "",
    branch: searchParams.get("branch"),
    installationId: searchParams.get("installationId"),
    sealedImportToken,
  });

  if (!result.success) {
    const message = result.error || "Preflight failed.";
    return jsonError(
      message,
      /unauthorized/i.test(message) ? 401 : 400,
      /unauthorized/i.test(message) ? "UNAUTHORIZED" : "BAD_REQUEST",
    );
  }

  return jsonSuccess(result);
}
