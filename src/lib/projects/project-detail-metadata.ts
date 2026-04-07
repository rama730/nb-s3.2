export type ProjectDetailMetadataSource = {
  slug?: string | null;
  title?: string | null;
  shortDescription?: string | null;
  description?: string | null;
};

const PROJECT_UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function getProjectTitleFromSlug(slug: string) {
  let decoded = "";
  try {
    decoded = decodeURIComponent(slug || "").trim();
  } catch (error) {
    if (!(error instanceof URIError)) {
      throw error;
    }
    decoded = (slug || "").trim();
  }
  if (!decoded || PROJECT_UUID_REGEX.test(decoded)) return "Project";

  const normalized = decoded
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized ? normalized.slice(0, 80) : "Project";
}

export function buildProjectDetailMetadataInput(
  slug: string,
  project?: ProjectDetailMetadataSource | null,
) {
  const fallbackTitle = getProjectTitleFromSlug(slug);
  const resolvedTitle = project?.title?.trim() || fallbackTitle;
  const canonicalSlug = (project?.slug?.trim() || slug).trim();
  const description =
    project?.shortDescription?.trim()
    || project?.description?.trim()
    || `Explore ${resolvedTitle} on Edge.`;

  return {
    title: `${resolvedTitle} | Edge`,
    description,
    path: `/projects/${encodeURIComponent(canonicalSlug)}`,
    image: `/api/og/project/${encodeURIComponent(canonicalSlug)}`,
  };
}
