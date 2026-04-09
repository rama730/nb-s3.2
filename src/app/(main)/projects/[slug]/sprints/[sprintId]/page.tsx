import { notFound } from "next/navigation";
import type { Metadata } from "next";

import ProjectDashboardClient from "@/components/projects/dashboard/ProjectDashboardClient";
import { readProjectDetailMetadata, readProjectDetailShell, readProjectSprintDetail } from "@/app/actions/project";
import { isHardeningDomainEnabled } from "@/lib/features/hardening";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { buildRouteMetadata } from "@/lib/metadata/route-metadata";
import { buildProjectDetailMetadataInput, getProjectTitleFromSlug } from "@/lib/projects/project-detail-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; sprintId: string }>;
}): Promise<Metadata> {
  const { slug, sprintId } = await params;
  const fallbackTitle = getProjectTitleFromSlug(slug);
  const result = await readProjectDetailMetadata({ slugOrId: slug, actorUserId: null });
  if (!result.success) {
    return buildRouteMetadata({
      title: `${fallbackTitle} Sprint | Edge`,
      description: `Explore sprint work inside ${fallbackTitle} on Edge.`,
      path: `/projects/${encodeURIComponent(slug)}/sprints/${encodeURIComponent(sprintId)}`,
    });
  }

  const project = result.data;
  return buildRouteMetadata({
    ...buildProjectDetailMetadataInput(slug, project),
    title: `${project.title} Sprint | Edge`,
    path: `/projects/${encodeURIComponent(slug)}/sprints/${encodeURIComponent(sprintId)}`,
  });
}

export default async function ProjectSprintDetailPage({
  params,
}: {
  params: Promise<{ slug: string; sprintId: string }>;
}) {
  const { slug, sprintId } = await params;
  const { user } = await getViewerAuthContext();

  const [shellResult, sprintResult] = await Promise.all([
    readProjectDetailShell({
      slugOrId: slug,
      actorUserId: user?.id ?? null,
    }),
    readProjectSprintDetail({
      slugOrId: slug,
      sprintId,
      actorUserId: user?.id ?? null,
      limit: 24,
    }),
  ]);

  if (!shellResult.success) {
    if (shellResult.errorCode === "NOT_FOUND" || shellResult.errorCode === "FORBIDDEN") {
      notFound();
    }
    throw new Error(`[ProjectSprintDetailPage] ${shellResult.errorCode}: ${shellResult.message}`);
  }

  if (!sprintResult.success) {
    if (sprintResult.errorCode === "NOT_FOUND" || sprintResult.errorCode === "FORBIDDEN") {
      notFound();
    }
    throw new Error(`[ProjectSprintDetailPage] ${sprintResult.errorCode}: ${sprintResult.message}`);
  }

  const { project, capabilities } = shellResult.data;
  const shellHardeningEnabled = isHardeningDomainEnabled("shellV1", user?.id ?? null);
  const dataHardeningEnabled = isHardeningDomainEnabled("dataV1", user?.id ?? null);
  const filesHardeningEnabled = isHardeningDomainEnabled("filesV1", user?.id ?? null);
  const peopleHardeningEnabled = isHardeningDomainEnabled("peopleV1", user?.id ?? null);

  return (
    <div
      data-scroll-root="route"
      data-hardening-shell={shellHardeningEnabled ? "v1" : "off"}
      data-hardening-data={dataHardeningEnabled ? "v1" : "off"}
      data-hardening-files={filesHardeningEnabled ? "v1" : "off"}
      data-hardening-people={peopleHardeningEnabled ? "v1" : "off"}
      className="h-full min-h-0 app-scroll app-scroll-y app-scroll-gutter overscroll-y-contain bg-zinc-50 dark:bg-zinc-950"
    >
      <ProjectDashboardClient
        project={project}
        currentUserId={user?.id || null}
        isOwner={capabilities.isOwner}
        isMember={capabilities.isMember}
        initialSprintData={sprintResult.data}
        forcedActiveTab="sprints"
      />
    </div>
  );
}
