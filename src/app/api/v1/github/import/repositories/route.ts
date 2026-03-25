import { jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { listGithubRepositories } from "@/app/actions/github";
import { readGithubImportAccessCookie } from "@/lib/github/import-access-cookie";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sealedImportToken = await readGithubImportAccessCookie();
  const perPageParam = searchParams.get("perPage");
  const parsedPerPage = perPageParam ? Number.parseInt(perPageParam, 10) : Number.NaN;
  const perPage = Number.isFinite(parsedPerPage) && parsedPerPage > 0 ? parsedPerPage : null;

  const result = await listGithubRepositories({
    cursor: searchParams.get("cursor"),
    q: searchParams.get("q"),
    perPage,
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
