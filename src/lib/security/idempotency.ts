import { getRedisClient } from '@/lib/redis';
import { randomUUID } from 'node:crypto';

const IDEMPOTENCY_RESULT_TTL_SECONDS = 86_400; // 24 hours
const IDEMPOTENCY_PENDING_TTL_SECONDS = 60;
const PENDING_PREFIX = '__PENDING__:';

type IdempotencyCheckResult =
  | { isDuplicate: false; lockToken?: string }
  | { isDuplicate: true; cachedResponse?: string; isPending?: boolean };

function getIdempotencyRedisKey(namespace: string, key: string) {
  return `idempotency:${namespace}:${key}`;
}

function getPendingMarker(lockToken: string) {
  return `${PENDING_PREFIX}${lockToken}`;
}

/**
 * Check if an idempotency key has already been used for a given namespace.
 * Returns { isDuplicate: true, cachedResponse } if the key was already processed.
 * Returns { isDuplicate: false } if this is a new request.
 */
export async function checkIdempotencyKey(
  request: Request,
  namespace: string,
): Promise<IdempotencyCheckResult> {
  const key = request.headers.get('idempotency-key');
  if (!key) return { isDuplicate: false };

  const redis = getRedisClient();
  if (!redis) return { isDuplicate: false };

  const redisKey = getIdempotencyRedisKey(namespace, key);
  const lockToken = randomUUID();
  const pendingMarker = getPendingMarker(lockToken);

  try {
    const acquired = await redis.set(redisKey, pendingMarker, {
      nx: true,
      ex: IDEMPOTENCY_PENDING_TTL_SECONDS,
    });

    if (acquired) {
      return { isDuplicate: false, lockToken };
    }

    const cached = await redis.get(redisKey);
    if (cached !== null) {
      if (typeof cached === 'string' && cached.startsWith(PENDING_PREFIX)) {
        return { isDuplicate: true, isPending: true };
      }

      return {
        isDuplicate: true,
        cachedResponse: typeof cached === 'string' ? cached : JSON.stringify(cached),
      };
    }
  } catch {
    // Redis failure should not block the request
  }

  return { isDuplicate: false };
}

/**
 * Save the result of an idempotent operation so duplicate requests
 * return the same response.
 */
export async function saveIdempotencyResult(
  request: Request,
  namespace: string,
  result: string,
  lockToken?: string,
): Promise<boolean> {
  const key = request.headers.get('idempotency-key');
  if (!key || !lockToken) return false;

  const redis = getRedisClient();
  if (!redis) return false;

  const redisKey = getIdempotencyRedisKey(namespace, key);
  const pendingMarker = getPendingMarker(lockToken);

  try {
    const publishResult = await (redis as unknown as {
      eval: (script: string, keys: string[], args: string[]) => Promise<number | string | null>
    }).eval(
      `
local current = redis.call('GET', KEYS[1])
if current ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
      `,
      [redisKey],
      [pendingMarker, result, String(IDEMPOTENCY_RESULT_TTL_SECONDS)],
    );

    return Number(publishResult) === 1;
  } catch {
    // Best-effort — don't fail the original request
    return false;
  }
}
