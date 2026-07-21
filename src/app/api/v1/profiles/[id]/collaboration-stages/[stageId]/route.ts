import { jsonError } from "@/app/api/v1/_shared";

/**
 * Stage-level profile editing was retired in favor of the transactional parent
 * contribution command. Keeping an explicit terminal response prevents stale
 * clients from silently reviving a second visibility or skill authority.
 */
export async function PATCH() {
  return jsonError(
    "Stage editing has moved to the project contribution editor",
    410,
    "NOT_SUPPORTED",
  );
}
