import { z } from "zod";

import { jsonSuccess } from "@/app/api/v1/_envelope";
import {
  fileLeaseErrorResponse,
  leaseCredentialsSchema,
  leaseTtlSecondsSchema,
  parseFileLeaseBody,
  requireFileLeaseUser,
} from "@/app/api/v1/_file-lease-route";
import { renewFileLease } from "@/lib/files/file-lock-service";
import { assertProjectWriteAccess } from "@/lib/files/internal-helpers";

const schema = z.object({
  projectId: z.string().uuid(),
  ttlSeconds: leaseTtlSecondsSchema.optional(),
}).merge(leaseCredentialsSchema);

export async function POST(
  request: Request,
  context: { params: Promise<{ nodeId: string }> },
) {
  try {
    const { nodeId } = await context.params;
    const auth = await requireFileLeaseUser(request, {
      csrf: true,
      rateLimit: { key: `api:v1:files:lock-renew:${nodeId}`, limit: 180, windowSeconds: 60 },
    });
    if (auth.response) return auth.response;
    const parsed = await parseFileLeaseBody(request, schema, "Invalid request body");
    if (parsed.response) return parsed.response;
    await assertProjectWriteAccess(parsed.data.projectId, auth.user!.id);
    const lease = await renewFileLease({
      projectId: parsed.data.projectId,
      nodeId,
      userId: auth.user!.id,
      credentials: parsed.data,
      ttlSeconds: parsed.data.ttlSeconds,
    });
    return jsonSuccess(lease);
  } catch (error) {
    return fileLeaseErrorResponse(error, "Failed to renew file lease");
  }
}
