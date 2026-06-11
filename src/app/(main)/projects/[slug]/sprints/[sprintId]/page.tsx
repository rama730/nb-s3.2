import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Suspense } from "react";
import ProjectDashboardClient from "@/components/projects/dashboard/ProjectDashboardClient";
import { readProjectDetailMetadata, readProjectDetailShell, readProjectSprintDetail } from "@/app/actions/project";
import { isHardeningDomainEnabled } from "@/lib/features/hardening";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { buildRouteMetadata } from "@/lib/metadata/route-metadata";
import { buildProjectDetailMetadataInput } from "@/lib/projects/project-detail-metadata";
import { isProjectTabVisibleToViewer } from "@/lib/projects/settings-policies";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; sprintId: string }>;
}): Promise<Metadata> {
  const { slug, sprintId } = await params;
  const { user } = await getViewerAuthContext();
  const result = await readProjectDetailMetadata({ slugOrId: slug, actorUserId: user?.id ?? null });
  if (!result.success) {
    return buildRouteMetadata({
      title: "Project unavailable | Edge",
      description: "This sprint belongs to a private or unavailable project.",
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

async function ResolvedProjectSprintDashboard({ slug, sprintId }: { slug: string; sprintId: string }) {
  const { user } = await getViewerAuthContext();

  const shellResult = await readProjectDetailShell({
    slugOrId: slug,
    actorUserId: user?.id ?? null,
  });

  if (!shellResult.success) {
    if (shellResult.errorCode === "NOT_FOUND" || shellResult.errorCode === "FORBIDDEN") {
      notFound();
    }
    throw new Error(`[ProjectSprintDetailPage] ${shellResult.errorCode}: ${shellResult.message}`);
  }

  const { project, capabilities } = shellResult.data;
  const canViewSprints = isProjectTabVisibleToViewer({
    tabId: "sprints",
    isOwnerOrMember: capabilities.isOwner || capabilities.isMember,
    publicTabVisibility: project.publicTabVisibility,
  });
  if (!canViewSprints) {
    notFound();
  }

  const sprintResult = await readProjectSprintDetail({
    slugOrId: slug,
    sprintId,
    actorUserId: user?.id ?? null,
    limit: 24,
  });

  if (!sprintResult.success) {
    if (sprintResult.errorCode === "NOT_FOUND" || sprintResult.errorCode === "FORBIDDEN") {
      notFound();
    }
    throw new Error(`[ProjectSprintDetailPage] ${sprintResult.errorCode}: ${sprintResult.message}`);
  }

  return (
    <ProjectDashboardClient
      project={project}
      currentUserId={user?.id || null}
      isOwner={capabilities.isOwner}
      isMember={capabilities.isMember}
      initialSprintData={sprintResult.data}
      forcedActiveTab="sprints"
    />
  );
}

export default async function ProjectSprintDetailPage({
  params,
}: {
  params: Promise<{ slug: string; sprintId: string }>;
}) {
  const { slug, sprintId } = await params;
  const { user } = await getViewerAuthContext();

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
      <Suspense fallback={<div className="h-full flex items-center justify-center animate-pulse text-zinc-500">Loading sprint data...</div>}>
        <ResolvedProjectSprintDashboard slug={slug} sprintId={sprintId} />
      </Suspense>
    </div>
  );
}
