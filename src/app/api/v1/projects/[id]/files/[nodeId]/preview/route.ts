import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { projectNodes } from "@/lib/db/schema";
import { assertProjectFileReadAccess } from "@/lib/files/internal-helpers";
import { parseProjectFileKey } from "@/lib/storage/project-file-key";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/app/actions/files/_constants";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; nodeId: string }>;
};

function inlineFilename(name: string): string {
  const safeFallback = name.replace(/[\\"\r\n]/g, "_") || "file";
  return `inline; filename="${safeFallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Streams a project file with browser-facing inline headers. The storage key
 * remains server-side; this keeps task-file UUIDs out of PDF viewer metadata
 * and lets Chromium/Edge render a PDF rather than treating a signed blob as
 * an unsupported download.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id: projectId, nodeId } = await context.params;
  if (!UUID_RE.test(projectId) || !UUID_RE.test(nodeId)) {
    return new Response("Not found", { status: 404 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  try {
    await assertProjectFileReadAccess(projectId, user?.id ?? null);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const node = await db.query.projectNodes.findFirst({
    where: and(
      eq(projectNodes.id, nodeId),
      eq(projectNodes.projectId, projectId),
      eq(projectNodes.type, "file"),
      isNull(projectNodes.deletedAt),
    ),
    columns: { s3Key: true, name: true, mimeType: true, currentVersion: true },
  });
  if (!node?.s3Key || parseProjectFileKey(node.s3Key)?.projectId !== projectId) {
    return new Response("File content is unavailable", { status: 404 });
  }

  const version = String(node.currentVersion);
  if (request.nextUrl.searchParams.get("v") !== version) {
    const canonicalUrl = request.nextUrl.clone();
    canonicalUrl.searchParams.set("v", version);
    return new Response(null, {
      status: 307,
      headers: { Location: canonicalUrl.toString(), "Cache-Control": "private, no-store" },
    });
  }

  const etag = `"${nodeId}-v${version}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "private, max-age=86400, immutable",
      },
    });
  }

  const admin = await createAdminClient();
  const { data, error } = await admin.storage
    .from("project-files")
    .createSignedUrl(node.s3Key, 60);
  if (error || !data?.signedUrl) {
    return new Response("Failed to prepare file preview", { status: 502 });
  }

  const range = request.headers.get("range");
  const upstream = await fetch(data.signedUrl, {
    headers: range ? { range } : undefined,
  });
  if (!upstream.ok || !upstream.body) {
    return new Response("Failed to load file preview", { status: upstream.status || 502 });
  }

  const headers = new Headers();
  headers.set("Content-Type", node.mimeType?.trim() || upstream.headers.get("content-type") || "application/octet-stream");
  headers.set("Content-Disposition", inlineFilename(node.name));
  headers.set("Cache-Control", "private, max-age=86400, immutable");
  headers.set("ETag", etag);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Accept-Ranges", upstream.headers.get("accept-ranges") || "bytes");
  for (const name of ["content-length", "content-range"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}
