import { jsonError, jsonSuccess, logApiRoute } from '@/app/api/v1/_shared';
import { logger } from '@/lib/logger';
import { getGithubImportAccessState } from '@/lib/github/import-access-state';

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  try {
    const result = await getGithubImportAccessState();
    if (!result.success) {
      const response = jsonError(result.error, 401, 'UNAUTHORIZED');
      logApiRoute(request, {
        requestId,
        action: 'github.import.access_state',
        startedAt,
        success: false,
        status: 401,
        errorCode: 'UNAUTHORIZED',
      });
      return response;
    }

    const response = jsonSuccess(result);
    logApiRoute(request, {
      requestId,
      action: 'github.import.access_state',
      startedAt,
      userId: null,
      success: true,
      status: 200,
    });
    return response;
  } catch (error) {
    logger.error("[api/v1/github/import/access-state] failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
    const response = jsonError('Failed to load GitHub access state', 500, 'INTERNAL_ERROR');
    logApiRoute(request, {
      requestId,
      action: 'github.import.access_state',
      startedAt,
      userId: null,
      success: false,
      status: 500,
      errorCode: 'INTERNAL_ERROR',
    });
    return response;
  }
}
