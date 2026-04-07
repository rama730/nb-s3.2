import { enforceRouteLimit, jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { previewGithubFolderAction } from "@/app/actions/github";
import { readGithubImportAccessCookie } from "@/lib/github/import-access-cookie";

export async function GET(request: Request) {
  const limitResponse = await enforceRouteLimit(request, "api:v1:github:import:preview-folder", 60, 60);
  if (limitResponse) return limitResponse;

  const { searchParams } = new URL(request.url);
  const sealedImportToken = await readGithubImportAccessCookie();

  const result = await previewGithubFolderAction(
    searchParams.get("repoUrl") || "",
    searchParams.get("branch") || "",
    searchParams.get("path") || "",
    searchParams.get("installationId"),
    sealedImportToken,
  );

  if (!result.success) {
    const message = result.error || "Failed to preview repository folder.";
    return jsonError(
      message,
      /unauthorized/i.test(message) ? 401 : 400,
      /unauthorized/i.test(message) ? "UNAUTHORIZED" : "BAD_REQUEST",
    );
  }

  return jsonSuccess(result);
}
