# Browser RLS read owners

Status: accepted

Direct browser reads are allowed only when Realtime or optimistic UI needs the
authenticated Supabase client and the table's RLS policy is the authorization
boundary. Writes and privileged reads remain server-owned.

| Table | Browser owner | Why it stays browser-owned | Bounds |
|---|---|---|---|
| `project_follows` | `src/hooks/hub/useUserInteractions.ts` | Hydrates the viewer's follow state for the visible Hub cards. | Visible project IDs only. |
| `task_subtasks` | `src/hooks/useTaskPanelResource.ts` | Reconciles the open task panel after task-scoped Realtime invalidation. | One authorized task, ordered, capped. |

`profiles` has no approved direct browser read owner. Viewer identity comes from
the Auth/viewer context and public profile projections remain server-owned.

New browser table reads require an entry here, an RLS contract check, and a
stable bound. Reuse an existing server query when live browser ownership is not
required.
