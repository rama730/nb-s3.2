import { jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { listGithubRepositories } from "@/app/actions/github";
import { readGithubImportAccessCookie } from "@/lib/github/import-access-cookie";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sealedImportToken = await readGithubImportAccessCookie();

  const result = await listGithubRepositories({
    cursor: searchParams.get("cursor"),
    q: searchParams.get("q"),
    perPage: searchParams.get("perPage") ? Number(searchParams.get("perPage")) : null,
    sealedImportToken,
  });

  if (!result.success) {
    const message = result.error || "Failed to load repositories.";
    return jsonError(
      message,
      /unauthorized/i.test(message) ? 401 : 400,
      /unauthorized/i.test(message) ? "UNAUTHORIZED" : "BAD_REQUEST",
    );
  }

  return jsonSuccess(result);
}
