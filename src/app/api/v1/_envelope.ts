import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "BAD_REQUEST"
  | "CONFLICT"
  | "NOT_FOUND"
  | "NOT_SUPPORTED"
  | "INTERNAL_ERROR"
  | "CURRENT_PASSWORD_INVALID"
  | "PASSWORD_CHANGE_FAILED"
  | "SESSION_REVOKE_FAILED"
  | "STEP_UP_REQUIRED"
  | "STEP_UP_INVALID"
  | "RECOVERY_CODE_INVALID"
  | "EMAIL_NOT_CONFIRMED"
  | "DB_ERROR"
  | "DB_UNAVAILABLE"
  | "READINESS_DEGRADED"
  | "UNAVAILABLE";

export function jsonSuccess<T>(
  data?: T,
  message?: string,
  init?: { status?: number; headers?: HeadersInit },
) {
  return NextResponse.json(
    {
      success: true as const,
      ...(data !== undefined ? { data } : {}),
      ...(message ? { message } : {}),
    },
    {
      status: init?.status ?? 200,
      headers: init?.headers,
    },
  );
}

export function jsonError(
  message: string,
  status: number,
  errorCode: ApiErrorCode,
  details?: unknown,
) {
  return NextResponse.json(
    {
      success: false as const,
      message,
      errorCode,
      ...(details !== undefined ? { details } : {}),
    },
    { status },
  );
}
