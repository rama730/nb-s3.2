// ============================================================================
// Task Panel Overhaul - Wave 4
// GET /api/v1/projects/:id/members?q=<query>
//
// Fuzzy-lookup endpoint that powers the @mention autocomplete in the task
// comment composer. Returns up to MAX_RESULTS members of the project (owner
// plus project_members, joined to profiles) whose display name / username
// substring-matches the query.
//
// The endpoint is deliberately narrow in scope:
//   - Auth-required and project-membership-guarded: only members of the
//     project can enumerate their teammates. This protects us from someone
//     harvesting the member list of a private project via the autocomplete.
//   - Returns a flat list of the minimum fields the composer needs
//     (id, username, fullName, avatarUrl). Additional personal data stays
//     behind the existing profile endpoints.
//   - Rate-limited via the shared enforceRouteLimit helper (60/min/user+ip) so
//     a runaway composer loop can't DoS the database.
// ============================================================================

import { NextRequest } from "next/server";
import { and, eq, ilike, or, sql } from "drizzle-orm";

import {
    enforceRouteLimit,
    jsonError,
    jsonSuccess,
    requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { profiles, projectMembers, projects } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RESULTS = 10;
const MAX_QUERY_LENGTH = 64;
const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ProjectMemberSearchResult {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    role: "owner" | "admin" | "member" | "viewer";
}

function normalizeQuery(raw: string | null): string {
    if (!raw) return "";
    const trimmed = raw.trim();
    if (trimmed.length === 0) return "";
    // We substring-match against username + fullName via `ilike`, so we escape
    // the LIKE wildcards the user might have typed (underscore and percent) so
    // "a_b" does not end up matching "a b".
    const escaped = trimmed.replace(/[%_\\]/g, (ch) => `\\${ch}`);
    return escaped.length <= MAX_QUERY_LENGTH
        ? escaped
        : escaped.slice(0, MAX_QUERY_LENGTH);
}

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    const rlResponse = await enforceRouteLimit(
        request,
        "api:v1:projects:members:get",
        60,
        60,
    );
    if (rlResponse) return rlResponse;

    const { user, response } = await requireAuthenticatedUser();
    if (response) return response;
    if (!user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");

    const params = await context.params;
    const projectId = params.id;
    if (!UUID_RE.test(projectId)) {
        return jsonError("Invalid project id", 400, "BAD_REQUEST");
    }

    const access = await getProjectAccessById(projectId, user.id);
    if (!access.project) {
        return jsonError("Project not found", 404, "NOT_FOUND");
    }
    if (!access.canRead) {
        return jsonError("Forbidden", 403, "FORBIDDEN");
    }

    const rawQuery = request.nextUrl.searchParams.get("q");
    const query = normalizeQuery(rawQuery);
    const likePattern = query.length > 0 ? `%${query}%` : null;

    // The member roster consists of (a) the project owner and (b) the rows in
    // project_members. We UNION them in application code via two separate
    // queries to keep the SQL straightforward and the type inference clean.
    // Both queries are bounded by MAX_RESULTS so the combined set is at most
    // 2 * MAX_RESULTS rows before we dedupe and re-cap.
    const ownerPromise = db
        .select({
            id: profiles.id,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
        })
        .from(profiles)
        .innerJoin(projects, eq(projects.ownerId, profiles.id))
        .where(
            and(
                eq(projects.id, projectId),
                likePattern
                    ? or(
                          ilike(profiles.fullName, likePattern),
                          ilike(profiles.username, likePattern),
                      )
                    : sql`true`,
            ),
        )
        .limit(1);

    const memberPromise = db
        .select({
            id: profiles.id,
            role: projectMembers.role,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
        })
        .from(projectMembers)
        .innerJoin(profiles, eq(projectMembers.userId, profiles.id))
        .where(
            and(
                eq(projectMembers.projectId, projectId),
                likePattern
                    ? or(
                          ilike(profiles.fullName, likePattern),
                          ilike(profiles.username, likePattern),
                      )
                    : sql`true`,
            ),
        )
        .limit(MAX_RESULTS + 1);

    const [ownerRows, memberRows] = await Promise.all([ownerPromise, memberPromise]);

    const seen = new Set<string>();
    const results: ProjectMemberSearchResult[] = [];

    for (const row of ownerRows) {
        if (!row?.id || seen.has(row.id)) continue;
        seen.add(row.id);
        results.push({
            id: row.id,
            username: row.username,
            fullName: row.fullName,
            avatarUrl: row.avatarUrl,
            role: "owner",
        });
    }

    for (const row of memberRows) {
        if (!row?.id || seen.has(row.id)) continue;
        seen.add(row.id);
        results.push({
            id: row.id,
            username: row.username,
            fullName: row.fullName,
            avatarUrl: row.avatarUrl,
            role: (row.role ?? "member") as ProjectMemberSearchResult["role"],
        });
        if (results.length >= MAX_RESULTS) break;
    }

    // The composer does its own sorting for keyboard navigation; on the wire
    // we nudge the owner to the top (already inserted first) and keep the rest
    // in the query order returned by Postgres.
    return jsonSuccess({ members: results.slice(0, MAX_RESULTS) });
}
