import { and, eq, isNull } from "drizzle-orm";
import { createAdminClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import {
  conversationParticipants,
  messageAttachments,
  messageHiddenForUsers,
  messages,
} from "@/lib/db/schema";
import { resolvePrivacyRelationship } from "@/lib/privacy/resolver";
import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";

const ATTACHMENTS_BUCKET = "chat-attachments";

function sanitizeFilename(filename: string | null | undefined) {
  const raw = typeof filename === "string" ? filename.trim() : "";
  const fallback = "attachment";
  return (raw || fallback).replace(/[^A-Za-z0-9._() \-]/g, "_");
}

function canServeInline(mimeType: string) {
  return (
    mimeType.startsWith("image/")
    || mimeType.startsWith("video/")
    || mimeType === "application/pdf"
    || mimeType === "text/plain"
  );
}

function extractStoragePath(url: string | null | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const markers = [
      "/object/sign/chat-attachments/",
      "/render/image/sign/chat-attachments/",
    ];
    for (const marker of markers) {
      const markerIndex = parsed.pathname.indexOf(marker);
      if (markerIndex < 0) continue;
      const encodedPath = parsed.pathname.slice(markerIndex + marker.length);
      return decodeURIComponent(encodedPath);
    }
  } catch {
    // Ignore malformed legacy URLs.
  }
  return null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const limitResponse = await enforceRouteLimit(request, "api:v1:messages:attachments:get", 240, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "messages.attachments.get",
      startedAt,
      success: false,
      status: 429,
      errorCode: "RATE_LIMITED",
    });
    return limitResponse;
  }

  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) {
    logApiRoute(request, {
      requestId,
      action: "messages.attachments.get",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }
  const user = auth.user;

  const { attachmentId } = await context.params;
  const trimmedAttachmentId = attachmentId.trim();
  if (!trimmedAttachmentId) {
    logApiRoute(request, {
      requestId,
      action: "messages.attachments.get",
      userId: user.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("Attachment ID is required", 400, "BAD_REQUEST");
  }

  const [attachment] = await db
    .select({
      id: messageAttachments.id,
      filename: messageAttachments.filename,
      mimeType: messageAttachments.mimeType,
      storagePath: messageAttachments.storagePath,
      legacyUrl: messageAttachments.url,
      conversationId: messages.conversationId,
    })
    .from(messageAttachments)
    .innerJoin(messages, eq(messageAttachments.messageId, messages.id))
    .innerJoin(
      conversationParticipants,
      and(
        eq(conversationParticipants.conversationId, messages.conversationId),
        eq(conversationParticipants.userId, user.id),
      ),
    )
    .leftJoin(
      messageHiddenForUsers,
      and(
        eq(messageHiddenForUsers.messageId, messages.id),
        eq(messageHiddenForUsers.userId, user.id),
      ),
    )
    .where(
      and(
        eq(messageAttachments.id, trimmedAttachmentId),
        isNull(messages.deletedAt),
        isNull(messageHiddenForUsers.id),
      ),
    )
    .limit(1);

  if (!attachment) {
    logApiRoute(request, {
      requestId,
      action: "messages.attachments.get",
      userId: user.id,
      startedAt,
      success: false,
      status: 404,
      errorCode: "NOT_FOUND",
    });
    return jsonError("Attachment not found", 404, "NOT_FOUND");
  }

  const participants = await db
    .select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, attachment.conversationId))
    .limit(3);

  if (participants.length === 2) {
    const otherParticipantId = participants.find((participant) => participant.userId !== user.id)?.userId ?? null;
    if (otherParticipantId) {
      const privacy = await resolvePrivacyRelationship(user.id, otherParticipantId);
      if (!privacy || privacy.blockedByViewer || privacy.blockedByTarget) {
        logApiRoute(request, {
          requestId,
          action: "messages.attachments.get",
          userId: user.id,
          startedAt,
          success: false,
          status: 404,
          errorCode: "NOT_FOUND",
        });
        return jsonError("Attachment not found", 404, "NOT_FOUND");
      }
    }
  }

  const storagePath = attachment.storagePath || extractStoragePath(attachment.legacyUrl);
  if (!storagePath) {
    logApiRoute(request, {
      requestId,
      action: "messages.attachments.get",
      userId: user.id,
      startedAt,
      success: false,
      status: 404,
      errorCode: "NOT_FOUND",
    });
    return jsonError("Attachment not found", 404, "NOT_FOUND");
  }

  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(ATTACHMENTS_BUCKET).download(storagePath);
  if (error || !data) {
    logApiRoute(request, {
      requestId,
      action: "messages.attachments.get",
      userId: user.id,
      startedAt,
      success: false,
      status: 404,
      errorCode: "NOT_FOUND",
    });
    return jsonError("Attachment not found", 404, "NOT_FOUND");
  }

  const download = new URL(request.url).searchParams.get("download") === "1";
  const filename = sanitizeFilename(attachment.filename);
  const mimeType = (attachment.mimeType || data.type || "application/octet-stream").trim() || "application/octet-stream";
  const disposition = download || !canServeInline(mimeType) ? "attachment" : "inline";

  logApiRoute(request, {
    requestId,
    action: "messages.attachments.get",
    userId: user.id,
    startedAt,
    success: true,
    status: 200,
  });

  return new Response(await data.arrayBuffer(), {
    status: 200,
    headers: {
      "cache-control": "private, max-age=60, must-revalidate",
      "content-disposition": `${disposition}; filename=\"${filename}\"`,
      "content-length": `${data.size}`,
      "content-security-policy": "sandbox; default-src 'none';",
      "content-type": mimeType,
      "x-content-type-options": "nosniff",
    },
  });
}
