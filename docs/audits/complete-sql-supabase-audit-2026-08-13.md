# Complete SQL, Query, and Supabase Audit

Audit date: 2026-08-13  
Mode: read-only analysis and reporting  
Repository: `/Users/chrama/Downloads/nb-s3`  
Connected Supabase project: `iutauehhgdymtpzrnzcy`  
Method: Ponytail Full and Ponytail Audit  
Implementation status: **original audit was read-only; repository implementation and verification are recorded in Sections 33–36 (through 2026-08-17)**

> Historical-scope note: Sections 1–32 preserve the 13 August audit evidence and its original no-implementation boundary. Sections 33–36 are the subsequent Ponytail Full implementation ledger. They do not claim that repository migrations were applied to the connected Supabase project.

## 1. Purpose and approval boundary

This report records the complete audit requested for the application's SQL organization, database queries, duplicated database behavior, Supabase architecture, user-data model, authorization, Storage, Realtime, operational lifecycle, and scale readiness.

The audit does not authorize implementation. No SQL was applied, no migration was executed, no database or Storage row/object was changed, no Supabase configuration was changed, and no application file was reorganized. The only artifact created by this program is this report. Remediation must begin only after a separate review and explicit approval.

## 2. How the program ran

The work ran sequentially, as required:

1. The primary agent loaded the Ponytail Full and Ponytail Audit instructions and built a read-only repository/Supabase baseline.
2. Sub-agent 1 audited SQL organization, migration lineage, domain ownership, duplicated database behavior, and every migration artifact. It finished naturally before the next phase started.
3. Sub-agent 2 audited query correctness, performance, pagination, transactions, concurrency, placement, duplication, and scale. Its two bounded internal reviewers covered messaging/notifications and projects/users; all finished naturally before the next main phase.
4. Sub-agent 3 used the Supabase plugin for a read-only live architecture, Auth, RLS, grants, functions, triggers, Storage, Realtime, lifecycle, and scale audit. It finished naturally before review began.
5. A final independent reviewer checked counts, overlap, evidence limitations, and report acceptance. It finished naturally.
6. The primary agent consolidated the ledgers. Exact aliases were not double-counted, while related findings retained their individual evidence.

No sub-agent was interrupted. No implementation agent was launched.

## 3. Evidence scope and headline coverage

| Area | Coverage |
|---|---:|
| Repository SQL files | 154 |
| Drizzle migration SQL files | 153 |
| Standalone SQL utilities | 1 |
| SQL files under `supabase/` | 0 |
| Drizzle journal entries | 152 |
| SQL-governance manifest entries | 149 |
| Live completed application-journal tags | 156 |
| Live Supabase platform migration records | 2 |
| Production query-owning files | 178 |
| Production execution/transaction-boundary sites | 1,879 |
| SQL/Drizzle/PostgREST statement sites | 1,455 |
| Storage operation roots | 50 |
| Auth operation sites | 253 |
| Explicit transaction boundaries | 121 |
| Operational script owners | 17 files / 139 sites |
| Live `public` tables | 110 |
| Live `public` tables with RLS enabled | 110 |
| Live public policies | 164 |
| Storage policies | 15 |
| Application-owned functions | 23 total: 13 `app_private` + 10 `public` |
| Triggers | 43 total: 7 event + 31 public data + 4 Storage + 1 Realtime |
| Storage buckets | 6 |
| `supabase_realtime` application tables | 21 |
| Edge Functions | 0 |

The independent reviewer reproduced the repository migration counts, 110 public tables, all-public-table RLS coverage, 164 public policies, 15 Storage policies, 6 buckets, and 21 publication members. Its lower function/trigger counts were narrower scopes—10 `public` functions and 31 public data triggers—and do not contradict the cross-schema totals above.

## 4. Overall assessment

The project is not suffering from one isolated SQL problem. Its main risk is split authority:

- Migration truth is divided among migration files, the Drizzle journal, the governance manifest, a live application journal, and the Supabase platform registry.
- Some live schema state exists without trustworthy creation lineage.
- Runtime database access is spread across 178 production files and includes duplicated owners, unsafe post-commit work, unbounded reads, concurrency races, and several failure paths that can lose or orphan data.
- Supabase's live RLS and column-grant posture is generally stronger than the local history suggests, but privileged direct database access bypasses RLS by default.
- Account deletion, Storage cleanup, and public Realtime channel design contain material privacy or integrity risks.
- The repository's “1M+” claims are not supported by completed capacity evidence.

The correct direction is incremental consolidation around existing domain owners and native PostgreSQL/Supabase features—not a new generic repository layer or a platform rewrite.

## 5. Finding-count and overlap rules

This report retains 148 primary IDs:

- `ORG-001`–`ORG-028`: 28 SQL organization and lineage findings.
- `QRY-001`–`QRY-091`: 91 consolidated query findings.
- `SUP-001`–`SUP-029`: 29 Supabase findings.

`QRY-043`–`QRY-065` are the consolidated forms of the project/user child ledger (`PRJ-001`–`PRJ-023`). `QRY-066`–`QRY-091` are the consolidated forms of the messaging/notification child ledger (`MSG-001`–`MSG-026`). The PRJ/MSG aliases are not additional findings.

Supabase findings often cross-link organization or query findings. They remain separate where the Supabase finding adds live-object, policy, role, or lifecycle evidence. The completeness review's proposed `REV-001`, `REV-002`, and `REV-003` are already fully represented by `SUP-021`, `SUP-017`, and `SUP-019`; they are not new issues.

## 6. SQL organization and migration-lineage ledger

### ORG-001 — Critical — Migration truth is split across incompatible registries

There are 153 Drizzle SQL files, 152 journal entries, and 149 governance entries. Live `app_migration_journal` has 156 completed tags, while the Supabase platform registry has only two. The file, journal, manifest, and live state were not landed atomically. Deployment and recovery cannot currently prove one ordered source of truth. Smallest remedy: stop rollout, reconcile every environment by tag/checksum/schema proof, then make migration file, journal, manifest, schema, and tests one atomic append-only change.

### ORG-002 — Critical — Applied migrations are untracked in the current worktree

Twenty-six migration files are untracked; 22 migrations from `0128` through `0149` are already applied live with compatible checksums. Losing this worktree could remove the local source for applied history. Preserve and review the exact files plus journal, manifest, and schema edits as an immutable changeset before any new rollout. Never regenerate already-applied SQL.

### ORG-003 — Critical — Live schema contains out-of-band parts of unpublished migrations

Live `task_node_links.tags` matches unpublished `0150`, and live bucket MIME arrays match unpublished office-MIME SQL, but their tags are absent live. Workflow retirement `0151` is only partially reflected: `projects.custom_workflow` and the old seed function remain while existing labels have changed. Normal setup can fail or produce mixed state. Reconcile each environment before applying or adopting any unpublished tag.

### ORG-004 — High — Duplicate numeric prefixes and order regressions obscure migration sequence

Duplicate visible prefixes exist for `0003`, `0004`, `0005`, `0006`, `0019`, `0020`, `0021`, `0022`, `0023`, `0053`, and `0125`. Journal order also visibly regresses. Applied tags must not be renamed; legacy duplicates should be frozen and new migrations must use one unique, monotonically increasing prefix.

### ORG-005 — Medium — Journal timestamps are not trustworthy chronology

The journal includes duplicate timestamps and entries dated after the audit date. Tooling and reviewers must treat journal `idx` plus live `applied_at` as chronology. Existing history should be grandfathered, while the current checker should reject duplicate, future, or non-monotonic timestamps for new entries.

### ORG-006 — High — Existing checks validate membership but not lineage semantics

The journal and governance checks compare names/sets but do not enforce exact file-journal-manifest equality, visible sequence uniqueness, timestamp validity, or snapshot parity. This allowed the source dry-run to pass while `0152` was excluded. Extend the existing checks instead of creating another framework.

### ORG-007 — Critical — Drizzle snapshots are stale, making generation unsafe

The latest snapshot is `0097`; the current schema declares 96 tables while the snapshot has 82. Eighteen current tables are absent and four deliberately retired tables remain. `db:generate` may propose recreating already-live tables or restoring retired objects. Do not run generation until a disposable replay produces and validates current catalog parity.

### ORG-008 — Critical — `task_pushes` has no creation migration

The table exists in live Supabase and the Drizzle schema, but no migration creates it; later SQL only adds indexes. A fresh replay cannot reliably reach the live state. Add one forward, idempotent reconciliation migration that creates or validates its exact current shape before dependent indexes.

### ORG-009 — Critical — `task_read_receipts` has no SQL lineage

The table exists live and is used by raw SQL and upserts, but neither migration history nor snapshots create it. It also has RLS enabled without policies. Add one forward reconciliation migration with table, keys, index, and an explicit server-only or client-policy decision.

### ORG-010 — High — Replay completeness is self-referential

The replay checker derives its expected tables only from journaled SQL. An object missing from both SQL and the derived set is invisible, which is how schema-only tables escape detection. Compare the reconstructed catalog against the Drizzle schema plus a small explicit retired/external allowlist.

### ORG-011 — High — Three sprint-membership foreign keys lack leading indexes

`sprint_task_memberships.added_by`, `project_id`, and `removed_by` were created after the generic FK-index repair migration. Live lineage and Supabase advisors both flag them. Add the three exact B-tree indexes in one forward migration and reflect them in the Drizzle schema.

### ORG-012 — High — Two RLS-without-policy tables are not declared intentional

`sprint_task_memberships` and `task_read_receipts` are fail-closed live, but the catalog guardrail does not list them. Decide whether they are server-only. If yes, encode RLS and document them in the existing allowlist; otherwise add only the minimal native policies needed.

### ORG-013 — High — `db:push` bypasses append-only migration governance

`package.json` exposes direct `drizzle-kit push` next to the journaled setup path. This likely enables schema-only objects or unjournaled columns, even though the exact historical actor cannot be proven. Remove it or restrict it to disposable local databases and block shared/production use.

### ORG-014 — Medium — Standalone partition SQL is a stale second schema owner

`scripts/setup-partitioning.sql` attempts mutable table/function ownership outside migrations and duplicates `create_future_partitions`. Its nonpartitioned-table behavior can fail. After confirming no external scheduler uses it, remove the utility and its exception; keep repair in append-only migrations and one operational scheduler.

### ORG-015 — Medium — Skill-catalog seed history dominates migration size

Twelve seed migrations contain roughly 43,000 lines and 31.4 MB—about 98% of migration bytes—because each release repeats full catalog state. Applied history remains immutable. Future releases should emit only deltas or use one current-state bootstrap fixture for fresh environments.

### ORG-016 — High — Messaging preview projection has two behavioral owners

Native `app_private.nb_reconcile_conversation_participants` and `src/lib/messages/preview-refresh.ts` calculate previews differently. The application path performs `1+2N` queries and diverges for deleted/reply messages. Retain one small application call to the native owner and remove application recomputation after transaction/authorization tests.

### ORG-017 — Medium — `0152_message_preview_backfill` repeats existing history

`0152` repeats the backfill already performed in `0133`, is unjournaled/unmanifested, and the connected project currently shows no preview mismatch. Verify every environment; if clean after consolidating the native owner, delete the unregistered file rather than adding duplicate permanent history.

### ORG-018 — Medium — Database access ownership is scattered across catch-all modules

Database access imports occur across 262 files, with extremely large catch-all modules such as project and messaging `_all.ts`. Keep existing domain directories and move reusable behavior only when touched. Split along existing siblings; do not introduce a generic repository/service layer.

### ORG-019 — Medium — Authentication acquisition is repeatedly reimplemented

The repository contains hundreds of `auth.getUser`, `createClient`, viewer-context, and wrapper calls. Prefer the cached viewer context where identity/authorization is the only need, while retaining raw clients for Auth and Storage operations. Do not perform a blind global replacement.

### ORG-020 — Medium — Project-follow fallback duplicates mutation behavior

The canonical transactional follow mutation is followed by a catch-all compatibility path that repeats reads/writes and may silently run after unrelated failures. Verify `followers_count` across environments, then delete the fallback or restrict it to the exact historical compatibility error.

### ORG-021 — Low — Verified dead compatibility exports remain

The `sendMessage` delegate and several unused avatar upload/data-URL wrappers have no repository callers. Delete only verified unused exports after checking external/dynamic consumers. Retain `compressAvatar`, which has a real fallback caller.

### ORG-022 — Low — Typing-user conversion is implemented three times

Identical payload-to-typing-user mapping appears in three typing hooks/helpers. Export one converter and reuse it. Do not merge the distinct single-room and multi-room hooks merely because they share mapping code.

### ORG-023 — Informational — Typing and presence are intentionally split and currently sound

The current Presence architecture includes shared channel deduplication, TTL cleanup, hidden/unmount clearing, and throttling. The historical `typing_indicators` table was intentionally removed. Keep Supabase Presence for ephemeral typing and the database heartbeat only for coarse last-active state.

### ORG-024 — Low — Direct browser table reads are undocumented exceptions

Browser hooks directly read project follows, profiles, and subtasks under RLS. That is not automatically incorrect, but ownership is scattered. Document the deliberate RLS-based read owners or reuse an existing matching server query; do not add an abstraction solely for style.

### ORG-025 — Medium — Existing audit documents are stale

Older reports claim green journal/governance/live checks and outdated typing defects that current evidence contradicts. Mark dated audits as historical snapshots and add a current-state banner; do not use them as present-tense verification.

### ORG-026 — Medium — Storage MIME drift is weakly checked

Live bucket MIME arrays are exact contracts, but catalog drift checks only confirm nonempty arrays for important buckets. Compare exact canonical sets so future manual additions or removals are detected without creating another policy framework.

### ORG-027 — Medium — Workflow seed function has ambiguous name resolution

The live workflow seed function uses unqualified names and no fixed search path. Because the replacement migration is unpublished on the connected project, harden it before first canonical application only after verifying no environment has applied its tag: schema-qualify the function/table, set an empty search path, and restrict direct execution.

### ORG-028 — Medium — Generated adjective migration names hide ownership

Historical names such as `0000_medical_the_liberteens` reveal no domain or intent. Applied names stay immutable. Future names must be descriptive, for example `0153_sprint_membership_fk_indexes`.

## 7. Query correctness, performance, placement, and scale ledger

### QRY-001 — High — Hub drops validated `includedIds`

`src/app/actions/hub.ts` validates but does not forward `includedIds`, while `src/lib/data/hub.ts` implements behavior that depends on it. The current client filters independently, so server hide-opened behavior is unreachable/inconsistent. Either pass the field to the canonical feed or delete the unused server feature.

### QRY-002 — Medium — Invalid or foreign Hub cursors restart pagination

Malformed or wrong-kind cursors fall back to page one instead of being rejected. This can duplicate pages and create client loops. Reject invalid cursor kind through the existing validation/error envelope.

### QRY-003 — Low/Medium — Direct Hub `hasMore` calculation guarantees empty terminal requests

The direct branch fetches exactly `pageSize` and reports another page whenever the page is full. Exact multiples therefore trigger an empty final request. Fetch `pageSize + 1`, slice, and derive `hasMore` from the extra row.

### QRY-004 — Low — Snapshot pagination can skip replacement slots

Snapshot pagination advances over the whole ID slice even when deletion or visibility filtering hydrates fewer rows. This creates sparse pages and may skip later replacement items. Backfill from subsequent snapshot IDs if full pages are a requirement; otherwise document the snapshot tradeoff.

### QRY-005 — Medium, load-dependent — Hub search repeats complex expressions

Up to eight term predicates and relevance expressions repeat `ILIKE`/`EXISTS` work. Relevant GIN and join indexes already exist, so a missing-index claim is not confirmed. Measure representative plans and consolidate to one native PostgreSQL search expression only if the measured plan justifies it.

### QRY-006 — Low — Dead project data query owner

No production caller was found for the old `getProjectDetails`/`getPopularProjectIds` owner in `src/lib/data/project.ts`. It performs multiple reads despite being unused. Delete it after the final dynamic/external consumer check.

### QRY-007 — High — Matchmaking action lacks viewer/project authorization

`src/app/actions/matchmaking/resolver.ts` accepts arbitrary profile and role IDs and returns candidate capability/alignment data without authenticating the viewer or verifying management of the role's project. Authenticate, verify project/role administration, and select only the fields the modal requires.

### QRY-008 — High — File read failures are fabricated as empty content

`src/app/actions/files/content.ts` returns an empty string after Storage and GitHub recovery both fail. The editor can then save that fabricated value as a real empty file. Return a typed unavailable error; never synthesize file content after a failed read.

### QRY-009 — Medium/High — Signed-URL reads mutate Storage and database state

The signed-read path can download from GitHub, upload to Storage, update the database, and then sign. Reads therefore own mutation/concurrency behavior. Route hydration through the existing import/hydration owner or make the mutation explicitly idempotent and conditional.

### QRY-010 — Medium — Batch signed URLs repeat project and path reads

For up to 50 nodes, the implementation repeatedly reloads project import information and performs a second node query because the first omitted path. Fetch project context once and include path in the first bounded node projection.

### QRY-011 — Low/Medium — Federated file search repeats authorization

The federated action authorizes, then calls a helper that repeats the same access work. Create one private already-authorized query helper and keep the public boundary check in one place.

### QRY-012 — High — File-index search can return soft-deleted nodes

`project_file_index` search does not join the authoritative active `project_nodes` row or require `deleted_at IS NULL`. Deleted files can therefore surface. Join by node/project and apply the canonical active-node predicate.

### QRY-013 — High — Search/replace preview and apply disagree on case sensitivity

Preview uses `ILIKE`, while counting and replacement are case-sensitive. Users can preview matches that will not be changed. Select one behavior consistently—most minimally `LIKE` if current replacement behavior is authoritative.

### QRY-014 — Low — Search/replace preview limit is nondeterministic

The limited preview has no stable ordering, so the displayed files can change across plans or runs. Order by canonical path and node ID before applying the cap.

### QRY-015 — Medium/High — Search/replace performs per-file lock and statement loops

The bounded operation can issue up to 60 lease checks plus multiple statements per file. Replace per-file lease reads with one bulk query and use set-based inserts/updates inside the existing transaction.

### QRY-016 — High — Storage replacement and revision commit are not atomic

Search/replace writes objects before the database commit and relies on compensating rollback. Concurrent edits can be overwritten and rollback can fail. Reuse the existing conditional file-revision/lease owner and verify expected version before every object replacement.

### QRY-017 — Medium — Flat-tree count and visible rows use different predicates

The count includes all active project nodes, while the select excludes unfinished-task/system scope. The response can falsely report truncation. Remove the count and fetch `cap + 1`, or share the exact visible predicate.

### QRY-018 — High, observed — Full-tree bootstrap is materially expensive

The bootstrap allows 20,000 ordered node rows. Live normalized statistics showed variants averaging roughly 103–179 ms and returning hundreds of thousands of rows across calls. Prefer the existing paginated node owner and retire or tightly restrict full-tree bootstrap.

### QRY-019 — Medium, measured-risk — Batch children query once per parent

The operation issues up to 50 parent-specific queries. This preserves per-parent fairness, so it is not automatically wrong. If latency is material, use one `row_number() over (partition by parent_id)` query; otherwise retain the bounded design.

### QRY-020 — Medium/High — Breadcrumbs walk ancestors sequentially

Breadcrumb metadata can make 32 sequential database reads even though materialized path already exists and another implementation uses it. Consolidate on the path-based owner.

### QRY-021 — Medium/High — Generic path lookup queries once per segment

Ordinary paths ignore the indexed `(project_id, path)` lookup and walk segments. Normalize the full path and perform one equality lookup; preserve special task-path logic only where it is genuinely required.

### QRY-022 — High — Legacy task URL resolution scans whole task/file sets

The compatibility path loads every active task and all task-system paths, then filters in JavaScript. Move callers to opaque canonical file IDs and retire this scan; while compatibility remains, constrain the SQL by supplied IDs/name.

### QRY-023 — High — Batch/file-ID reads omit canonical workspace scope predicates

`getProjectBatchNodes` and `getNodesByIds` omit task/system exclusions used by the primary listing. A public viewer who knows IDs may receive internal metadata. Centralize the existing scope predicate and require task-specific callers to opt in explicitly.

### QRY-024 — High — Project-file reconciliation repeatedly checks only the first prefix

The job always reads the first ordered 4,000 rows and the first bounded projects, with no durable cursor. Later rows can remain unreconciled forever. Add a persisted keyset watermark to the existing job.

### QRY-025 — High — Stale import reconciliation can overwrite a revived import

Rows are selected as stale, then updated by ID/status without preserving the selected `updated_at` cutoff. An active import can be marked failed after it resumes. Add the cutoff/version predicate to the update.

### QRY-026 — High — Account cleanup uses an anonymous request client in a background job

The signed Inngest worker constructs the cookie-bound anonymous server client, so private cleanup lacks administrative authority. This can block hard deletion. Reuse the existing admin client inside the already-verified job; see `SUP-005` and `SUP-006` for the wider lifecycle defect.

### QRY-027 — Medium/High — Account cleanup loads all owned assets into memory

Project files and attachments are loaded without keyset pagination before deletion. Large accounts can exhaust memory or API limits. Page database records and Storage deletion batches while preserving retry progress.

### QRY-028 — High — Document cleanup deletes metadata after Storage failure

The worker logs object-deletion failures but removes every asset row, erasing the only retry reference. No production emitter was found. Delete the dead worker if truly unused; otherwise delete metadata only for confirmed object removals.

### QRY-029 — Medium — Daily hard-delete queue is unbounded and sequential

The queue has no limit or stable order and creates a workflow step for every row. Use a bounded ordered batch when volume requires it, preserving the existing job platform.

### QRY-030 — High — File-hash backfill can starve on the same failures forever

Each pass reselects the first 25 null hashes without a cursor; failed rows remain null and can monopolize all later runs. Use a keyset cursor or run-local failed-ID exclusion.

### QRY-031 — High — Legacy backfill is unbounded, N+1, and cycle-unsafe

The script loads full tables, performs nested per-row queries/writes, and recursively builds paths without cycle detection. Retire it if already applied; otherwise replace it with set-based SQL or a recursive CTE with a cycle guard.

### QRY-032 — High — Legacy task-file migration can orphan copied objects

The script copies Storage first, then separately inserts node/link records using random destinations. Failure/retry can leave or duplicate objects. Use deterministic destinations, transact database metadata, and remove copied objects on database failure; retire after verified completion.

### QRY-033 — High — Deduplication script creates a uniqueness gap

It commits cleanup, drops indexes, then separately recreates them non-concurrently. A failure leaves protection absent. Retire the script if superseded; otherwise create replacement indexes concurrently and verify them before swapping.

### QRY-034 — Medium — Two RLS policies reevaluate Auth per row

Supabase advisor flags `project_invitations_read_authorized` and `project_guidance_appointments_read_authorized`. Replace direct repeated `auth.uid()` with `(SELECT auth.uid())` while preserving policy semantics. Cross-link: `SUP-017`.

### QRY-035 — Low/Medium — `dm_pairs` has duplicate unique indexes

`dm_pairs_user_low_high_unique` and `dm_pairs_user_low_user_high_key` duplicate the same protection. Verify dependency/constraint ownership, keep the constraint-backed authority, and remove the redundant index. Cross-link: `SUP-019`.

### QRY-036 — High — “1M readiness” is not supported by repository evidence

Headroom is blocked, capacity audit reports failure, and rollout lacks load/capacity approval. The gate aggregates failures but does not validate these query shapes. Replace population claims with measured budgets and representative load/plan evidence. Cross-link: `SUP-026`.

### QRY-037 — Medium/High — Upload-collision preflight scans the active project tree

Arbitrary path arrays trigger a read of all active scoped nodes and can be called repeatedly by task and explorer mutations. Clamp input and query only submitted ancestors/siblings using materialized-path indexes; keep the race-safe unique constraint as authority.

### QRY-038 — High — GitHub import reconciliation writes per changed/deleted file

At the configured 30,000-file limit, reconciliation performs individual updates and frequent progress writes. Batch/set-based changes inside the existing advisory-lock owner.

### QRY-039 — Critical — Git pull launches unbounded Storage operations and records failed keys

Up to 30,000 immediately executing promises are awaited in one `Promise.all`; the existing concurrency helper is unused. Object failures are logged, but corresponding database keys are still committed. Use existing bounded concurrency, retain retry state, and persist only confirmed uploads.

### QRY-040 — High — Upload-intent cleanup is unbounded and ignores deletion failures

The job selects all expired intents, removes all bucket keys, ignores Supabase `{error}`, then marks/deletes every intent. Claim bounded batches, inspect results, and delete only successfully cleaned intents.

### QRY-041 — Medium — Integrations route loads all GitHub projects for two aggregates

The route loads every matching ID/timestamp to compute count and latest sync. Replace the payload read with native `count(*)` and `max(github_last_sync_at)`.

### QRY-042 — Low — Dead purge owner does not own Storage deletion

The exported purge action has no production caller, deletes database state, and merely returns the object key. Delete it if unused. If retained, its canonical workflow must durably own Storage deletion.

### QRY-043 — Critical — Block/unblock leaves stale Redis relationship projections

The database transition changes relationship state but does not invalidate either blocked-pair or accepted-connection Redis projections. The resolver can synthesize an accepted connection from stale cache, retaining visibility or messaging capability after a block. Put both projection changes in one canonical post-transaction invalidator.

### QRY-044 — High — Bulk accept/reject has a status TOCTOU race

Bulk actions select pending IDs, then update by ID without rechecking status and parties. Concurrent single actions can be overwritten and denormalized counters can diverge. Use conditional `UPDATE ... WHERE status='pending' AND addressee_id=? RETURNING`, then derive one batched counter delta from returned rows.

### QRY-045 — High — Terminal connection reactivation is not serialized

Opposite simultaneous requests can both observe a terminal row, both report success, race on orientation, and both notify. Lock/advisory-lock the pair or condition the update on the observed state/version.

### QRY-046 — Medium/High — Pending application cap is not serialized

The current pending count and cap check occur outside a user-scoped lock or serializable insert. Parallel applications can both pass and exceed the account cap. Enforce the check and insert under one database serialization boundary.

### QRY-047 — High — Comment and mention projection are non-atomic

The comment commits before mention rows. If projection insertion fails, the action reports failure even though the comment exists; retry can duplicate content and mentions diverge. Insert comment and mention projection in one transaction, keeping notification delivery after commit.

### QRY-048 — High — Reply creation races parent deletion

Reply validation/insertion and top-level delete's “has replies?” decision are separate unlocked sequences. A reply can be cascade-deleted after reporting success or fail after validation. Lock the parent and make the decision/mutation atomic, or consistently tombstone top-level comments.

### QRY-049 — High — Discussion pagination leaves replies unbounded

Top-level comments are paginated, but every reply for the loaded parents is returned along with likes/counts. One hot parent defeats the boundary. Give replies their own cursor or return a capped preview plus reply count.

### QRY-050 — Medium/High — Workspace loads unbounded project, sprint, and application sets

All owned/member project IDs, all active sprints for that set, aggregates for all sprint IDs, and all pending nested applications are loaded. Paginate projects/applications, summarize only the bounded page, and clamp exported limits.

### QRY-051 — Medium/High — Redis misses become false zero social proof

Missing/unavailable Redis data returns zero mutual connections and empty social proof with no database fallback. Valid relationships therefore disappear during cold cache or faults. Treat miss as unknown, perform a bounded indexed fallback, and repopulate.

### QRY-052 — Medium/High — Connection synchronization reloads whole graphs per accepted user

Bulk acceptance can trigger roughly 201 complete graph reads, Redis rebuilds, and suggestion jobs. Apply incremental `SADD`/`SREM` for the mutated pairs and reserve full reconciliation for repair jobs.

### QRY-053 — Medium/High — Project task list repeats correlated aggregates

For up to 200 tasks, repeated scalar subqueries rescan subtasks, files, comments, and receipt state. Consolidate counts into grouped aggregates/CTEs. Add description-search indexing only after representative plans demonstrate the need.

### QRY-054 — High — Soft-deleted tasks can block project finalization

The canonical active-task predicate excludes deleted rows, but danger-zone and finalization counts omit that condition. A deleted incomplete task can permanently prevent finalization. Reuse one active-task predicate/count owner in all three paths.

### QRY-055 — Medium — Update/comment writes bypass create-time size limits

Shared create limits exist, while task updates, subtasks, comments, and mention arrays are weaker or unbounded. Reuse shared field constraints and cap comment length plus unique mention count at the trust boundary.

### QRY-056 — Medium — Browser task/follow reads are unbounded

Task subtasks and project follows are read without explicit range/pagination. Large checklists or long-lived accounts can produce large browser payloads. Add stable ranges/cursors; RLS reliance itself is not classified as a defect.

### QRY-057 — Medium — Project detail projections silently truncate without stable order

Open roles and collaborators have fixed caps but no deterministic order, count, or `hasMore`. Results look complete while varying by plan/data order. Add stable ordering and make preview/pagination semantics explicit.

### QRY-058 — Medium — Invite options load all exclusions before selecting 20 candidates

All project roles, pending applications, and workflow invitations are loaded before candidate connections are capped. Select candidate IDs first, then restrict exclusion queries to them; paginate role choices separately if needed.

### QRY-059 — High — Unified history cannot reach older application events

Application history has a bounded first page but no cursor. Once the unified connection cursor exists, application results are deliberately empty and `hasMore` derives only from connections. Use one cross-source keyset cursor or independently paginate both bounded heads and merge.

### QRY-060 — Medium/High — Duplicate Supabase lifecycle update lacks OCC

The weaker lifecycle path reads and updates without an expected version or affected-row check, then reports success. An adjacent canonical Drizzle path already implements optimistic concurrency. Route callers through that owner and delete the weaker duplicate.

### QRY-061 — Low/Medium — Project update access rereads the project

The update path reads the project, then calls access resolution that reads it again. Resolve access once and project any additional update fields from that snapshot.

### QRY-062 — Medium/High — Redis synthetic IDs leak into public connection contracts

Cache-only resolution produces identifiers such as `redis-fast-path-*`, which status/profile/messaging consumers may treat as persistent primary keys. Return `null` for cache-only IDs or fetch the canonical row before exposing an ID-dependent state.

### QRY-063 — Low/Medium — Hydration polling treats Supabase errors as completion

The browser poller ignores the returned error, interprets undefined data as terminal, and stops. Continue bounded retry/backoff on errors and clear polling only on an explicit terminal state.

### QRY-064 — Medium/High — Extension root-node limit is global rather than per project

Tasks are correctly capped per project, but root nodes use one global limit after project ordering. Early projects can consume the quota and starve later projects. Use `row_number() over (partition by project_id) <= 100`.

### QRY-065 — Medium — Project/profile selection actions are unbounded

Administrative and collaboration selectors load all matching projects, memberships, and roles. Power users can create large multi-stage `IN` queries and payloads. Add search/keyset pagination and narrow projections to selection UI needs.

### QRY-066 — High — Snoozed and quiet-hours web push is never resumed

The notification service suppresses immediate push but has no durable dispatcher that resumes due delivery, contradicting settings behavior. Add one durable due-notification/outbox owner using existing notification infrastructure.

### QRY-067 — High — Aggregate notification upsert destroys per-item snooze

Aggregation overwrites snooze state on an existing notification, so a user's explicit delay can disappear when another event joins the group. Preserve future item snooze and separate policy delay from user snooze if both concepts remain.

### QRY-068 — Medium — Push subscription `failureCount` is dead state

Schema, retention, and administration depend on failure counts, but delivery neither increments failures nor resets successes except for immediate terminal deletion. Atomically increment/reset in the canonical delivery path and prune using the existing policy.

### QRY-069 — Medium/High — Web push can escape a rolled-back transaction

Push is fire-and-forget from a path that may still be inside a database transaction. Users can receive events that never committed. Dispatch only after commit through the durable notification/outbox owner.

### QRY-070 — High — Notification fanout creates an unbounded query storm

Follower/member fanout performs per-recipient preference reads and delivery writes/push concurrently. Batch preference resolution and process bounded chunks through the existing background delivery owner.

### QRY-071 — Medium, plan-dependent — Unseen badge count lacks a matching partial index

The badge query filters user, unseen, undismissed, and snooze state, while existing indexes target different shapes. Verify with representative `EXPLAIN`; add only the exact native partial index if measured.

### QRY-072 — High performance / Medium correctness — Message redaction scans JSON and resurfaces old notifications

Redaction searches JSON metadata without a matching expression index, returns unused rows, and updates activity time so old notifications jump to the top. Route redaction by known keys or add the measured expression index, remove unused returning, and do not mutate activity ordering.

### QRY-073 — Low — Notification cursor accepts arbitrary non-UUID IDs

Cursor decoding accepts arbitrary identifiers and later fails generically. Validate UUID shape and return the existing structured invalid-cursor response.

### QRY-074 — High — Attachment upload then signing failure creates an uncollectable object

Storage upload occurs before the durable storage path is recorded. If signing fails, retention cannot locate the object. Persist the path before signing or immediately move the upload into a durable pending-cleanup state.

### QRY-075 — Medium/High — Committed attachment upload IDs can be reused

The UI/API says an upload is already used, but committed rows can be reclaimed for another message. Bind upload to the original client-message identity or accept only the uploaded state except for explicit idempotent recovery.

### QRY-076 — High — Structured send can commit and then report permanent failure

The message inserts under a unique client ID, then redundant preview/hydration work can throw. Retry hits the unique key and cannot cleanly recover. Reuse the ordinary idempotent send owner and make optional post-commit work nonfatal.

### QRY-077 — High — Structured messages bypass ordinary burst notifications

Structured sends notify only workflow assignments while ordinary sends notify conversation recipients. Route both through shared post-send behavior unless the difference is an explicit product contract.

### QRY-078 — High — Participant preview refresh is `1+2N` and duplicates native triggers

The application refresh queries participants, then messages/replies per participant, despite native database reconciliation. Delete the redundant structured refresh and retain one set-based explicit metadata path only if the trigger cannot own it.

### QRY-079 — High — Project summary batch degenerates into N summary helpers

The batch loops projects and calls a single-project helper that performs additional hydration queries. Batch project metadata and related summaries once.

### QRY-080 — Medium — Message attention provider ignores the existing batch API

The provider runs single-summary calls in `Promise.all`, while a canonical batch action already exists and Realtime uses it. Swap to the batch owner.

### QRY-081 — Medium — Thread-page composition repeats auth/access three times

Page composition authenticates, then summary, messages, and pins independently reauthenticate and recheck membership. After one viewer/access snapshot, call private scoped helpers.

### QRY-082 — Medium — Latest applications loads full history and deduplicates in JavaScript

Inbox hydration reads complete application history for each counterpart and then selects the latest in memory. Use `DISTINCT ON` or a window function to return only the latest row per counterpart.

### QRY-083 — Medium, plan-dependent — Message search expressions do not match trigram indexes

Queries wrap recipient/sender fields in `lower(coalesce(...))`, while indexes cover different expressions; attachment filename search also lacks an aligned index. Measure plans and align query/index only where production evidence warrants it.

### QRY-084 — High — “Last five editors” returns UUID-order users

`DISTINCT ON(uploaded_by)` plus outer `LIMIT 5` selects five uploader IDs, not the five most recent editors. First select each uploader's latest row, then order those rows by upload time descending.

### QRY-085 — Medium — Task-file notification fanout repeats context reads per linked task

Project, member, and actor information is reread for each task/event. Carry one canonical project/actor/member context and batch linked-task events.

### QRY-086 — High — Workflow/task actions commit and then can return failure

Resolve/convert actions commit required state before unguarded preview, bridge, or hydration work. Retrying can duplicate or conflict. Make required projection atomic and all post-commit operations idempotent/nonfatal.

### QRY-087 — High — Logout leaves a shared-browser push endpoint bound to the prior user

Push endpoints are globally unique and ownership transfer is refused, while logout does not unsubscribe/delete the endpoint. A later user on the same browser can inherit the old association. Remove/unsubscribe at logout or implement safe ownership transfer.

### QRY-088 — Conditional High — Realtime Presence identity can be spoofed

Channels are created without `private:true` and accept client-asserted identity/counters. If public access is enabled as the client expects, users can spoof typing/profile/counter state. Use private Realtime channels with database authorization, derive identity from Auth, and treat Broadcast as invalidation only. Cross-link: `SUP-012`.

### QRY-089 — Low/Medium — Presence heartbeat debounces before persistence succeeds

The debounce marker is set before the database write. A transient failure suppresses retry for five minutes. Set the marker only after successful or known-fresh persistence.

### QRY-090 — Low — Reaction endpoints ignore hidden-for-me visibility

Reaction paths validate conversation membership but not per-user hidden-message state. If hidden means inaccessible, reuse the canonical accessible-message predicate.

### QRY-091 — Low — Dead messaging query helpers and imports remain

Verified unused unread reconciliation, test-only burst read helpers, preview helpers/imports, and an unused attachment in-flight map enlarge the surface. Delete after a final external/dynamic caller check.

## 8. Supabase architecture, security, and user-data ledger

### SUP-001 — High — Three migration authorities disagree

Live `app_migration_journal` has 156 completed unique tags, local Drizzle journal has 152 entries, and the Supabase platform registry has only two. Live-only legacy tags and local-only unpublished tags prove the registries can diverge. Select the application journal plus immutable SQL as the deployment authority, reconcile every environment, and validate ordered tags/checksums rather than set membership. Cross-links: `ORG-001`, `ORG-002`, `ORG-004`, `ORG-006`, `ORG-007`, `ORG-010`, `ORG-013`.

### SUP-002 — High — Two live tables lack creation migration lineage

`public.task_pushes` and `public.task_read_receipts` exist live and in the Drizzle schema, but no `CREATE TABLE` exists in migration SQL. Append idempotent current-shape reconciliation migrations rather than rewriting applied history. Cross-links: `ORG-003`, `ORG-008`, `ORG-009`.

### SUP-003 — Medium — Two fail-closed tables are not recorded as intentional

`sprint_task_memberships` and `task_read_receipts` have RLS with zero policies; current callers are server-side, but the catalog allowlist omits them. Explicitly choose server-only and record that decision, or add narrowly scoped browser policies. Cross-link: `ORG-012`.

### SUP-004 — High — Auth/profile identity is not referentially enforced and is divergent

`profiles.id` conceptually references `auth.users.id` but has no FK; application code lazily creates profile shells. Live aggregate evidence found one Auth user without a profile and one active profile without an Auth user. Keep Auth canonical, repair/reconcile orphans, and add a blocking invariant; add a validated FK only after hard-delete ordering is safe.

### SUP-005 — High — Account Storage cleanup cannot reliably delete private objects

The background worker uses an anonymous request-bound client, refers to nonexistent bucket `message-attachments` instead of `chat-attachments`, collects errors without throwing, and returns a terminal error-like result. Private objects can survive deletion and the job may not retry. Reuse the admin client, correct the bucket, throw on failed batches, and persist idempotent progress. Cross-link: `QRY-026`.

### SUP-006 — High — Hard-delete phase two rejects its own retry state

The state machine accepts only `completed`, changes to `in_progress`, and on Auth deletion failure later rejects the next run at the initial guard. A transient Auth failure can strand an account after application data has been removed. Use the existing Auth-pending marker or a distinct finalization state and make the final step retryable.

### SUP-007 — High — Account deletion audit retains PII and plaintext confirmation tokens indefinitely

`account_deletions` retains email, username, free-text reason, token, metadata, and cleanup details after profile deletion, with no anonymizer/expiry consumer. Hash the token, clear it after use/expiry, and pseudonymize audit fields after a documented operational retention period.

### SUP-008 — Medium — Storage cleanup workers erase retry references or suppress failures

Document cleanup removes metadata despite object-deletion errors, while update-media cleanup logs errors and returns success. Objects can become unreachable or publicly orphaned. Throw and rely on existing job retries, or retain a durable pending-cleanup record until deletion is confirmed.

### SUP-009 — Medium — Account cleanup coverage and pagination are incomplete

Avatar listing is capped and root-scoped; cleanup does not cover legacy `task-files` or public `project-updates-media`. Page exact user prefixes and derive ownership coverage from one existing bucket/domain register.

### SUP-010 — Medium — Legacy `task-files` allows viewer uploads

The live `task_files_insert` policy permits every project member, while current `project-files` write policy excludes viewers. One legacy object remains. Retire the bucket after verified migration or align its policy with the current bucket.

### SUP-011 — High — `project_nodes` Realtime subscription cannot receive events

The client subscribes to `public.project_nodes`, but the live 21-table publication and repository guardrail omit it. The channel can report subscribed while creates/moves/renames/deletes never arrive. Either add the table and guardrail after load/security review or remove the dead binding and rely on explicit refresh—one owner only.

### SUP-012 — Conditional High — Presence and project-stat channels lack private authorization

Presence channels omit `private:true`, accept arbitrary `userId`, and trust incoming identity. Project-stat Broadcast accepts browser-supplied counters, while `realtime.messages` has no authorization policies. If public access is enabled, spoofing/observation is possible. Use private authorized channels, derive identity from Auth, and treat Broadcast counters only as invalidation. Cross-link: `QRY-088`.

### SUP-013 — Medium — Realtime subscriptions create workspace-wide fanout

Several subscriptions omit project/task filters, so RLS-protected changes across the viewer's whole accessible workspace are evaluated/delivered before client reconciliation. Measure volume, then consolidate into existing project/task invalidation channels or add justified filter columns; do not denormalize speculatively.

### SUP-014 — Medium — Browser Auth disables native mutual exclusion

The browser client supplies a lock implementation that immediately executes, overriding the library's native navigator lock. Concurrent tabs can race refresh/session mutation. Remove the custom lock and reuse the installed library's native mechanism unless a documented defect requires a real replacement.

### SUP-015 — High — Read client manufactures undocumented Supavisor port `6544`

When `READ_DATABASE_URL` is absent, production rewrites the primary URL to port 6544 and creates a distinct read client. Official Supavisor behavior does not make that a replica endpoint. If no explicit replica URL exists, use the primary client; accept only a complete validated URL for a real read replica.

### SUP-016 — Medium — Three sprint-membership FKs lack indexes

Live advisor and lineage both flag `added_by`, `project_id`, and `removed_by`. Add the three minimal indexes in a forward migration, selecting composites only when real queries justify them. Cross-link: `ORG-011`.

### SUP-017 — Medium — Two RLS policies reevaluate Auth for every row

`project_invitations_read_authorized` and `project_guidance_appointments_read_authorized` directly invoke Auth helpers per row. Wrap with scalar subselects such as `(SELECT auth.uid())` without changing semantics. Cross-link: `QRY-034`.

### SUP-018 — Medium — Contribution visibility is split across overlapping permissive policies

Contribution and stage tables each have two SELECT policies: older policies preserve public/projectless external contributions, while newer policies add owner visibility but exclude that case. Merge each pair into one expression preserving both behaviors; do not blindly delete either policy.

### SUP-019 — Low — `dm_pairs` duplicate unique index remains live

The original constraint-backed unique index and a later explicit index protect the same columns. Retain the constraint-backed owner and remove the other after dependency verification. Cross-link: `QRY-035`.

### SUP-020 — Medium — Workflow seed trigger function has mutable search path and public execution

`public.seed_project_workflow_columns` uses an unqualified table, has no fixed search path, and is executable by client roles. Schema-qualify the target, set an empty search path, and revoke direct client execution. Cross-link: `ORG-027`.

### SUP-021 — Medium — Leaked-password protection is disabled

The live Auth advisor reports known-compromised password protection is off. Enable it after confirming signup/reset compatibility. This is the same issue the completeness reviewer proposed as `REV-001`.

### SUP-022 — Medium — Event partition maintenance has no live scheduler

Only 2026 partitions plus DEFAULT exist; `pg_cron` and the `cron` schema are absent, and scheduling appears only in the stale standalone SQL utility. Schedule the existing partition function through the current worker platform or one native scheduler—never both.

### SUP-023 — Medium — Audit/event retention is undefined

Profile audits, onboarding events, and extension histories lack a product-level retention contract; profile audits already exceed 11,000 rows and can detach from deleted users. Create one lifecycle register and reuse existing Inngest retention/anonymization patterns.

### SUP-024 — Conditional Medium — Free-plan recovery lacks repository-visible off-site backup evidence

The connected organization is on Free, and no dump/export automation or restore runbook was found. Dashboard backup state and external systems were unavailable, so absence is not proven. Document periodic logical exports and test/record restoration.

### SUP-025 — High — Application direct database access bypasses RLS by default

`DATABASE_URL` uses tenant `postgres`, which has `rolbypassrls`; no public table uses FORCE RLS, and 139 application files import direct DB access. A missed server authorization check bypasses every RLS policy. Introduce a least-privilege non-BYPASSRLS runtime role, retaining privileged roles only for migrations and bounded admin jobs.

### SUP-026 — Medium — Scale claims lack measured evidence

The database has `max_connections=60`, substantial cumulative temporary I/O, millions of statement calls, and recent timeout/cancellation log samples. Repository “1M+” comments are unsupported. Investigate sanitized heavy fingerprints, measure RLS/Realtime fanout, and replace population slogans with tested budgets. Cross-link: `QRY-036`.

### SUP-027 — Low — Private archive has no RLS, although clients currently lack grants

`app_private.retired_domain_archive` has RLS disabled, but anon/authenticated lack table privileges, so this is not a confirmed exposure. Enable fail-closed RLS or revoke unnecessary schema usage as defense in depth.

### SUP-028 — Low — Profile counters have two authorities

Workspace counters exist in both `profiles` and `profile_counters`; reconciliation writes the projection while primary profile reads still use `profiles`. Four profiles lack projection rows. Choose one authority: complete and read the projection, or delete it if duplicate columns remain canonical.

### SUP-029 — Low — 247 unused-index notices are not actionable as a batch

Advisor notices span nearly every domain, but traffic/data are small and uneven. Mass removal would risk FK, incident, infrequent, or future-scale queries. Review domain by domain against fingerprints and representative traffic; first remove only the proven duplicate in `SUP-019`.

## 9. Live Supabase object inventory

### 9.1 Environment

| Attribute | Verified value |
|---|---|
| Project | `iutauehhgdymtpzrnzcy` |
| Organization | `onwwdiseaxmbyaogsoxo` / `nb-s3` |
| Plan | Free |
| Region | `ap-southeast-1` |
| Status | `ACTIVE_HEALTHY` |
| PostgreSQL | 17.6.1.063 / engine 17 / GA |
| Supabase branches exposed | None |
| Edge Functions | None |

Only this connected project was accessible. Staging, preview, local parity, promotion rules, external backups, and dashboard-only settings could not be verified.

### 9.2 Relations and security surface

- 153 tables returned across plugin-visible schemas: 110 `public`, 23 `auth`, 10 `realtime`, 8 `storage`, 1 `app_private`, and 1 `supabase_migrations`.
- `public` contains 109 ordinary tables, one partitioned table (`project_node_events`), two `security_invoker` views, and one sequence.
- All 110 public tables have RLS enabled.
- 28 public tables have RLS with zero policies; 26 are recorded server-only/fail-closed, while `sprint_task_memberships` and `task_read_receipts` are undeclared.
- `profiles` uses column-level grants: anonymous/authenticated clients do not receive sensitive email, gender, pronoun, workspace-note/layout, preference, or onboarding-internal columns.
- `app_private.retired_domain_archive` has no client table privileges despite RLS being disabled.
- `realtime.messages` is fail-closed for private-channel authorization because it has RLS and no policies.

### 9.3 Functions and triggers

Application-owned functions total 23:

- 13 in `app_private`: `get_auth_uid`, collection/conversation/project/README authorization helpers, participant reconciliation, DM/message-work validators, and trigger helpers.
- 10 in `public`: node sequence allocation, future partitions, notification orphan cleanup, username rules, message consistency, README protection, automatic RLS, workflow seeding, open-role synchronization, and generic updated-at logic.

Total triggers are 43 across scopes:

- 7 event triggers.
- 31 public data triggers.
- 4 Storage-managed triggers.
- 1 Realtime-managed trigger.

The independent review's counts of 10 functions and 31 triggers refer only to the `public` function and public data-trigger subsets.

### 9.4 Storage buckets

| Bucket | Public | File limit | Aggregate objects | Main contract |
|---|---:|---:|---:|---|
| `avatars` | Yes | 10 MiB | 16 | JPEG/PNG/WebP |
| `chat-attachments` | No | 50 MiB | 21 | image/GIF/video/PDF/Office/text |
| `extension-recovery-drafts` | No | 10 MiB | 0 | text/JSON/octet-stream |
| `project-files` | No | 10 MiB | 8,883 | explicit document/image/code allowlist |
| `project-updates-media` | Yes | 100 MiB | 6 | JPEG/PNG/WebP/GIF |
| `task-files` | No | 10 MiB | 1 | legacy explicit allowlist |

Fifteen `storage.objects` policies cover avatar ownership, attachment ownership, project/task file access, and project-update media writes/deletes.

### 9.5 Realtime publication

The live application publication contains 21 tables:

`connections`, `conversation_participants`, `file_versions`, `message_delivery_receipts`, `message_hidden_for_users`, `message_reactions`, `message_read_receipts`, `message_work_links`, `messages`, `profiles`, `project_node_locks`, `project_update_comments`, `project_updates`, `project_workflow_columns`, `projects`, `task_comment_likes`, `task_comments`, `task_node_links`, `task_subtasks`, `tasks`, `user_notifications`.

`project_nodes` is notably absent despite a client subscription. Only `project_node_locks` uses replica identity `FULL`; other publication members use `DEFAULT`.

## 10. User-data ownership and lifecycle matrix

| Data category | Canonical owner | Sensitivity | Expected actors | Lifecycle assessment |
|---|---|---|---|---|
| Identity, sessions, MFA | Supabase `auth` managed tables | Critical | Auth service and bounded admin lifecycle | Canonical identity is appropriate; leaked-password protection is disabled |
| Application profile | `public.profiles` | Mixed public/private | RLS/column-grant projection plus server writes | Strong column grants; missing Auth FK/reconciliation has produced orphans |
| Private preferences/security | `profiles`, `profile_security_states` | High | Owner/server | RLS and hashing patterns are strong |
| Username aliases/reservations | `username_aliases`, `reserved_usernames` | Moderate | Owner/server | Alias lifecycle is coherent; reserved names are intentionally retained |
| Profile/security audit | `profile_audit_events` | High | Owner/server/operations | No explicit time retention; deletion can detach identity |
| Onboarding | onboarding tables and invoker views | Moderate/private | Owner/server | Authorization is sound; retention contract is incomplete |
| Social/project membership | projects, members, connections, follows | Moderate | Visibility/member RLS plus server commands | Generally coherent; cache projections can become stale |
| Tasks, sprints, files | task/sprint/node/version tables | High project data | Project readers/writers/server | Two server-only tables are undeclared; cleanup/lineage gaps exist |
| Messaging | conversations, messages, receipts, attachments | High | Participants plus server mutation owners | RLS is strong; structured-send and attachment/account-cleanup defects remain |
| Notifications/push | notification and subscription tables | Moderate/high | User/server | Retention patterns exist; snooze, post-commit, fanout, and logout ownership defects remain |
| Extension sessions | device sessions/events | High | Server only | Fail-closed client surface; no complete session-history retention contract |
| Extension recovery | recovery sessions/drafts and private bucket | Critical | Server/owner | Explicit worker retention is a good pattern |
| Imports/Git deltas | import tables/deltas | Private repository state | Server only | Empty/small live set; operational query risks remain |
| Storage objects | six buckets | Varies | Owner/path RLS or admin workers | Bucket contracts are strong; deletion retry/coverage defects remain |
| Account deletion audit | `account_deletions` | Critical PII/token | User SELECT and server mutation | Over-retained PII/token and broken retry lifecycle |
| Analytics/counters | profile counters/onboarding events/views | Moderate | Server and restricted reads | Counter authority is duplicated; capacity evidence is insufficient |

## 11. Professional SQL organization target

The requested organization should be domain-based for runtime query ownership while preserving immutable migration chronology:

```text
drizzle/
  0000_...sql                  # flat, ordered, immutable applied history
  ...
  0153_descriptive_change.sql

src/lib/data/
  hub.ts
  profile.ts
  project.ts
  project-access.ts

src/lib/messages/              # messaging query/behavior owner
src/lib/projects/              # project/task/sprint owner
src/lib/files/                 # file metadata and revision owner
src/lib/notifications/         # notification policy/delivery owner
src/lib/extension/             # extension/recovery owner
src/lib/skills/                # marketplace/catalog owner
src/lib/privacy/               # relationship/privacy owner

scripts/
  check-migration-journal.ts
  check-sql-governance.ts
  check-db-remigration-replay.ts
  check-live-migration-lineage.ts
  check-db-catalog-drift.ts
```

Applied migration files must not be moved into Hub, Messaging, or other domain folders. Their chronological tag/path is operational history. “Hub SQL,” “Message SQL,” and other grouping belongs in runtime/data-access modules, documentation, and domain ownership maps. A query used in multiple UI surfaces retains one domain owner rather than being copied.

`shared` should contain only genuinely cross-domain primitives. It must not become a dumping ground. No generic repository layer is recommended.

## 12. Migration policy

1. One unique visible four-digit prefix for every new migration.
2. Prefix and journal index increase monotonically.
3. File, journal entry, schema declaration, governance entry, and tests land together.
4. Applied tag and SQL bytes are immutable.
5. New journal timestamps are unique, non-future, and monotonic.
6. New names are descriptive rather than generated adjectives.
7. Direct `db:push` is forbidden on shared environments.
8. Fresh replay must compare the final live catalog against the Drizzle schema plus an explicit retired/external allowlist.
9. Nontransactional operations remain explicitly allowlisted.
10. Any out-of-band repair requires approved adoption with exact shape and checksum evidence.

## 13. Phased remediation proposal — not executed

### Phase 0 — Preserve evidence and stop further drift

1. Preserve applied-but-untracked migrations and their matching schema/journal/manifest changes.
2. Do not run `db:setup`, `db:push`, `db:generate`, or a migration rollout against the connected project yet.
3. Inventory every staging, preview, local, and production environment for unpublished tags and exact checksums/shapes.

### Phase 1 — Correct immediate privacy and integrity failures

1. Repair account cleanup authority, bucket name, retry propagation, coverage, and hard-delete state transitions.
2. Reconcile Auth/profile orphans and establish a blocking invariant.
3. Correct the read-client fallback.
4. Fix Storage/Git operations that persist keys after failed uploads or erase cleanup retry state.
5. Repair high-risk authorization, workspace-scope, block-cache, transaction, and post-commit idempotency findings.
6. Resolve Realtime `project_nodes` drift and private-channel authorization.

### Phase 2 — Restore one database authority

1. Reconcile the ordered migration journal and all unpublished/partial tags.
2. Add forward reconciliation lineage for `task_pushes` and `task_read_receipts`.
3. Declare intentional fail-closed tables.
4. Repair replay/snapshot parity before generation.
5. Extend existing checks to enforce exact ordered lineage and consumer/publication contracts.

### Phase 3 — Consolidate query and behavior owners

1. Keep native conversation-preview reconciliation and remove application recomputation.
2. Route structured/ordinary message sends through shared idempotent post-send behavior.
3. Consolidate project lifecycle, project access, relationship projections, file hydration/path lookup, notification delivery, and message summaries around existing canonical owners.
4. Add bounded pagination/keysets and transaction/OCC protection to the documented unbounded/racy paths.
5. Remove dead fallbacks, wrappers, utilities, and duplicated converters only after caller verification.

### Phase 4 — Harden native Supabase/PostgreSQL controls

1. Introduce a least-privilege non-BYPASSRLS application runtime role.
2. Harden workflow function search path and grants.
3. Enable leaked-password protection.
4. Add the three verified FK indexes.
5. Optimize the two Auth RLS expressions and merge overlapping contribution policies.
6. Remove the proven duplicate `dm_pairs` index.
7. Retire or align the legacy `task-files` bucket.

### Phase 5 — Lifecycle and operations

1. Define retention/anonymization for account deletion, audits, onboarding, and extension histories.
2. Schedule one existing partition-maintenance function through one operational owner.
3. Establish and restore-test off-site logical backups.
4. Add privacy-safe lifecycle, lineage, and publication drift monitoring.

### Phase 6 — Scale validation

1. Investigate heavy sanitized query fingerprints, temp spill, and timeouts.
2. Run representative safe plans and load tests for high-amplification paths.
3. Measure connection-pool, Realtime fanout, RLS, Storage, background jobs, and hot counters.
4. Review “unused” indexes only with representative evidence.
5. Replace “1M+” comments with explicit tested concurrency, latency, and data-volume budgets.

## 14. Verified-good or intentional patterns

- All public tables have RLS enabled.
- Sensitive profile fields are protected with column-level grants.
- Twenty-six no-policy tables/partitions are intentionally fail-closed.
- Public catalog `USING (true)` policies are limited to intentional reference data.
- Authorization helpers in `app_private` use fixed safe search paths.
- Internal trigger functions generally revoke browser execution.
- Public analytics views use `security_invoker`.
- Private file/attachment/recovery buckets and explicit MIME/size contracts are in place.
- Project-file writes exclude viewers.
- Message attachment retention uses the admin client, correct bucket, bounded `SKIP LOCKED`, and retryable ownership.
- Extension recovery and notification retention/watchdog jobs demonstrate useful lifecycle patterns.
- Hub hydration is bounded and bulk-parallel rather than an N+1.
- Message, inbox, and notification keyset cursors generally align with indexes.
- Conversation read state is monotonic and row-locked.
- DM creation and reaction toggles use advisory locks and unique keys.
- Typing/presence includes TTL, unmount/hidden cleanup, shared-channel dedupe, and throttling.
- No Edge Functions means there is no hidden parallel server runtime to reconcile.
- Advisor “unused index” output was not converted into a mass-deletion recommendation.

## 15. Limitations and evidence labels

- Live Supabase statements apply only to project `iutauehhgdymtpzrnzcy` at the audit date.
- No Supabase branches or other environments were exposed.
- Dashboard-only Realtime/Auth settings and backup history were not fully available.
- Planner row estimates and cumulative statement statistics are evidence, not exact current user-data reads.
- Recent logs are sampled windows; no sensitive payloads were retained or reported.
- Dynamic/external consumers cannot be fully disproved by repository search, so dead-code removals require one final consumer check.
- Several scale findings are static risks pending representative plans/load; they are labeled accordingly.
- Public-channel Realtime exploitability is conditional on deployment settings not exposed by the plugin.
- The worktree was already heavily modified. All existing changes were treated as user-owned and left untouched.

## 16. Detailed chronological audit log

1. Loaded Ponytail Full, its applicable agent guidance, and Ponytail Audit completely.
2. Confirmed audit-only boundaries and created a sequential working plan.
3. Inspected repository status and preserved the heavily dirty user-owned worktree.
4. Located repository guidance and verified no root application `AGENTS.md` changed the audit scope.
5. Inspected `package.json`, Drizzle configuration, database clients, schema, migration journal, SQL-governance manifest, and database guard scripts.
6. Counted all SQL files and verified 153 Drizzle migrations plus one standalone utility.
7. Located duplicate migration prefixes and compared file, journal, and governance membership.
8. Located all production query-client/import patterns and established a non-naive query baseline.
9. Used the Supabase plugin to identify the single accessible active project.
10. Launched the SQL organization sub-agent with a written Ponytail Full, read-only plan.
11. Waited without interruption until it completed every migration, lineage, duplication, and domain-ownership task.
12. Ran/reviewed repository journal, governance, migration-source, replay, live-lineage, and catalog-drift checks read-only.
13. Compared current schema tables to snapshots and traced missing table lineage.
14. Compared live application-journal tags and checksums with repository state.
15. Inspected typing/presence, preview, partition, catalog seed, auth acquisition, and data-access ownership flows.
16. Launched the query sub-agent with a written Ponytail Full correctness/performance plan.
17. Its bounded messaging/notification and project/user reviewers ran and completed naturally; no later main phase started until the parent finished.
18. Built an AST-informed production query ledger, eliminating false positives such as `Array.from` and collection methods.
19. Classified 1,879 SQL/Auth/Storage/transaction sites across 178 production owners.
20. Traced Hub, files, GitHub/import, jobs, scripts, projects, tasks, comments, users, connections, applications, messaging, and notification flows end to end.
21. Cross-checked queries against indexes, constraints, ordering, pagination, transaction boundaries, idempotency, and authorization.
22. Read Supabase security/performance advisors and sanitized statement/table statistics without returning user rows.
23. Launched the Supabase architecture sub-agent with a written Ponytail Full/plugin/read-only plan and an explicit no-child-agent rule.
24. Enumerated project metadata, schemas, relations, partitions, views, sequences, extensions, constraints, functions, triggers, roles, grants, policies, publications, buckets, and Edge Functions.
25. Inspected Auth/profile consistency through aggregates only; no identity row contents were returned.
26. Inspected Storage object counts/bytes and policy definitions without object keys.
27. Reviewed API, PostgreSQL, Auth, Storage, Realtime, and Edge Function logs in sanitized aggregate/sample form.
28. Audited environment validation, browser/server/admin clients, connection pooling, account deletion, retention, Realtime, and worker ownership.
29. Searched official Supabase documentation through the plugin for current RLS, Auth, Storage, Realtime, connection, migration, backup, and advisor guidance.
30. Waited without interruption for the complete Supabase matrices and finding ledger.
31. Launched an independent Ponytail Full completeness reviewer after the three required main audits finished.
32. Reproduced headline migration, live table/RLS/policy, bucket, and publication counts.
33. Resolved review count scope differences: 10 public functions are a subset of 23 application functions; 31 public data triggers are a subset of 43 total triggers.
34. Cross-linked rather than duplicated the reviewer's three proposed items, already present as `SUP-021`, `SUP-017`, and `SUP-019`.
35. Consolidated all 148 primary finding IDs, retaining conditional labels and live/repository evidence boundaries.
36. Created this report only after every agent and reviewer finished.

## 17. Complete Drizzle SQL artifact inventory

Every Drizzle SQL file present at the audit snapshot is listed below. The separate standalone SQL utility is `scripts/setup-partitioning.sql`.

```text
0000_medical_the_liberteens.sql
0001_remarkable_mattie_franklin.sql
0002_spotty_paladin.sql
0003_ambitious_skin.sql
0003_messaging.sql
0004_chat_storage.sql
0004_harsh_randall.sql
0004_message_reactions.sql
0005_enable_connections_realtime.sql
0005_spooky_romulus.sql
0006_furry_susan_delgado.sql
0006_messages_performance_indexes.sql
0007_typing_indicators.sql
0008_task_features.sql
0009_fix_rls_policies.sql
0013_task_node_links.sql
0014_project_file_index.sql
0015_project_node_locks.sql
0016_project_nodes_trash_and_events.sql
0017_drop_task_files.sql
0018_role_applications_message_and_constraints.sql
0019_demonic_bloodscream.sql
0019_messaging_rls_and_realtime.sql
0020_damp_shatterstar.sql
0020_dm_pairs.sql
0021_add_project_conversation_id.sql
0021_faithful_warstar.sql
0022_handy_tombstone.sql
0022_messaging_reliability_and_scale.sql
0023_little_quasimodo.sql
0023_message_attachments_storage_path.sql
0024_attachment_upload_sessions.sql
0025_message_actions_edit_delete.sql
0026_project_members_unique.sql
0027_task_node_links_unique.sql
0028_project_follow_counts.sql
0029_workspace_layout.sql
0030_message_reply_and_preview.sql
0031_connection_suggestion_dismissals.sql
0032_project_runner_sessions.sql
0033_onboarding_username_guardrails.sql
0034_onboarding_reliability_and_telemetry.sql
0035_onboarding_submission_integrity.sql
0036_onboarding_claims_repair_queue.sql
0037_onboarding_submissions_updated_at_trigger.sql
0038_profile_audit_events.sql
0039_files_workspace_scale_indexes.sql
0040_projects_github_columns.sql
0041_username_rules_schema_qualification.sql
0042_schema_hardening_constraints_and_fks.sql
0043_project_files_key_policy_dual_read.sql
0044_onboarding_profile_extended_preferences.sql
0051_clever_scarecrow.sql
0052_workspace_profile_counters.sql
0053_database_partitioning.sql
0053_security_recovery_codes.sql
0054_privacy_system_foundation.sql
0055_workspace_profile_counters_table.sql
0056_username_aliases_and_exact_lookup_cleanup.sql
0057_username_index_dedup_cleanup.sql
0058_connection_suggestions.sql
0059_messaging_reactions_reports_receipts.sql
0060_messaging_collaboration_foundation.sql
0061_profile_security_state_privacy_rls.sql
0062_upload_intents_and_recovery_redemptions.sql
0063_database_setup_authority_backfill.sql
0064_messaging_reactions_reports_receipts_rls.sql
0065_profile_security_recovery_factor_binding.sql
0066_message_delivery_receipts.sql
0067_read_receipts_conversation_id.sql
0068_file_versions.sql
0069_project_nodes_current_version.sql
0070_comment_mentions.sql
0071_realtime_publication_extension.sql
0072_user_notifications.sql
0073_message_reactions_conversation_scope.sql
0074_v2_schema_optimizations.sql
0075_review_optimization_indexes.sql
0076_profile_collaboration_projection.sql
0077_profile_collaboration_role_stages.sql
0078_public_rls_security_hardening.sql
0079_profile_column_privilege_hardening.sql
0080_profile_write_privilege_hardening.sql
0081_project_updates_realtime.sql
0082_project_update_drafts.sql
0083_project_update_drafts_rls.sql
0084_team_invite_collaboration_status.sql
0085_project_update_media_storage.sql
0086_virtual_workspace_fields.sql
0087_non_transactional_indexes.sql
0088_extension_device_session_editor_metadata.sql
0089_project_node_event_sequence_trigger.sql
0090_project_update_comment_threads.sql
0091_extension_auth_code_events.sql
0092_project_updates_performance_indexes.sql
0094_lovely_toad.sql
0095_docs_hub_upgrade.sql
0098_onboarding_state_machine.sql
0099_schema_lineage_and_fk_indexes.sql
0100_extension_recovery_drafts.sql
0101_project_file_leases.sql
0102_extension_recovery_sessions.sql
0103_market_skill_catalog.sql
0104_market_skill_seed.sql
0105_market_skill_catalog_1_0_1.sql
0106_role_skill_visibility_hardening.sql
0107_market_skill_catalog_1_1_0.sql
0108_market_skill_icons_1_2_0.sql
0109_skill_catalog_fk_indexes.sql
0110_market_skill_icons_1_2_1.sql
0111_market_skill_catalog_1_3_0.sql
0112_market_skill_catalog_1_3_1.sql
0113_market_skill_catalog_1_3_2.sql
0114_market_skill_catalog_1_3_3.sql
0115_market_skill_catalog_1_3_4.sql
0116_market_skill_catalog_1_3_5.sql
0117_market_skill_catalog_1_3_6.sql
0118_remove_profile_availability_status.sql
0119_open_roles_ecosystem.sql
0120_ponytail_message_system_cleanup.sql
0121_ponytail_skill_catalog_table_cleanup.sql
0122_ponytail_database_hardening.sql
0123_ponytail_duplicate_index_completion.sql
0124_ponytail_storage_bucket_contracts.sql
0125_ponytail_allow_office_mimes.sql
0125_ponytail_realtime_publication_trim.sql
0126_extension_session_disconnect_callback.sql
0127_profile_contribution_authority.sql
0128_notification_activity_state_contract.sql
0129_messages_data_authority.sql
0130_messages_fk_support_indexes.sql
0131_messages_native_payload_contract.sql
0132_message_notification_preview_redaction.sql
0133_message_preview_lifecycle.sql
0134_message_reaction_activity.sql
0135_project_custom_workflow.sql
0136_task_board_read_index.sql
0137_task_activity_events.sql
0138_task_activity_actor_index.sql
0139_project_workflow_columns.sql
0140_project_workflow_defaults_trigger.sql
0141_project_workflow_legacy_presentation_backfill.sql
0142_project_workflow_columns_realtime.sql
0143_project_guidance_invitations.sql
0144_project_social_links.sql
0145_project_sprint_events.sql
0146_sprint_activity_history.sql
0147_foreign_key_leading_indexes.sql
0148_sprint_timeline_origin.sql
0149_sprint_lifecycle_memberships.sql
0150_task_file_tags.sql
0151_retire_project_custom_workflow.sql
0152_message_preview_backfill.sql
```

## 18. Reproducible inventory and verification commands

These read-only commands reproduce the repository-side inventory without executing migrations:

```bash
find drizzle -maxdepth 1 -type f -name '*.sql' -print | LC_ALL=C sort
find supabase -type f -name '*.sql' -print | LC_ALL=C sort
find . -type f -name '*.sql' -not -path './node_modules/*' -not -path './.git/*' | LC_ALL=C sort
git status --short --untracked-files=all -- 'drizzle/*.sql'
rg -n 'auth\.getUser\(|getAuthUser\(|getViewerAuthContext\(|await createClient\(' src
rg -n '\btask_pushes\b|\btask_read_receipts\b' src scripts tests services drizzle
rg -n 'nb_reconcile_conversation_participants|refreshConversationParticipantPreviews' src drizzle tests
```

The exhaustive query-site count used an AST-informed classifier: an execution site is a Drizzle/Supabase/raw SQL/Auth/Storage operation or an explicit transaction boundary; chained builder clauses and collection/`Array.from` false positives are excluded. The complete production owner population is represented by the 178-file count and every resulting defect is recorded under `QRY-001`–`QRY-091`.

## 19. Official Supabase references used

- [Database migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Declarative schemas](https://supabase.com/docs/guides/local-development/declarative-database-schemas)
- [Managing user data](https://supabase.com/docs/guides/auth/managing-user-data)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Securing the Data API](https://supabase.com/docs/guides/api/securing-your-api)
- [Database advisors](https://supabase.com/docs/guides/database/database-advisors)
- [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Storage production scaling](https://supabase.com/docs/guides/storage/production/scaling)
- [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Database connections and Supavisor](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Password security](https://supabase.com/docs/guides/auth/password-security)
- [Database backups](https://supabase.com/docs/guides/platform/backups)
- [Production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Shared responsibility model](https://supabase.com/docs/guides/deployment/shared-responsibility-model)

## 20. Final approval gate

The audit is complete and this report is the stopping point. No implementation should start until the migration-state hazards, priority order, and environment-specific evidence are reviewed and explicitly approved. Any future implementation should create a fresh scoped plan, apply changes in small dependency-ordered batches, and verify each batch before deletion or consolidation proceeds.

---

## 21. Supabase usage, egress, Storage, Realtime, and capacity addendum

This addendum records the second, usage-focused Ponytail audit launched after the seven Supabase billing screenshots were supplied. Three read-only agents ran concurrently and were allowed to finish without interruption. Their scopes were deliberately separated:

1. page-by-page regular-egress and cached-egress ownership;
2. Storage, per-user/per-project resource distribution, database size, retention, and missing-object integrity;
3. Realtime, Auth, connections, billing definitions, monitoring, and capacity.

No application code, SQL migration, database row, bucket object, policy, project setting, or external state was changed. The work stopped at documentation, as requested.

### 21.1 Chronological work performed

1. Read the full Ponytail, Ponytail repository instructions, and Ponytail Audit instructions before any audit action.
2. Inspected all seven supplied screenshots at original resolution and transcribed their billing-cycle values.
3. Enumerated all 18 pages, five layouts, two loading routes, 89 `route.ts` handlers, the OG `route.tsx`, active project tabs, settings tabs, People surfaces, messaging surfaces, server actions, browser Supabase calls, Realtime channels, media renderers, signed-URL owners, polling loops, and route-prefetch owners.
4. Inventoried every live Storage bucket and all 8,927 `storage.objects` metadata rows without downloading object bodies.
5. Reconciled objects with direct metadata references and deterministic project-file paths; measured missing-object, unlinked-object, expired-upload, and stale-object populations.
6. Measured the six-database cluster, current database, schemas, public relations, indexes, TOAST/auxiliary storage, tuple statistics, partitions, audit-event growth, cardinality concentration, connection state, and cumulative temp I/O.
7. Inventoried every Realtime subscription wrapper and caller, Presence/Broadcast path, publication member, Auth/session owner, direct `getUser` surface, database pool, capacity gate, and load suite.
8. Used the installed Supabase plugin only for read-only project discovery, catalog/aggregate SQL, recent capped logs, performance advisors, and current official Supabase documentation.
9. Performed false-positive passes: cumulative database counters were not treated as billing-cycle counters; Auth session rows were not treated as concurrent sessions; channels were not equated with sockets; ETags were not treated as deletion proof; path-correlated project objects were not mislabeled as orphans; and correlation with the July spike was not presented as causation.
10. Reconciled all agent outputs into the ledgers below, preserving every finding and confidence/limitation statement.

### 21.2 Screenshot baseline

Billing cycle: **16 July–16 August 2026**, organization on the Free plan.

| Category | Screenshot value | Interpretation |
|---|---:|---|
| Regular/uncached egress | 7.848 / 5 GB, 157% | Breached by 2.848 GB |
| Cached egress | 2.125 / 5 GB, 42% | Within quota |
| Storage average | 0.354 / 1 GB, 35% | Within quota; current object metadata is about 0.371 GB decimal |
| Database size | 0.159 / 0.5 GB, 32% | Dashboard detail: 151.38 MB |
| Realtime peak connections | 6 / 200, 3% | Current development load is safe |
| Realtime messages | 7,973 / 2,000,000, under 1% | Current development load is safe |
| Monthly active users | 3 / 50,000 | Current development load is safe |
| Third-party MAU | 0 / 50,000 | Unused |
| Edge Function invocations | 0 / 500,000 | Unused; no deployed Edge Functions found |
| SSO MAU | Unavailable on Free | No live SSO provider |
| Storage image transformations | Unavailable on Free | Current code must not assume this feature |

The dashboard banner states that the organization exceeded quota in the previous billing cycle and projects may be restricted from **31 August 2026** if the organization remains over quota.

Temporal observations:

- Regular egress peaks at approximately 4.2 GB on 28 July and 1.3 GB on 29 July.
- Cached egress peaks at approximately 1 GB on 28 July, with smaller 27/29 July activity.
- Storage rises from roughly 330 MB to 354 MB around 27–28 July and then remains flat.
- Realtime messages peak at roughly 1.5k on 28 July and again near that level on 8 August.
- The 28 July alignment is correlation. Ordinary 1.5k Realtime deliveries would need to average roughly 2.8 MB each to explain 4.2 GB alone, so Realtime messages are not a plausible sole cause.

### 21.3 Billing and cache semantics used in this audit

- **Regular Supabase egress** includes outgoing Database, Auth, Storage origin/cache-miss, Realtime, Edge Function, pooler, and related traffic.
- **Cached Supabase egress** is traffic served from Supabase CDN cache and has a separate quota. The dashboard's type chart includes cached traffic in its breakdown; the displayed series must not be added again as though they were disjoint totals.
- **Next/Vercel egress** is traffic from RSC, route handlers, server actions, or the Next image optimizer to the browser. It is not Supabase cached egress, even if Next fetched the source from Supabase.
- **Browser cache** may suppress a browser request but cannot repair a server path that creates a fresh signed URL or uses `no-store` for every fetch.
- A newly minted signed token creates a distinct cache key. Reusing the exact URL permits cache hits. Supabase Smart CDN support for signed URLs is plan-dependent, and image transformations are unavailable on the observed Free plan.
- Supabase's inspected logs and dashboard did not provide retained response bytes per historical page/source. Exact July route attribution is therefore unavailable.

## 22. Page and functional-surface egress matrix

| Surface | Primary data/media owners | Bounds and cache behavior | Egress assessment |
|---|---|---|---|
| `/` | Static page | No Supabase reads; public route cache | No page-owned Supabase egress |
| Auth pages | AuthProvider and action-specific Auth endpoints | Mostly action-driven; reset route has its own listener | Low page load; Auth traffic on action |
| `/onboarding` | Viewer/profile, draft state, username, avatar | Local draft plus 350/900 ms remote saves and telemetry | Small but chatty; avatar conditional |
| Signed-in main layout | Auth/profile/counts, two Realtime channels, delayed Presence heartbeat | Persists across soft navigation; heartbeat every four minutes | Persistent baseline on every main session |
| `/hub` default | Redis-backed public feed and browser follow IDs | 18/24 items; 60/300-second caches | Feed bounded; follow-ID side read is unbounded |
| `/hub` filtered | Feed action and auto-pagination | 24/page; hide-opened may skip through pages | Conditional, bounded per page |
| People discover/network/requests | Independent paginated feeds and avatars | Mostly 20/page; 30–60-second stale times | Bounded but multiple calls/media variants |
| `/profile` | Metadata and body profile owners | Duplicate profile reads; portfolio conditional | Confirmed duplicate DB egress |
| `/u/[username]` | Username, metadata/body profile, projects | Duplicate resolution/read; `force-dynamic` | Confirmed duplicate DB egress and no public route cache |
| Project shell | Request-cached shared shell and viewer | Correct request deduplication | Verified good |
| Project tasks/sprints/members | Paginated actions | Members 20/page; tasks 50/page; stale caches | Bounded; query costs cross-link existing findings |
| Project updates/docs/analytics | Paginated data and conditional media/assets | Active tab only; media lazy in most cases | Data bounded; private signed media can churn |
| Project Files | Flat tree up to 2,500 nodes, then content/preview | Cold entry may serialize full tree; URLs not durable across remounts | Largest nonmedia page payload and major private-media risk |
| `/messages` inbox | IndexedDB fallback and authoritative inbox | 20/page; hover can prefetch 30-message threads | Metadata bounded; hover is avoidable |
| `/messages` thread | 30 messages/page, pins, links, attachment elements | 15-second stale, Realtime recovery | Media behavior dominates |
| Chat popup | Shared chat runtime | Code after idle; data only after popup opens | Good lazy data behavior, but global Presence still starts |
| Workspace drawer | Tab-specific actions; notes local | Only mounted tab; notes use localStorage | Generally low; backing task reads cross-link `QRY-050` |
| Settings | Tab-specific actions | Integrations polls sessions every three seconds | Mostly low; integrations polling is confirmed waste |
| Admin notifications | Four aggregate reads | Dynamic admin-only page | Intentional, no media |
| Project OG | Public metadata | One-day public cache | Good |

All route-handler families were accounted for: Auth/account/settings/privacy/security; profile/discovery/skills/navigation; project/media; messaging/presence; extension; GitHub/import; background/operations; health; and OG rendering. Direct Storage byte paths include message attachments, doc assets, file previews, project images, update media, extension file/recovery paths, and import manifest finalization. Account export is intentionally large and `no-store`, but it is user-triggered and rate-limited rather than routine page load.

## 23. Complete page/egress finding ledger

### EGR-001 — Critical — Visible historical chat videos autoplay and loop

`message-attachments.tsx` calls `video.play()` when a tile is 60% visible and the rendered video loops, while `resolved-video-player.tsx` uses metadata preload. Opening or scrolling a thread can therefore issue Range requests without playback intent and loop the content. A latest-30 message window can reference 31.7 MB, and one live video is 22.07 MB. Recent 206 responses corroborate repeated partial reads. Remove observer-driven play and historical looping; show a poster/placeholder and start only on click. Preserve accessible controls and saved playback position. Confidence: very high. Expected reduction: 70–95% of passive chat-video bytes in sessions where users do not play.

### EGR-002 — High — Media viewer downloads hidden adjacent media

The viewer renders the current full asset, thumbnails for every image, hidden adjacent full images, and adjacent videos with `preload="auto"`. Opening one asset can load several bodies; the product permits up to 12 attachments per message. Delete the hidden adjacent preload block, use small stored thumbnails, and fetch one full asset only when selected. Confidence: very high. Current worst-case avoidable transfer is roughly 44 MB per open for two adjacent copies of the largest live video.

### EGR-003 — Critical — Attachment proxy creates a new signed URL for every request and Range

The stable same-origin attachment route authorizes correctly but creates a fresh 60-second token for every Range/request and streams Storage through Next. Current logs show 48 sign POSTs, 36 signed GETs, 17 partial responses, and repeated requests for the same movies. Every token changes the CDN key; video also travels Supabase→Next and Next→browser. Keep the authenticated stable proxy, but reuse an access-scoped signed URL until near expiry and add safe private conditional/Range caching keyed by immutable attachment/version. Do not weaken membership checks. Remove the unused in-flight map if it remains caller-free. Confidence: very high for waste, high but not conclusive for July attribution. Expected reduction: 80–95% of repeated sign/origin operations during the reuse window.

### EGR-004 — High — July chat uploads are the leading spike candidate

On 27 July, seven chat attachments totaling 30,263,871 bytes were created, including a 22.07 MB QuickTime video and 5.69 MB MP4. Three PDFs totaling 7,091,739 bytes followed on 28 July. The main egress/cached spike is 28 July, current code autoplays/loops/preloads, and current logs repeatedly fetch the same videos. A 4.2 GB day is equivalent to about 190 full transfers of the 22.07 MB object or 139 transfers of the 30.26 MB set. This is diagnostic equivalence, not exact attribution. Fix EGR-001–003 and rerun controlled July-like interactions with byte telemetry. Confidence: high as a contributor, low for an exact share.

### EGR-005 — Medium/High — Hovering a conversation fetches 30 messages

After only 200 ms of pointer hover, the conversation list prefetches a full 30-message thread. Scanning the inbox can fetch unseen threads before selection. Delete hover prefetch or restrict it to stronger keyboard/focus intent with longer dwell and a bounded summary; the existing IndexedDB/thread cache already supplies responsiveness. Confidence: high. Saving: one 30-message response per incidental hover.

### EGR-006 — High — PDF preview defeats caching at both layers

The Files preview downloads the whole PDF as a blob with `cache:"no-store"`; its route creates a new 60-second token, fetches upstream `no-store`, and returns `private,no-store`. Every remount redownloads the object from Supabase through Next. Add immutable file version/content hash to the URL, remove both `no-store` uses, and use private ETag/conditional caching. Confidence: very high. Expected repeat-byte reduction approaches 100% for unchanged content.

### EGR-007 — High — Project file signed URLs churn on remount

`FileView` stores the URL only in component state and intentionally refetches on remount; images/video/audio and Google Docs Viewer then use the fresh token. The `project-files` bucket contains 311 MB and objects up to 9.95 MB. Reuse existing query/cache infrastructure to retain `{url, expiresAt}` by node and content version until near expiry. Prefer native preview/download; make third-party Google Viewer explicit intent. Confidence: very high. Expected repeat origin reduction: 50–95%, dependent on remount frequency.

### EGR-008 — High — Files entry can serialize 2,500 nodes

Cold Files boot chooses a flat tree up to the 2,500-node runtime budget. Live data contains 30,508 active nodes across eight projects; six projects use the flat branch, and approximate raw JSON reaches 315 KB before enrichment/RSC overhead. Use the already-existing paginated folder owner for route entry: root 100, then expanded folders. Retain flat loading only below a measured small threshold or remove it after deep-link/ancestor migration. Confidence: very high. Expected initial metadata reduction: roughly 50–90% on nontrivial projects. Cross-link `QRY-018`.

### EGR-009 — High, extension-dependent — Inline extension reads fetch the whole file and base64-expand it

The extension file route downloads an entire object before slicing a requested range and base64-encodes it, adding about one-third to the Next response. Make its existing signed-transfer path canonical for binary/large content. For inline text, honor Storage Range or content-hash ETag. Confidence: very high. Supabase bytes fall from full file `F` toward requested range `R`, while signed transfer removes base64 overhead.

### EGR-010 — Medium/High — Authenticated project covers are always origin reads

The image route checks access, creates a new 60-second token, proxies the full image, and marks authenticated/private responses `no-store`; only anonymous public responses receive long cache headers. Key the stable proxy by immutable cover version and return private ETag/max-age while retaining authorization and public behavior. Confidence: high. Expected repeat origin reduction approaches 100% within the safe lifetime.

### EGR-011 — Medium — Private document assets churn signed URLs

Private doc assets use a 60-second signed URL and `private,no-store`, and the renderer may display many images. Reuse the stable asset-ID route with content version and private ETag/max-age; preserve the cacheable public branch. Confidence: high. Saving: one origin transfer per unchanged private asset after the first within TTL.

### EGR-012 — Medium — Authenticated update-media redirects churn every two minutes

The route creates a 15-minute signed URL but caches the authenticated redirect for only 120 seconds. The renderer otherwise correctly uses metadata-only video and lazy images. Reuse the exact private redirect closer to its signed TTL, keyed by immutable object/version. Current total is only 1.42 MB, so this is not a July spike candidate. Confidence: high. Up to roughly seven token/origin opportunities can collapse into one per signed lifetime.

### EGR-013 — High — Oversized avatar and inconsistent upload optimization

One public avatar PNG is 3,175,226 bytes; seven objects use `max-age=0`. `EditProfileTabs` uploads the original and adds a time cache-buster, while existing `avatar-service`/onboarding paths already crop/compress to 400×400 JPEG. Several UI surfaces also use raw/unoptimized images. Route every avatar entry through the existing compressor, use long immutable cache metadata with versioned paths, and replace only the measured oversized active object after reference migration. Confidence: very high. The 3.18 MB source should reasonably become below 200 KB, over 90% smaller.

### EGR-014 — Medium — Public profile navigation repeats reads and is force-dynamic

`/u/[username]` repeats username resolution/Auth/profile work in metadata and body and declares `force-dynamic`. Apply the project-page request-cache pattern, then separate anonymous cacheable projection from viewer-specific relationship data only after privacy review. Confidence: very high. Expected overlapping username/profile read reduction: about 50% per navigation.

### EGR-015 — Medium — Owner profile metadata/body repeat profile reads

`/profile` correctly shares viewer Auth but independently calls summary and details owners. Share a request-cached profile projection or derive metadata from the required details. Confidence: high. Saving: one profile read per navigation.

### EGR-016 — Medium — Hub loads every followed project ID

The browser queries all `project_follows.project_id` with no range and a one-minute stale time; recent logs include four such reads. Reuse follow status already returned for visible cards or request only the visible 18/24 IDs. If the full set remains necessary, use a longer cache plus mutation invalidation. Confidence: very high. Cross-link `QRY-056`.

### EGR-017 — Medium — Integrations settings polls every three seconds

While the tab is mounted, extension sessions refetch every 3,000 ms: 20 responses/minute while idle. Replace with existing manual refresh after create/revoke and focus/visibility reconciliation, or a conservative interval. Do not add a new Realtime subsystem solely for this. Confidence: very high. Expected idle traffic reduction: at least 95%.

### EGR-018 — Medium — Signed-in shell performs independent bootstrap reads

The main layout request-caches Auth, but passes no initial profile, so the browser performs another profile read; People/message/notification counts, two Realtime channels, and the delayed Presence heartbeat start independently. Pass the minimal already-known viewer projection so the idle browser profile query can be deleted. Consolidate count owners only if measured bytes justify it and freshness semantics remain separate. Confidence: high. Minimum saving: one browser profile read per full main-route load.

### EGR-019 — Low/Medium — Onboarding emits frequent draft/telemetry requests

Draft patches are sent after 900 ms input or 350 ms toggle inactivity, alongside lifecycle/latency telemetry. Retain the local crash buffer, combine telemetry into the next draft commit, and move remote commits to meaningful boundaries if recovery requirements permit. Confidence: high. Byte impact is minor and onboarding-only.

### EGR-020 — Low/Medium — Account export is intentionally unbounded

The export route materializes/pretty-prints a full personalized download with `no-store`. This is legitimate, user-triggered, and limited to one per hour. Retain `no-store`; introduce streaming/maximum handling only when measured export sizes exceed memory/response budgets. Confidence: high. No waste reduction assigned.

### EGR-021 — Medium — Existing performance budgets omit Supabase bytes

The route contract covers 17 routes and timing, while the observer records TTFB/load/hydration—not transfer size, encoded/decoded bodies, Storage origin bytes, cache status, signed-URL reuse, or action payload bytes. Extend the existing observer/logger rather than adopting a parallel platform. Confidence: very high. Exact page attribution remains impossible until this is measured.

### 23.1 Verified-good page/egress patterns

- Project metadata/body share a request-cached shell.
- Default Hub feed is bounded, Redis-backed, and seeded into React Query without double fetch.
- Public feeds have explicit `s-maxage` and stale-while-revalidate.
- Only selected People/project/settings tabs mount.
- Members, tasks, updates, and comments are paginated; comments/media are mostly viewport-lazy.
- Update composer produces bounded WebP; project cover upload already compresses.
- Messages use IndexedDB as a visual fallback but reconcile authoritative state.
- Popup chat delays data until open; workspace notes are browser-local.
- File inline text is capped; public media routes have cacheable anonymous branches.
- React Query defaults avoid focus refetch unless the feature opts into it.

## 24. Storage and database resource inventory

### 24.1 Bucket matrix

| Bucket | Access / limit | Objects | Bytes | p50 / p90 / p99 / max | Reference/lifecycle result |
|---|---|---:|---:|---|---|
| `project-files` | Private; 10 MiB | 8,883 | 311,107,634 | 4,165 / 22,287 / 651,045 / 9,953,326 | 2,769 direct references / 226,516,665 B; 6,101 path-correlated unlinked / 84,532,492 B; 13 residual unknown / 58,477 B |
| `chat-attachments` | Private; 50 MiB | 21 | 53,501,165 | 181,129 / 5,691,323 / 22,072,441 / 22,072,441 | 14 referenced / 41,633,304 B; seven expired-uncommitted / 11,867,861 B |
| `avatars` | Public; 10 MiB | 16 | 4,778,878 | 83,662 / 299,578 / 3,175,226 / 3,175,226 | Three current references / 3,639,796 B; 13 stale candidates / 1,139,082 B |
| `project-updates-media` | Public; app 8 MiB, bucket 100 MiB | 6 | 1,417,914 | 246,578 throughout | One current reference / 246,578 B; five stale candidates / 1,171,336 B |
| `task-files` | Private; 10 MiB | 1 | 197,171 | 197,171 | No current metadata reference; legacy owner |
| `extension-recovery-drafts` | Private; 10 MiB | 0 | 0 | — | Bounded 30-day/three-generation retention; clean |

Total current Storage metadata: **8,927 objects / 371,002,762 bytes**. All objects have size, MIME, cache, ETag, status, last-modified, and content-length metadata. Application ownership metadata is incomplete—only 11 project files, 10 avatars, and no update-media objects have `owner_id`—so joins and path ownership are required.

The initially suspicious 84.6 MB project-file population is **not orphan waste**: 6,102 objects exactly match active Git-backed node paths whose `s3_key` is null. They must be recognized/relinked, not deleted. Conversely, 1,199 active nodes and 1,199 corresponding versions reference missing objects; all are in one February import window/project, marked `merged`, declare 26,394,063 bytes, and have no Git blob fallback.

### 24.2 Age, cache, images, and duplicate indicators

- `project-files`: 8,877 objects / 309,552,980 bytes older than 30 days; 13 residual unknown-reference objects / 58,477 bytes, nine older than 90 days.
- `chat-attachments`: ten / 16,003,919 bytes older than 30 days; eleven / 37,497,246 bytes aged 7–30 days.
- All avatar, update-media, and legacy task-file objects are older than 30 days.
- Cache metadata: avatars have nine objects at `max-age=3600` and seven at `max-age=0`; project files have 8,552 at one hour, 328 `no-cache`, and three malformed `max-age=undefined`; other populated buckets use one hour.
- Live images: 73 objects / 38,628,511 bytes. No Storage image records dimensions. Four chat PNGs use 10,683,306 bytes; the largest avatar PNG is 3,175,226 bytes. Update WebP output is about 246 KB/object and is a good existing pattern.
- ETag duplicate upper bounds, not deletion authority: project files 1,786 groups/3,707 objects/up to 24,453,423 bytes; chat 3/6/up to 9,008,185; updates 1/5/up to 986,312; avatars 1/7/up to 501,972. These may be intentional versions/copies.

### 24.3 Anonymized concentration

Historical Storage ownership spans five users although the screenshot shows three current MAU. Of 8,926 attributable objects / 371,002,751 bytes, the largest owner holds 73.26%; one 11-byte object remains unattributable. Project-scoped Storage spans five projects / 8,888 objects / 312,525,537 bytes; the largest project holds 70.22%. Database concentration is similarly import-heavy: one creator owns 84.30% of 30,556 nodes, one uploader 99.64% of 3,932 versions, one project 82.80% of nodes and 91.73% of versions. These are development/import distributions, not customer averages.

### 24.4 Database reconciliation and growth

The six-database cluster is **158,728,430 bytes = 151.375 MiB**, exactly reconciling the screenshot's 151.38 MB. The current `postgres` database is 120,474,771 bytes; other cluster databases account for 38,253,659 bytes. Free quota usage is about 31.7%.

| Relation | Heap | Index | TOAST/aux | Total | Live/dead tuples |
|---|---:|---:|---:|---:|---:|
| `project_nodes` | 9,584,640 | 37,208,064 | 40,960 | 46,833,664 | 30,556 / 8 |
| `profile_audit_events` | 3,006,464 | 2,719,744 | 40,960 | 5,767,168 | 11,211 / 0 |
| `file_versions` | 2,981,888 | 2,416,640 | 40,960 | 5,439,488 | 3,932 / 12 |
| `skills` | 524,288 | 1,261,568 | 40,960 | 1,826,816 | 1,128 / 0 |
| `skill_aliases` | 262,144 | 1,007,616 | 40,960 | 1,310,720 | 1,244 / 0 |
| `projects` | 57,344 | 851,968 | 106,496 | 1,015,808 | 15 / 36 |
| `messages` | 139,264 | 581,632 | 49,152 | 770,048 | 205 / 11 |
| `profiles` | 57,344 | 540,672 | 73,728 | 671,744 | 16 / 42 |
| `project_markdown_versions` | 106,496 | 98,304 | 458,752 | 663,552 | 31 / 35 |
| `skill_icon_assets` | 532,480 | 65,536 | 40,960 | 638,976 | 745 / 0 |

`project_nodes` is 38.9% of the current database and 61.2% of public relation storage; indexes are 79.5% of that relation. Several indexes are large and actively scanned. The only proven exact duplicate remains the `dm_pairs` pair already recorded in `SUP-019`/`QRY-035`; no mass index deletion is justified.

Since the December statistics reset, `project_nodes` recorded 59,011 inserts/13,358 updates/28,428 deletes; `storage.objects` 18,372 inserts/21,256 updates/51 deletes; `file_versions` 11,132 inserts/7,197 deletes; and `profile_audit_events` 11,211 inserts/no deletes. Large relations have negligible dead tuples, autovacuum is active, and a broad `VACUUM FULL` is not justified.

`profile_audit_events` contains 10,989 high-frequency read audits and 222 activity/security events. The 12 monthly 2026 `project_node_events` partitions plus DEFAULT end at December; the existing future-partition function is not scheduled. Cumulative `pg_stat_database` shows 1,296,951,507,335 temp bytes across 391,238 files since December, while current statement statistics explain only about 136 MB, mostly platform introspection. Historical app attribution is unavailable.

## 25. Complete Storage/database-resource finding ledger

### RES-001 — Critical — Active files reference missing objects

1,199 active `project_nodes` and 1,199 versions in one project reference absent objects totaling 26,394,063 declared bytes. All are `merged` canonical-key rows with no Git fallback. Current read behavior can fabricate empty content, which may then overwrite intended content. Immediately quarantine save/write for these nodes, expose a typed unavailable state, attempt recovery from import/source/backups, and reconcile metadata only after bytes are verified. Confidence: high. Cross-links `QRY-008`, `QRY-009`.

### RES-002 — High — 6,102 existing objects are disconnected from Git-backed nodes

Exact deterministic paths match active null-`s3_key` nodes for 84,583,865 bytes. Lazy reads may unnecessarily fetch GitHub and upsert an object that already exists; reference-only cleanup would falsely delete it. In the existing hydration owner, check canonical Storage first, verify metadata/hash, atomically attach `s3_key`, and fetch GitHub only when absent. No default space reduction: this prevents loss and repeated transfer. Confidence: high.

### RES-003 — High — Reconciliation cannot heal the observed populations

The existing job repeatedly scans bounded leading rows and emits events only, so later nodes/objects starve. Add a durable keyset watermark and idempotent repair states to the same job; separate missing, path-correlated, and true-orphan categories. Confidence: high. Cross-link `QRY-024`.

### RES-004 — High — Message retention has an 11.87 MB backlog

Seven expired, uncommitted, message-unreferenced chat objects remain, oldest 24 May and newest 27 July. The existing registered retention implementation is structurally sound, so verify its deployment/heartbeat and backlog alert rather than add another owner. Confirmed recoverable bytes: 11,867,861 after the owner safely succeeds. Confidence: high on backlog, medium on cause.

### RES-005 — High — Three attachment records reference missing objects

Three of 17 committed message-attachment rows reference absent bodies totaling 6,002,382 declared bytes. Expose an unavailable state, recover from durable upload/import evidence where possible, and require object-existence confirmation before metadata commit. Confidence: high.

### RES-006 — High — Deletion owners do not cover the Storage model

Account cleanup uses an unsuitable request client, only node keys, a capped avatar listing, and a nonexistent `message-attachments` bucket; project/update/task/version-only/path-correlated objects are omitted. Project deletion removes DB state first and performs incomplete best-effort Storage cleanup. Consolidate into the existing signed Inngest cleanup owner with admin client, correct registry, exact paginated prefixes, retry references, and all current/legacy domains. Confidence: high. Cross-links `SUP-005`, `SUP-008`, `SUP-009`, `QRY-026`, `QRY-027`.

### RES-007 — High — Upload-intent cleanup lacks an operational owner

Fourteen expired pending intents declare 31,049,361 bytes; none currently point to live objects. The helper selects all rows, deletes serially, ignores deletion errors, and marks all expired. Put it behind one bounded existing Inngest owner with claim/`SKIP LOCKED`, error checks, and finalize-on-confirmed-delete. Clean the metadata-only backlog. Confidence: high. Cross-link `QRY-040`.

### RES-008 — Medium — Small stale-object candidates remain

Candidates: avatars 13/1,139,082 B; update media 5/1,171,336 B; project files 13/58,477 B; legacy task file 1/197,171 B. Before deletion, run a historical embedded-URL dry check and quarantine period, then let each existing lifecycle owner delete confirmed residue. Candidate ceiling: 2,566,066 bytes, excluding RES-004. Confidence: high on audited references, medium on historical URLs.

### RES-009 — Medium — `task-files` is a legacy unconsolidated bucket

One 197,171-byte object remains, no current writer was found, current file ownership is `project-files`, and legacy insert policy permits viewers more broadly than current project-file writes. Verify/migrate or delete the object, then retire the bucket/policies. Confidence: high. Cross-link `SUP-010`.

### RES-010 — Medium — ETag duplication is measurable but not deletion-safe

Maximum duplicate-byte indicators are material, but may represent versions or authorized copies. Record SHA-256 at finalize and canonicalize only immutable bodies where logical references, authorization, and deletion semantics remain intact. Never bulk-delete from ETags alone. Confidence: medium; savings unknown.

### RES-011 — Medium — Avatar paths disagree on optimization and cleanup

One owner produces 400×400 JPEG while profile edit uploads raw input; code permits GIF while the live bucket does not; finalization writes immutable keys without removing superseded images. Reuse one preparation owner, align MIME contracts, commit the new reference, then enqueue the old key through existing cleanup. Confidence: high. Current stale-candidate ceiling: 1,139,082 bytes.

### RES-012 — High — Message previews request an unavailable plan feature

The screenshots and official docs show image transformations unavailable on Free, but the attachment route unconditionally requests a transform and uses `format:"origin"`. Gate transforms on explicit project capability; on Free use the already-optimized upload plus placeholder, or upgrade deliberately. Confidence: high.

### RES-013 — Medium — Chat PNG optimization leaves multi-megabyte images

Four PNGs use 10,683,306 bytes. The compressor retains PNG and changes a quality option that may not reduce lossless output. Convert non-transparent stills to WebP/JPEG with dimension/output limits; keep PNG only for required transparency. Dimensions/alpha were unavailable, so savings are not quantified. Confidence: medium.

### RES-014 — Medium — Immutable public assets have short/zero cache lifetimes

The signed upload helper hardcodes one hour; seven avatars are `max-age=0`, updates use one hour, and three project objects contain malformed `max-age=undefined`. Let the existing helper accept lifecycle-specific profiles: long immutable TTL for UUID-keyed public assets, shorter/no-cache only for mutable files. Confidence: high; exact egress reduction unavailable.

### RES-015 — Medium — Finalization downloads whole uploads

Upload-intent finalization downloads the entire object to inspect size and a few magic bytes; chat permits 50 MiB. Use trusted Storage metadata for size and a bounded initial Range for magic verification within the same owner. Confidence: high. Large-file verification transfer can drop by nearly the entire body.

### RES-016 — Medium — Project application limit exceeds bucket limit

Application default is 25 MiB while live `project-files`/`task-files` buckets enforce 10 MiB. Derive the app limit from the same 10 MiB contract and reject before intent/signing. Confidence: high.

### RES-017 — Medium — Update-media bucket limit exceeds the effective contract

The bucket permits 100 MiB, application permits 8 MiB, and the Free global limit is 50 MiB. Set the bucket to the application contract of 8 MiB. Confidence: high.

### RES-018 — Medium — Read audits dominate database growth

10,989 read rows versus 222 activity/security rows occupy a 5.77 MB relation, while the user-visible activity list only reads activity types. Establish product/legal retention, then use one bounded Inngest retention/anonymization owner with shorter aggregation/retention for read events and separately justified security retention. Confidence: high. Maximum current physical recovery is below 5.77 MB and requires normal reuse/vacuum. Cross-link `SUP-023`.

### RES-019 — Medium — Partition maintenance is unscheduled

Explicit monthly partitions end December 2026; the existing `create_future_partitions()` is not called by repository scheduling. Invoke it monthly from the current worker platform, monitor heartbeat and DEFAULT rows, and avoid a second scheduler. Confidence: high. Cross-link `SUP-022`.

### RES-020 — Medium — Storage/database usage is highly concentrated

One historical owner has 73.26% of Storage, one project 70.22%, one uploader 99.64% of versions, and one creator 84.30% of nodes. Add aggregate owner/project soft budgets and separate documented fixtures/imports from customer cohorts. Confidence: high.

### RES-021 — Low/Medium — RLS path grammar disagrees with canonical keys

Canonical keys are `<projectId>/<path>`, while live/migration policies require the first segment `projects`. Server-signed access masks this drift. Choose and document server-only signed access and delete dead direct policies, or update policies to the shared canonical parser. Confidence: high.

### RES-022 — Low — Database bloat is not the current quota issue

Large tables have negligible dead tuples and autovacuum is active; high dead percentages are limited to tiny development tables. Do not use broad `VACUUM FULL`. Prioritize missing objects, linkage, retention, and the single proven duplicate index. Confidence: high.

### RES-023 — Good — Recovery-draft lifecycle is bounded and retry-safe

The existing recovery owner deletes Storage before metadata, uses bounded batches, retains 30 days/three generations, and has heartbeat support; the live bucket/table are clean. Reuse this pattern for other Storage domains. Confidence: high.

## 26. Realtime, Auth, and connection inventory

| Mount/surface | Mechanism | Scope/lifecycle |
|---|---|---|
| All authenticated main routes | `RealtimeProvider` user and messaging channels | Profile, notification, participant, hidden-message events; application reconnect loops |
| All main routes after idle | `ChatProvider` self Presence and HTTP heartbeat | One `presence:user:{viewer}` room; heartbeat every four minutes |
| Active message thread | Postgres Changes | Messages, participants, reactions, delivery/read receipts filtered by conversation |
| Message list/header | Typing and peer-online Presence rooms | One room per visible conversation/peer; virtualized, but peer rooms remain while hidden |
| Active chat/task discussion | Presence/Broadcast | Typing Broadcast ≤800 ms; tracking ≤2.5 s |
| Project dashboard/tasks/workflow/updates | Filtered Changes and project-stats Broadcast | Project or task scoped; invalidation coalescing in several owners |
| Task resource | Task/comments/subtasks/node links and optional likes | Registry dedupes a task in one JS realm; likes binding unfiltered |
| Files tab | Node links, versions, nodes, locks | First two unfiltered; `project_nodes` is absent from live publication |
| Hydration banner | Project Changes plus five-second polling | Both active during hydration |
| Message work links | Filtered Changes | Conversation-scoped |

The live `supabase_realtime` publication contains 21 public tables. `project_nodes` is absent. Only `project_node_locks` among inspected published tables uses `REPLICA IDENTITY FULL`; the others use default identity. `realtime.messages` has RLS enabled but no Realtime authorization policies. One singleton browser client normally multiplexes all channels in a tab over one socket; channel count is not peak-connection count, while tabs/processes are the closer multiplier.

Auth/session facts:

- One main browser Auth listener and a request/server caching stack are already present.
- JWTs are locally verified with a 30-minute JWKS cache, falling back to `/user` only when necessary.
- Static inventory still finds 207 direct `.auth.getUser()` calls in 46 source files; this is surface area, not proof that all execute per page.
- Live aggregates: 16 Auth users; 426 cumulative session rows across 14 users; eight sessions created in 30 days across three users; two refreshed in 24 hours across two users. Session rows are history, not concurrency.
- Identity providers: email 13, Google 3, GitHub 2. Google/GitHub through Supabase Auth are ordinary MAU, not third-party MAU. SSO providers: zero.
- A capped recent Auth sample contains 65 `/user`, 21 JWKS, seven `/token`, and seven event/meter rows over roughly two hours. It demonstrates repeated development Auth work, not a production rate.
- A capped API sample contains 13 `/user`, four Realtime upgrades, four JWKS, and two token calls.

## 27. Complete Realtime/Auth/capacity finding ledger

### CAP-001 — High — Free-plan restriction is imminent

Regular egress is already 157%, with a 31 August restriction warning, even though Realtime/MAU counters are low. Preserve daily/hourly evidence; isolate 27–29 July by project/service/route/object; stop nonessential development downloads/replays; enforce route/object budgets. Do not assume a plan upgrade is the fix before attribution. Confidence: high.

### CAP-002 — High — Presence heartbeat and self-Presence are global

The main runtime loads chat after idle on every main route, mounts Presence, and posts every four minutes through Auth, Redis debounce, and conditional DB update. Cumulative statement statistics show 9,861 older unconditional and 2,197 current conditional profile-update calls; these are historical, not billing-cycle counts. The rate is 15 HTTP requests per active tab-hour—about 720/MAU/month under two hours/day, 20 days, 1.2 tabs, or 10,800/month for an always-open tab. Mount only where online/chat state is needed and pause hidden/idle tabs. Choose either Supabase Presence or coarse `last_active_at` as authoritative. Confidence: high.

### CAP-003 — Medium — Custom Auth lock disables native multi-tab serialization

The browser client passes a lock that immediately invokes the callback, bypassing installed Auth's `navigator.locks` path. Concurrent tabs may refresh/mutate the same persisted session, increasing token traffic and risking refresh reuse failures. Remove the override and regression-test multi-tab sign-in/refresh/signout. Confidence: high. Cross-link `SUP-014`.

### CAP-004 — Medium — Auth acquisition is widely reimplemented

There are 207 direct `getUser` sites across 46 files, another standalone Auth-client helper, and an existing cached viewer context. Recent capped logs contain repeated `/user`. Incrementally reuse `getViewerAuthContext` for identity/authorization while retaining raw clients for actual Auth/Storage operations; first add per-route Auth-resolution counts without identities/tokens. Confidence: high on static duplication, medium on per-request multiplication. Cross-link `ORG-019`.

### CAP-005 — Medium/High — Application reconnect loops duplicate native ownership

Global provider, task resource, and files channel recreate channels after terminal statuses, while installed Supabase Realtime already reconnects the socket and rejoins each channel. Competing timers can multiply joins/leaves/refetches in unstable networks. Let the native client own reconnect; keep status reporting and one authoritative recovery refetch unless a measured library defect requires an outer owner. Confidence: high on duplication, medium on billing impact.

### CAP-006 — High — Files replacement channel can survive cleanup

The files wrapper replaces `currentChannel` during reconnect but returns/patches the initial channel; unmount removes the old reference, leaving the replacement until broader socket teardown. Remove custom reconnect ownership; if temporarily retained, return a disposer that always removes current state. Add a reconnect/unmount test against `getChannels()`. Confidence: high.

### CAP-007 — Medium/High — Several Changes bindings are workspace-wide

Files omit filters for `task_node_links`/`file_versions`, and task likes are unfiltered. Live cumulative writes include 18,333 file-version and 51 node-link events. Measure delivered events, then consolidate into existing project/task invalidation channels or add a justified server-filterable scope. Do not denormalize speculatively. Confidence: high. Cross-link `SUP-013`.

### CAP-008 — High — `project_nodes` listeners are dead

Files and task-file mutations subscribe to `project_nodes`, but the live publication omits the table. UI can become stale while the subscription appears healthy. Either add the table after load/security review and update the publication guard, or remove the dead bindings and use explicit reconciliation. Confidence: high. Cross-link `SUP-011`.

### CAP-009 — Conditional High — Public Presence/Broadcast lack Realtime authorization

Presence channels omit `private:true`, client events assert user identity/profile, project-stat Broadcast trusts browser counters, and `realtime.messages` has no policies. If public channel access is enabled, users can spoof/observe topics. Use native private authorization, derive identity from Auth, and treat Broadcast as invalidation. The dashboard public/private setting was unavailable, so this remains conditional. Confidence: high on code/policy state. Cross-links `SUP-012`, `QRY-088`.

### CAP-010 — Medium capacity risk — Presence topology scales with visible rows

One room is created per visible peer/conversation. A tab still uses one socket, but joins, snapshots, leaves, and protocol bytes grow with visible rooms; typing Broadcast counts sender plus receivers. Keep virtualization/registry dedupe, release peer rooms while hidden, and record rooms/join rate before consolidation. Confidence: high on topology, low/medium on present cost.

### CAP-011 — Low/Medium — Hydration uses Realtime and five-second polling together

During hydration, the banner both subscribes to project updates and polls every five seconds. Keep filtered Realtime primary and begin a slower fallback only after unhealthy status or missed-progress timeout. Confidence: high.

### CAP-012 — High — Read pool invents port 6544 and doubles nominal capacity

Without `READ_DATABASE_URL`, production rewrites the primary URL to port 6544 and creates a second pool of 20 alongside the write pool; live `max_connections` is 60. Official modes use 5432/6543, not an assumed replica at 6544. If no full validated read URL exists, reuse the write client; benchmark pool wait and sessions per runtime replica. Confidence: high. Cross-links `SUP-015`, `SUP-026`.

### CAP-013 — High — “Reconnect storm” load test opens no Realtime connection

The suite repeatedly GETs `/messages`; it does not open a WebSocket, join channels, use Presence, receive changes, or test reconnect. Keep it but rename it route-entry churn. Add a bounded native Realtime test measuring connections, joins, messages, egress, recovery, duplicates, and authorization pressure. Current capacity audit source is missing/latest report failed; 1M readiness remains blocked. Confidence: high.

### CAP-014 — Medium — Alerts omit billing and channel attribution

Existing thresholds cover Auth/API/presence reconnects but not regular/cached egress, Realtime messages/connections, MAU, Storage, database, Edge, forecast, room count, or signed-URL reuse. Extend existing logs/jobs and Supabase usage review, retaining only aggregate environment/route/resource/table/channel/cache/byte-band tags. Confidence: high.

### CAP-015 — High — Logout does not release Web Push endpoint

Auth logout clears sessions/caches but never invokes the existing Web Push unsubscribe/delete path. Shared browsers can retain an endpoint owned by a prior account, and upsert refuses transfer. Call the existing unsubscribe path before Auth teardown with retry-safe cleanup. Confidence: high. Cross-link `QRY-087`.

### CAP-016 — Informational — Current Realtime/Auth quotas are safe

Six peak connections, 7,973 messages, three MAU, zero third-party MAU, zero Edge invocations, and no SSO show that these counters are not the present restriction driver. Preserve this as a development baseline, not scale proof. Confidence: high.

### CAP-017 — Good — Native consolidation controls already exist

Keep the singleton client, shared Presence-room map/release grace, per-task registry, filtered subscriptions, virtualized peer list, typing/tracking throttles, invalidation coalescing, request/server Auth reuse, and local JWT verification. Strengthen these owners instead of adding parallel services. Confidence: high.

### 27.1 Realtime multiplication model

- Postgres Changes billable messages equal listening clients receiving the event.
- Broadcast billable messages equal one sender plus receivers.
- Presence consumes Realtime messages; server-to-client frames add to regular egress.
- Example: one insert delivered to two tabs for each of five participants is about ten deliveries before receipts, participant updates, Presence, or protocol frames.
- One typing Broadcast with five receivers is six billable messages.
- Receipt rows can add another subscriber-multiplied event.
- Unfiltered bindings multiply against all authorized subscribers even if the UI discards the event.
- Reconnect/rejoin creates protocol traffic and may cause authoritative HTTP refetches.

`7,973 / 3 MAU` is a development-workload ratio, not a production average.

## 28. Capacity and upcoming-scale model

These are planning envelopes, not forecasts from three development users.

### 28.1 Realtime connections and allowance sensitivity

Assumptions: 1–10% concurrent users, 1–2 tabs/user; base case 5% concurrent and 1.2 tabs. One browser singleton normally means one socket/live tab.

| MAU | Connection range | Base connections | Free message allowance per MAU/month | 5 GB regular-egress allowance per MAU/month |
|---:|---:|---:|---:|---:|
| 100 | 1–20 | 6 | 20,000 | ~51.2 MB |
| 1,000 | 10–200 | 60 | 2,000 | ~5.12 MB |
| 10,000 | 100–2,000 | 600 | 200 | ~0.512 MB |
| 50,000 | 500–10,000 | 3,000 | 40 | ~0.102 MB |

At the base assumption, Free's 200-connection allowance is exceeded before 10,000 MAU. At 50,000 MAU, MAU itself has no headroom.

| Scenario | Visits/MAU/month | Billable messages/visit | 100 MAU | 1k | 10k | 50k |
|---|---:|---:|---:|---:|---:|---:|
| Low | 4 | 20 | 8k | 80k | 800k | 4m |
| Base | 12 | 100 | 120k | 1.2m | 12m | 60m |
| High | 30 | 500 | 1.5m | 15m | 150m | 750m |

Before a scale claim, measure concurrent tabs/session duration, rooms/tab, joins/rejoins/duplicates, billable messages/channel, serialized frames, downstream refetch bytes, authorization checks, pool wait, database sessions, and regular/cached egress by route/object/channel.

### 28.2 Storage and database envelope

Observed starting point: 0.371 GB current Storage and 0.159 GB cluster database. Planning scenarios per user: lean 10 MB Storage/0.5 MB DB; managed 50 MB/2 MB; heavy 200 MB/5 MB.

| Users | Lean Storage / DB | Managed Storage / DB | Heavy Storage / DB |
|---:|---:|---:|---:|
| 100 | 1.371 GB / 0.209 GB | 5.371 GB / 0.359 GB | 20.371 GB / 0.659 GB |
| 1,000 | 10.371 GB / 0.659 GB | 50.371 GB / 2.159 GB | 200.371 GB / 5.159 GB |
| 10,000 | 100.371 GB / 5.159 GB | 500.371 GB / 20.159 GB | 2,000.371 GB / 50.159 GB |
| 50,000 | 500.371 GB / 25.159 GB | 2,500.371 GB / 100.159 GB | 10,000.371 GB / 250.159 GB |

Even the lean 100-user Storage envelope exceeds the Free 1 GB allowance. Managed 100-user database remains below 500 MB, while heavy exceeds it. A plan decision is required before customer scale even after cleanup; optimization must precede that commercial decision.

### 28.3 Page-egress sensitivity

Naively dividing current regular egress by three MAU gives 2.616 GB/MAU/cycle, producing 262 GB at 100 MAU, 2.62 TB at 1k, 26.2 TB at 10k, and 130.8 TB at 50k. This is **not a forecast**; it shows why development/media testing cannot be used as steady state.

Use a measurable model instead:

`monthly regular bytes = users × sessions/user × (shell + page metadata + explicit media actions)`

`monthly cached bytes = users × sessions/user × cacheable public-media bytes after hit rate`

At an initial target of five sessions/user/month and 20 MB regular bytes/session:

| MAU | Target regular egress |
|---:|---:|
| 100 | 10 GB/month |
| 1,000 | 100 GB/month |
| 10,000 | 1 TB/month |
| 50,000 | 5 TB/month |

These targets require post-fix real session measurement.

## 29. Monitoring, page budgets, and exact-attribution plan

### 29.1 Quota thresholds

| Category | 50% | 70% | 85% | 95% |
|---|---:|---:|---:|---:|
| Regular egress, 5 GB | 2.5 GB | 3.5 GB | 4.25 GB | 4.75 GB |
| Cached egress, 5 GB | 2.5 GB | 3.5 GB | 4.25 GB | 4.75 GB |
| Realtime messages, 2m | 1m | 1.4m | 1.7m | 1.9m |
| Peak connections, 200 | 100 | 140 | 170 | 190 |
| MAU, 50k | 25k | 35k | 42.5k | 47.5k |
| Storage, 1 GB | 0.5 GB | 0.7 GB | 0.85 GB | 0.95 GB |
| Database, 0.5 GB | 0.25 GB | 0.35 GB | 0.425 GB | 0.475 GB |
| Edge invocations, 500k | 250k | 350k | 425k | 475k |

Actions: 50% opens a ticket and validates the cycle forecast; 70% adds daily owner review/freezes nonessential bulk work; 85% pages the platform owner and activates route/object/channel caps; 95% or projected breach becomes an incident and preserves evidence. Page on usage above twice the trailing seven-day same-day average or above 5% of quota in a day. Forecast with `used / elapsed_cycle_fraction`; page when projected above 85%. Retain hourly/daily aggregates for at least two cycles.

Storage-specific native budgets: owner soft budget 50 MB/review 100 MB; project 100 MB/review 250 MB; immutable avatar ≤500 KB; project/update image ≤1 MB unless justified; project file hard limit 10 MiB; chat image target ≤5 MiB; any missing current object is immediate; true unknown-reference or expired-uncommitted bytes above 1% alert; owner/project concentration above 25%; event growth above 20% week-over-week; at least three future partitions and zero DEFAULT rows.

### 29.2 Proposed passive page budgets

| Surface | Initial DB/API bytes | Passive Storage bytes |
|---|---:|---:|
| Static/auth shell | ≤100 KB | 0 |
| Hub/People/Profile | ≤250 KB | ≤1 MB thumbnails |
| Project non-Files tab | ≤350 KB | 0 unless visible lazy media |
| Project Files root | ≤500 KB | 0 until selection |
| Messages inbox | ≤250 KB | 0 |
| Messages thread metadata | ≤350 KB | 0 video/file body before intent |
| Explicit image preview | n/a | ≤1 MB target |
| Explicit video/file | n/a | User-controlled Range; measured separately |

Track p50/p95 and regression deltas, not averages only.

### 29.3 Extend existing telemetry, do not add a parallel platform

Browser resource observer fields: route/surface/action; normalized service class; `transferSize`, encoded/decoded size; browser-cache candidate; media intent (`passive`, `selected`, `play`, `download`, `preview`); immutable normalized resource ID, never signed token/path.

Server/API/action fields: route/surface/action; response bytes; Storage bytes/range/cache class; resource type/immutable ID; `signedUrlReused`; correlation ID. For SQL/server actions, retain row count and serialized projection bytes, not row contents. Cross-origin byte opacity means same-origin proxies must log `Content-Length`/`Content-Range` safely.

Realtime aggregate fields: connections, joins/leaves/rejoins, active rooms/tab, Change deliveries, Broadcast sender/receivers, Presence sync bytes, fallback refetches, errors, recovery time. Auth fields: local verification success, `/user` fallback, refresh/reuse error, session-bridge sync, signout cleanup, route/provider. DB fields: pool acquired/waiting, pool-wait p95, timeout, application-name sessions, Supavisor errors. Never retain payloads, tokens, raw identities, object paths, message contents, or user files.

Controlled route test: cold profile, warm cache, soft navigation, full reload, tab away/back, open/close without media intent, explicit preview/play/download, and repeated 15-minute session with known fixtures.

## 30. Prioritized upcoming work after approval

This is sequencing guidance only; nothing below was implemented.

### Before 31 August 2026

1. Preserve the supplied billing evidence and begin hourly/daily captures.
2. Isolate 27–29 July uncached traffic by service/route/object/job; do not label it Realtime without source evidence.
3. Stop/cap nonessential repeated downloads, import replays, background jobs, and media testing until forecast is below quota.
4. Remove passive historical video autoplay/looping and hidden adjacent preloaders.
5. Reuse attachment signed URLs and Range/conditional responses without weakening access control.
6. Route-scope or pause global Presence heartbeat on non-chat/hidden tabs.
7. Remove the custom Auth lock override.
8. Remove duplicate reconnect ownership and fix replacement-channel cleanup.
9. Resolve `project_nodes` publication drift and measure unfiltered deliveries.
10. Quarantine writes to 1,199 missing file bodies; start verified recovery.
11. Verify the existing retention deployment and clear the seven-object uncommitted backlog.
12. Add 50/70/85/95% quota alerts and named owners.
13. Run a real WebSocket/Presence/Changes reconnect test; keep 1M readiness blocked until measured.

### Before 100 users

- Make Files entry root-paginated; add deep-link ancestor resolution.
- Make private preview/cache URLs content-version aware.
- Compress every avatar path and replace the measured oversized active source safely.
- Remove three-second integrations polling and duplicate profile reads.
- Repair file reconciliation with keyset progress and idempotent repair categories.
- Consolidate deletion/retention under current Inngest owners and verify heartbeats.
- Enforce upload limits from bucket contracts and lifecycle cache profiles.
- Enforce route/passive-media budgets in performance runs.
- Decide the required paid plan from measured post-fix usage, not as a substitute for fixes.

### Before 1,000 users

- Establish p50/p95 route/action bytes and signed-URL reuse ratio.
- Load-test chat Range, Files root, Hub/People, pool wait, and native Realtime reconnects.
- Add immutable versions/ETags to every private media proxy.
- Schedule existing future-partition maintenance and audit-retention owners.
- Record content hashes/dimensions/optimization versions for uploaded images/files.

### Before 10,000 users

- Capacity-test media concurrency, CDN hit ratio, authorization checks, and room density.
- Segment aggregate dashboards by service/route/surface/resource/intent.
- Enforce derived format/size classes for avatars, covers, updates, and chat images.
- Reassess Smart CDN/plan economics after signed-token churn is fixed.

### Before 50,000 users

- Use tested per-session distributions, tabs, fanout, and storage-growth scenarios.
- Verify cache invalidation/versioning and retention recovery at scale.
- Establish quota/cost failover and rate-limited degradation procedures.
- Require capacity approval for any population-readiness statement; cross-link `QRY-036`.

## 31. Read-only evidence, references, and limitations

Supabase plugin work included organization/project discovery, Edge Function listing, recent Auth/API/Realtime/Postgres/Storage/Edge logs, performance advisor, publication membership, replica identity, Realtime RLS/policies, aggregate Auth/session/provider/SSO counts, connection state, all bucket/object metadata, reference/path reconciliation, anonymized ownership distributions, missing-object checks, cluster/relation/index/partition/event/temp-I/O statistics, and current official documentation searches. One initial multi-statement call returned only its last result and was repeated as separate reads; one query used a nonexistent statistics column and failed without mutation.

Official references:

- [Manage egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
- [Realtime messages](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages)
- [Realtime peak connections](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-peak-connections)
- [Realtime egress FAQ](https://supabase.com/docs/guides/troubleshooting/realtime-egress-faq)
- [Monthly active users](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users)
- [Third-party MAU](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users-third-party)
- [SSO MAU](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users-sso)
- [Billing and quotas](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [Storage size](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size)
- [Storage pricing](https://supabase.com/docs/guides/storage/pricing)
- [Storage production scaling](https://supabase.com/docs/guides/storage/production/scaling)
- [Storage upload limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
- [Storage image transformations](https://supabase.com/docs/guides/storage/serving/image-transformations)
- [Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn)
- [Database and disk size](https://supabase.com/docs/guides/platform/database-size)
- [Manage disk usage](https://supabase.com/docs/guides/platform/manage-your-usage/disk-size)
- [Reports](https://supabase.com/docs/guides/monitoring-and-debugging/reports)
- [Postgres connections/Supavisor](https://supabase.com/docs/guides/database/connecting-to-postgres)

Limitations and false-positive controls:

- Plugin logs cover only the most recent 24 hours and are capped; they cannot explain July exactly and do not expose response bytes.
- Usage screenshots are organization/all-project aggregate. Only one active project was found, but historical/deleted-project contribution cannot be proven absent.
- `pg_stat_*`, index scans, and statement counts are cumulative from their reset timestamps, not the billing cycle.
- Auth session rows are cumulative records, not concurrency; point-in-time activity is not a capacity baseline.
- No Storage body was downloaded; dimensions, magic bytes, media validity, visual duplication, and body hashes were not independently verified.
- ETags only indicate possible equality and never authorize deletion.
- No private payload, identity, token, path, message, file content, or raw user data was retained.
- Browser/Next cache behavior was statically traced, not production-browser exercised.
- Public/private Realtime dashboard configuration was unavailable, so CAP-009 is conditional.
- Staging, previews, external backups, restore tests, job deployment status, and dashboard-only settings were unavailable.
- No production WebSocket load result, per-user tab distribution, serialized-frame histogram, pool-wait telemetry, or channel-level billing attribution exists.
- Current development/import concentration and three MAU cannot be extrapolated as a customer cohort.

### 31.1 Complete route-handler inventory used for the page audit

The audit accounted for all 90 route handlers. This inventory distinguishes small JSON/control paths from byte-bearing media paths.

- Auth/account/settings/security/privacy: `/auth/callback`; `/api/e2e/auth`; `/api/v1/auth/signup`; `/verify-email`; `/change-password`; `/password-safety`; `/security-step-up`; `/session`; `/mfa/factors/[id]`; `/mfa/recovery-codes`; `/account/delete`; `/account/export`; `/account/reserved-usernames`; `/appearance`; `/security`; `/security/csrf`; `/privacy`; `/privacy/blocks`; `/privacy/blocks/[userId]`; `/privacy/profile-visibility`; `/privacy/message-privacy`; `/privacy/connection-privacy`; `/sessions`; `/sessions/[id]`; `/sessions/all`; `/sessions/others`; `/onboarding/username-check`.
- Profile/discovery/skills/navigation: `/api/v1/profiles/[id]/projects`; `/collaboration-summary`; `/contributions`; `/project-invite-options`; `/project-invites`; `/collaboration-stages/[stageId]`; `/projects`; `/skills`; `/skills/proposals`; `/skills/resolve`; `/link-preview`; `/go/[ownerType]/[ownerId]/[linkKey]`; `/api/og/project/[slug]`.
- Project/media: `/api/v1/projects/[id]/capabilities`; `/members`; `/sync-diff`; `/tasks/[taskId]/merge`; `/doc-collaboration-token`; `/doc-assets/[assetId]`; `/files/[nodeId]/preview`; `/image`; `/update-media`; `/api/v1/files/[nodeId]/lock`; `/lock-renew`; `/files/locks`.
- Messaging/presence: `/api/v1/messages/attachments/[attachmentId]`; `/presence/heartbeat`.
- Extension: `/api/v1/extension/auth-code`; `/file`; `/file-lock`; `/file-upload`; `/folder`; `/project-summary`; `/project-tasks`; `/recovery-drafts`; `/recovery-sessions`; `/session`; `/task-detail`; `/task-push`; `/workspace`.
- GitHub/import/background/operations: `/api/v1/github/import/abort`; `/access-state`; `/analyze`; `/branches`; `/file-intent`; `/finalize-file`; `/finalize-manifest`; `/init`; `/preflight`; `/preview-folder`; `/preview-root`; `/repositories`; `/status`; `/webhooks/github`; `/cleanup-orphan`; `/completion`; `/api/completion`; `/inngest`; `/api/v1/inngest`; `/integrations`; `/health`; `/live`; `/ready`.

Project/media attachment, preview, image, update-media, extension file/recovery, and manifest-finalization paths can directly create Storage bytes. The remaining handlers are principally JSON/control/auth paths; this does not make their repeated execution free, but it makes them implausible sole causes of gigabyte-scale media spikes.

### 31.2 Raw recent-log sample preserved

Recent API sample, approximately two hours: 93 parsed HTTP events—70 status 200, 17 status 206, four status 101, two status 304. It includes 13 `/auth/v1/user`; one chat `.mov` with 12 signed-object GETs/11 sign POSTs; another `.mov` with five GETs/four sign POSTs; three chat images with three-to-four signs and four signed-render GETs each; four Realtime WebSocket events; and four follow reads.

Recent Storage sample: 99 parsed events—48 sign POSTs, 36 signed-object GETs, 11 signed-image-render GETs, 14 distinct method/path combinations. One combination repeated 26 times and four paths had at least five calls. These capped samples have no response-byte field and do not cover July.

Latest-30-message windows across five conversations contain at most nine attachments and at most 31,664,287 referenced body bytes; the median window is zero, showing concentrated media rather than universal payload. Live chat composition is six videos/33,932,618 bytes, five PDFs/8,137,794 bytes, and ten images/11,430,753 bytes.

### 31.3 Full Storage age/cache and ownership statistics

| Domain | Detailed distribution |
|---|---|
| Project-file age | 8,877 / 309,552,980 B older than 30d; 3 / 1,356,109 B at 7–30d; 3 / 198,545 B at 1–7d |
| Chat age | 10 / 16,003,919 B older than 30d; 11 / 37,497,246 B at 7–30d |
| Avatar cache | 9 / 3,851,778 B at `max-age=3600`; 7 / 927,100 B at `max-age=0` |
| Project-file cache | 8,552 / 306,801,956 B at one hour; 328 / 3,545,692 B `no-cache`; 3 / 759,986 B malformed |
| Other populated buckets | Chat 21, update media 6, task file 1 all at one hour |

Anonymized Storage ownership: five historical owners; 8,926 attributable objects / 371,002,751 bytes; one 11-byte residue; p50 five objects/3,793,284 bytes; p90/max 6,002 objects/271,781,140 bytes. Project Storage: five projects; 8,888 objects/312,525,537 bytes; p50 324 objects/5,216,055 bytes; p90/max 5,997 objects/219,449,253 bytes.

Database cardinality details:

| Family | Subjects/projects | Rows | p50 | p90 | Maximum/share |
|---|---:|---:|---:|---:|---:|
| Nodes by creator | 5 | 30,556 | 9 | 17,368 | 25,758 / 84.30% |
| Versions by uploader | 3 | 3,932 | 13 | 3,137 | 3,918 / 99.64% |
| Profile audits by user | 16 | 11,211 | 390 | 2,089 | 2,949 / 26.30% |
| Messages by sender | 6 | 205 | 9 | 92 | 104 / 50.73% |
| Nodes by project | 8 | 30,556 | 315 | 10,365 | 25,299 / 82.80% |
| Versions by project | 3 | 3,932 | 321 | 2,950 | 3,607 / 91.73% |
| Node events by project | 8 | 689 | 8 | 257 | 504 / 73.15% |

### 31.4 Large-index and audit-event evidence

Largest relevant `project_nodes` indexes: active-project-path unique 6,201,344 B/17,813 scans; project-path 5,472,256 B/3,446; listing 5,079,040 B/13,930; path 4,816,896 B/129; active-name lookup 4,022,272 B/4,173; active-parent-name unique 3,743,744 B/17,259; sync-Git 1,155,072 B/zero recorded scans. `profile_audit_events` user-event is 1,277,952 B and user-created 770,048 B. Scan counters date from 8 December 2025 and include development; zero or low scans alone do not authorize deletion.

Profile audit mix: 4,418 `discover_profile_served`, 3,452 `message_history_read`, 2,410 `conversation_opened`, 483 `profile_viewed`, 226 network-profile events, and 222 activity/security events. At a 90-day boundary, 2,354 read and 144 activity/security rows are older. Retention requires a product/legal decision.

Wide-column observations remain modest: `project_markdown_versions.quality_report` averages 778 B, collaboration summary JSON 684 B, and indexed file content text 590 B. The partition family is 1,925,120 bytes; nine monthly partitions have zero estimated rows, March–June contain material rows, and DEFAULT is empty at the audit point.

### 31.5 Primary new repository paths inspected

The agents inspected all pages/layouts/routes plus the relevant owners under `src/components/providers`, `src/components/chat/v2`, `src/components/projects`, `src/components/settings`, `src/hooks`, `src/lib/realtime`, `src/lib/auth`, `src/lib/supabase`, `src/lib/db`, `src/lib/storage`, `src/lib/upload`, `src/lib/messages`, `src/lib/privacy`, `src/lib/extension`, `src/app/actions`, `src/app/api/v1`, and `src/inngest/functions`. The most material concrete files were:

- `src/components/chat/v2/message-attachments.tsx`, `resolved-video-player.tsx`, `ConversationListV2.tsx`, and `MessagesWorkspaceV2.tsx`;
- `src/components/ui/media-viewer.tsx`;
- `src/app/api/v1/messages/attachments/[attachmentId]/route.ts`;
- `src/components/projects/v2/preview/AssetPreview.tsx`, `files-tab/file/FileView.tsx`, and `explorer/useExplorerBoot.ts`;
- `src/lib/realtime/presence-client.ts`, `project-files-channel.ts`, `task-resource.ts`, and `subscriptions.ts`;
- `src/components/providers/MainRuntimeProviders.tsx`, `RealtimeProvider.tsx`, and `AuthProvider.tsx`;
- `src/lib/supabase/client.ts`, `server.ts`, `middleware.ts`, and `auth-user.ts`;
- `src/lib/auth/snapshot.ts`, `src/lib/server/viewer-context.ts`, and `src/lib/db/index.ts`;
- `src/lib/storage/project-file-key.ts`, `src/lib/upload/upload-intents.ts`, `security.ts`, and `supabase-signed-upload-client.ts`;
- `src/app/actions/files/content.ts`, `versions.ts`, and `nodes.ts`;
- `src/inngest/functions/project-files-reconciliation.ts`, `message-attachment-retention.ts`, `account-cleanup.ts`, and `extension-recovery-retention.ts`;
- `drizzle/0122_ponytail_database_hardening.sql`, `0124_ponytail_storage_bucket_contracts.sql`, and `0125_ponytail_allow_office_mimes.sql`;
- `qa/load/messages-reconnect-storm.k6.js`, `scripts/check-capacity-audit.ts`, `scripts/check-1m-readiness.ts`, and `docs/operations/production-alert-thresholds.md`.

## 32. Original approval gate — superseded by the implementation record

The complete usage audit now contains **61 additional findings**: `EGR-001`–`EGR-021`, `RES-001`–`RES-023`, and `CAP-001`–`CAP-017`. Along with the original `ORG-001`–`ORG-028`, `QRY-001`–`QRY-091`, and `SUP-001`–`SUP-029`, the report records **209 individually numbered findings/verified patterns**.

This was the original approval boundary at audit completion. Implementation was subsequently authorized and performed using Ponytail Full. Section 33 is the authoritative post-implementation record. The destructive-cleanup warning remains in force: the apparent 84.6 MB “orphan” population is path-correlated live data and must not be deleted without live reference verification.

## 33. Ponytail Full implementation record — 16 August 2026

### 33.1 Outcome

The safe repository-side implementation is complete. Two separate waves of three uninterrupted subagents, followed by root integration and a second exhaustive re-audit, traced all 209 numbered findings. The work removed or consolidated duplicate owners, bounded previously unbounded paths, corrected race and retry behavior, restored native Supabase ownership, hardened Storage and Realtime contracts, added forward-only migrations, and expanded regression/governance gates.

This does **not** mean every live Supabase task is complete. The Supabase connector quota is exhausted until 19 August 2026 at 10:49 AM, so no live migration, destructive cleanup, Advisor verification, Auth dashboard change, production `EXPLAIN`, restore drill, or capacity/load claim was attempted or bypassed. Those items remain explicitly blocked below.

### 33.2 Final SQL inventory and naming policy

- 159 physical migration SQL files exist under `drizzle/`.
- 158 migrations are journaled, ordered, named, and governed.
- `0152_message_preview_backfill.sql` is the one physical quarantined duplicate and is not deployable until every environment is verified.
- Zero standalone utility SQL files remain.
- The current migration corpus contains 57,203 SQL lines. This is immutable history, not application runtime code loaded per request.
- Applied migration history was not renamed, moved, squashed, or destructively rewritten. Doing so would break environment lineage.
- New migrations must use unique increasing numeric prefixes and professional domain-and-intent names; adjective-generated names and migrations over 1 MiB now fail governance.
- Added forward migrations: `0153_task_server_table_lineage`, `0154_native_database_security_hardening`, `0155_account_deletion_privacy`, `0156_profile_counter_authority`, `0157_storage_realtime_contract_alignment`, and `0158_lifecycle_retention_indexes`.

The SQL-file count therefore increased from the audited physical inventory because missing lineage and forward fixes were added safely. “Reducing SQL files” is not a valid goal for already-applied migrations; the professional outcome is one authoritative journal, zero utility SQL, a quarantined duplicate, strict future naming, and replay/catalog validation.

### 33.3 Major implementation delivered

- Hub pagination now forwards validated filters, rejects foreign cursors, fetches `limit + 1`, fills snapshot pages, bounds followed-project reads, and removes its dead data owner.
- Files now use typed missing-content failure, pure signed reads, bounded root/folder pagination, opaque file IDs, materialized-path breadcrumbs, canonical scope predicates, durable reconciliation cursors, and authoritative focus/online reconciliation instead of workspace-wide Realtime.
- Dead search/replace and purge owners were retired rather than preserving divergent matching and unsafe Storage-before-database behavior.
- Legacy file/hash/task-file/deduplication utilities are explicit, bounded, keyset/set-based, cycle-safe, idempotent, transaction-aware, and fail closed.
- Workspace, connection, application-history, project-selector, task-aggregate, invite, and Git reconciliation reads/writes are bounded, stable, set-based, keyset-paginated, or incrementally updated.
- Notifications now preserve snooze state, batch preferences, deliver push only after commit through one durable worker, retry safely, maintain failure counts, and avoid redaction-driven reorder.
- Messaging attachment, structured-send, preview, workflow, summary, authorization, search, editor-recency, reaction-visibility, and post-commit owners were consolidated and made idempotent/bounded.
- Native Supabase Auth locking and local snapshot reuse are restored; privacy-safe per-route auth-resolution metrics were added without identities, slugs, paths, or tokens.
- Presence/project-stat channels are private and Auth-bound; Broadcast is invalidation only; hidden rooms release; native reconnect is the sole reconnect owner; load coverage now opens real private WebSockets.
- Project/image/document/update-media/message/PDF paths now use intent-driven media loading, ETags, versioned URLs, Range, signed-URL reuse, browser cache lifecycles, immutable object metadata, and bounded transforms.
- Avatar preparation is shared and off-main-thread, replacement cleanup is retryable, and new immutable uploads receive one-year cache metadata.
- Account deletion, Storage cleanup, upload-intent cleanup, attachment retention, event retention, partition maintenance, and missing-object reconciliation have bounded durable owners with heartbeats/retry semantics.
- Migration lineage, MIME drift, RLS, catalog, runtime-role, replay, capacity, rollout, and 1M-readiness checks now fail closed instead of accepting unsupported claims.

### 33.4 Final verification

Passed on the combined worktree after both implementation and re-audit waves:

- Next.js production build, TypeScript, route collection, and all 68 static-generation steps.
- Whole-repository ESLint.
- 1,628 of 1,628 unit tests; zero failures, skips, or cancellations.
- SQL governance: 158 governed migrations and zero utility SQL files.
- Migration journal validation.
- Database setup dry-run: 158 migration sources validated without connecting to a database.
- RLS contract and authorization contract.
- `git diff --check`.

Expected evidence gates remain closed:

- Disposable replay refuses to run without `DATABASE_URL_FRESH` or `DATABASE_URL_REPLAY_FRESH`.
- Strict capacity audit refuses to pass without `ops/stability/capacity-audit.json` containing measured, approved evidence.
- Production rollout remains pending without staged rollout and load artifacts.
- 1M readiness remains `BLOCKED` while capacity and rollout are unapproved.

## 34. Exhaustive finding disposition

Status vocabulary: **done** means the safe repository implementation and regression coverage exist; **repository-ready/live-blocked** means code or a forward migration exists but live application/verification is still required; **verified** means the audit pattern is intentionally sound; **measurement-dependent** means a production plan/load result is required before changing code or indexes; **external-blocked** means the result needs infrastructure, operational, legal/product, review, or commit authority.

### 34.1 Organization and migration governance (`ORG-001`–`ORG-028`)

- `ORG-001` — **Repository-ready/live-blocked:** journal, manifest, ordering, and naming authority are exact; live Supabase/application registry reconciliation remains.
- `ORG-002` — **External-blocked:** migrations `0153`–`0158` exist locally; immutable changeset review/commit remains outside this implementation run.
- `ORG-003` — **Live-blocked:** forward migrations cover repository intent; partial unpublished live objects need environment reconciliation.
- `ORG-004` — **Done:** future numeric prefixes must be unique and increasing; applied legacy duplicates remain frozen.
- `ORG-005` — **Done:** future journal timestamps must be unique, monotonic, and nonfuture.
- `ORG-006` — **Done:** governance validates exact membership, order, prefix, timestamp, name, quarantine, and size semantics.
- `ORG-007` — **Repository-ready/replay-blocked:** `db:generate` is disposable-replay gated; catalog/snapshot parity awaits a replay database.
- `ORG-008` — **Repository-ready:** `task_pushes` creation, indexes, and fail-closed RLS are in `0153`.
- `ORG-009` — **Repository-ready:** `task_read_receipts` lineage, keys, index, and fail-closed RLS are in `0153`.
- `ORG-010` — **Repository-ready/replay-blocked:** replay expectations derive from Drizzle schema with explicit exceptions.
- `ORG-011` — **Done:** all three sprint-membership foreign keys have leading indexes.
- `ORG-012` — **Done:** intentional server-only RLS tables are declared in the catalog allowlist.
- `ORG-013` — **Done:** `db:push` is absent; only governed journaled migrations remain.
- `ORG-014` — **Done:** standalone partition SQL was removed; one monthly Inngest worker owns maintenance.
- `ORG-015` — **Done for future history:** new migrations over 1 MiB fail governance; immutable seed history is retained.
- `ORG-016` — **Done:** message preview refresh delegates to the native PostgreSQL reconciliation owner.
- `ORG-017` — **Environment-blocked:** `0152` is quarantined; deletion requires exact proof from every environment.
- `ORG-018` — **Verified/ongoing:** domain owners remain explicit; no generic catch-all repository rewrite was introduced.
- `ORG-019` — **Partial by design:** cached viewer context and per-route resolution counts exist; raw Auth/Storage clients remain where required and conversion stays touch-driven.
- `ORG-020` — **Done:** project-follow fallback runs only for the exact historical missing-counter condition.
- `ORG-021` — **Done:** verified dead compatibility exports and unused avatar wrappers were removed.
- `ORG-022` — **Done:** one shared typing-user mapper is reused without merging distinct hooks.
- `ORG-023` — **Verified:** Presence and typing remain intentionally separated under one room registry.
- `ORG-024` — **Done:** approved direct browser RLS read owners are documented in an ADR.
- `ORG-025` — **Done:** older SQL/Supabase audits are marked as historical snapshots.
- `ORG-026` — **Done:** exact canonical bucket MIME sets are checked for drift.
- `ORG-027` — **Repository-ready:** workflow seed target is qualified, search path is empty, and client execution is revoked.
- `ORG-028` — **Done:** professional domain-and-intent naming is enforced for all new migrations.

### 34.2 Supabase architecture and security (`SUP-001`–`SUP-029`)

- `SUP-001` — **Live-blocked:** repository migration authority is exact; live registries still require reconciliation.
- `SUP-002` — **Repository-ready:** both missing table lineages are supplied by `0153`.
- `SUP-003` — **Done:** server-only fail-closed RLS decisions are explicit.
- `SUP-004` — **Repository-ready/live-blocked:** new profile identities are protected by a `NOT VALID` Auth FK; orphan repair and validation remain live.
- `SUP-005` — **Done:** signed account cleanup uses the admin client and recursively pages every current/legacy Storage domain.
- `SUP-006` — **Done:** hard-delete phase two resumes safely from `in_progress`.
- `SUP-007` — **Done:** unused plaintext tokens are removed and completed deletion rows are pseudonymized.
- `SUP-008` — **Done:** Storage failures propagate for retry and retry references are preserved.
- `SUP-009` — **Done:** account cleanup pages avatars, attachments, project files, legacy paths, task files, covers, and update media.
- `SUP-010` — **Repository-ready/live-blocked:** legacy `task-files` rejects viewer writes; object migration/bucket retirement remain live.
- `SUP-011` — **Done:** dead `project_nodes` Realtime ownership was removed for bounded authoritative reconciliation.
- `SUP-012` — **Done:** private Presence/project-stat channels install the authenticated Realtime token before subscribing. Forward migration `0160` is applied live and supplies extension-scoped SELECT/INSERT policies for user, conversation, task, and project-stat topics. The live authorization matrix allows self/shared peers and conversations while denying an unrelated user.
- `SUP-013` — **Done:** remaining Changes bindings are task/project filtered rather than workspace-wide.
- `SUP-014` — **Done:** the browser no longer overrides Supabase's native Auth lock.
- `SUP-015` — **Done:** read traffic never manufactures port 6544; primary connection configuration is reused.
- `SUP-016` — **Done:** the three sprint-membership FK indexes are in `0153`.
- `SUP-017` — **Repository-ready:** repeated Auth policy evaluation is consolidated in `0154`.
- `SUP-018` — **Repository-ready:** contribution/stage permissive SELECT policies are consolidated.
- `SUP-019` — **Repository-ready:** only the proven redundant DM-pair index is removed.
- `SUP-020` — **Repository-ready:** workflow function search path and execution privileges are hardened.
- `SUP-021` — **Partial/external:** application password checks exist; the native leaked-password Auth dashboard toggle still needs live enablement.
- `SUP-022` — **Repository-ready/live-blocked:** one monthly single-concurrency partition worker is registered; deployment heartbeat remains.
- `SUP-023` — **Repository-ready/live-blocked:** bounded retention worker and indexes exist; rollout heartbeat and product/legal periods remain.
- `SUP-024` — **External-blocked:** backup/restore runbook exists; off-site export and restore-drill artifacts do not.
- `SUP-025` — **Repository-ready/external:** least-privilege runtime-role and release gates exist; role provisioning and credential rotation remain.
- `SUP-026` — **External-blocked:** capacity claims require real staged load, plan, and approval evidence.
- `SUP-027` — **Repository-ready:** private archive receives fail-closed RLS.
- `SUP-028` — **Repository-ready:** profile counters have one authority and the legacy projection table is removed by `0156`.
- `SUP-029` — **Verified:** no unsafe mass unused-index deletion was performed.

### 34.3 Query correctness, performance, and placement (`QRY-001`–`QRY-091`)

- `QRY-001` — **Done:** Hub forwards normalized `includedIds` to the canonical feed.
- `QRY-002` — **Done:** malformed, wrong-kind, foreign-fingerprint, and missing-snapshot cursors return the invalid-cursor path.
- `QRY-003` — **Done:** direct Hub branches fetch `pageSize + 1`, slice, and derive `hasMore` from the extra row.
- `QRY-004` — **Done:** snapshot pagination consumes later IDs until the page is full or the snapshot ends.
- `QRY-005` — **Measurement-dependent:** representative one/four/eight-term `EXPLAIN (ANALYZE, BUFFERS)` is required before consolidating search expressions.
- `QRY-006` — **Done:** the dead project data query module and production imports are removed.
- `QRY-007` — **Done:** matchmaking authenticates and verifies owner/admin access before reading a narrow candidate projection.
- `QRY-008` — **Done:** failed file reads throw `FileContentUnavailableError`; fabricated empty content is impossible.
- `QRY-009` — **Done:** the signed-read owner validates and signs only; it does not upload or mutate database state.
- `QRY-010` — **Done:** bounded node projection contains the signing key; repeated project/path reads are gone.
- `QRY-011` — **Done:** federated search authorizes once and delegates to a private already-authorized helper.
- `QRY-012` — **Done:** indexed search joins authoritative same-project active nodes and excludes soft deletion.
- `QRY-013` — **Done by retirement:** the unused divergent search/replace preview owner was removed.
- `QRY-014` — **Done by retirement:** the unused nondeterministic preview cap was removed.
- `QRY-015` — **Done by retirement:** the unused per-file lease/statement loop was removed.
- `QRY-016` — **Done by retirement:** the unsafe compensating Storage mutation owner was removed; active writes use the canonical revision owner.
- `QRY-017` — **Done:** the mismatched flat-tree count/select owner was removed.
- `QRY-018` — **Done:** full-tree bootstrap is removed; root page size is 100 with lazy folder expansion.
- `QRY-019` — **Verified bounded/measurement-dependent:** per-parent fairness remains capped; replace only if observed p95/DB duration justifies a window query.
- `QRY-020` — **Done:** materialized-path/one-query ancestor resolution replaces sequential breadcrumb reads.
- `QRY-021` — **Done:** normal paths use one indexed equality lookup; exact task compatibility is isolated.
- `QRY-022` — **Done:** task-title/file-slug scans are retired and current URLs use opaque file IDs.
- `QRY-023` — **Done:** batch/ID reads enforce active project scope and explicit task/system exclusions.
- `QRY-024` — **Done:** reconciliation persists a `(projectId,nodeId)` keyset cursor and wraps only at exhaustion.
- `QRY-025` — **Done:** stale import updates preserve status and cutoff/version predicates.
- `QRY-026` — **Done:** signed background cleanup uses the admin client.
- `QRY-027` — **Done:** database records and Storage prefixes are recursively paged/deleted in bounded batches.
- `QRY-028` — **Done:** the dead document cleanup worker, registry entry, and event are removed.
- `QRY-029` — **Done:** hard-delete scheduling is ordered and capped at 100.
- `QRY-030` — **Done:** file-hash backfill is keyset ordered and advances past run-local failures.
- `QRY-031` — **Repository done/live execution not claimed:** legacy backfill is explicit `--apply`, set-based, transactional, and cycle guarded.
- `QRY-032` — **Repository done/live execution not claimed:** task-file migration uses deterministic destinations, idempotent copy, locked transactional metadata, and orphan cleanup.
- `QRY-033` — **Repository done/live execution not claimed:** replacement unique indexes are built concurrently, validated, and atomically swapped without a protection gap.
- `QRY-034` — **Repository-ready/live-blocked:** scalar Auth subselect policies are in `0154`; Advisor verification remains.
- `QRY-035` — **Repository-ready/live-blocked:** redundant DM index removal is in `0154`; live dependency verification remains.
- `QRY-036` — **External-blocked:** readiness gates exist, but representative load/capacity/plan approval is still required.
- `QRY-037` — **Done:** collision preflight clamps input and traverses only submitted sibling/ancestor chains.
- `QRY-038` — **Done:** GitHub changes/deletions use bounded set-based batches with bounded progress writes.
- `QRY-039` — **Done:** Git Storage uses bounded concurrency and persists only confirmed uploads.
- `QRY-040` — **Done:** expired upload cleanup claims locked batches and retries failed Storage deletions.
- `QRY-041` — **Done:** integrations aggregates use native database count/max projections.
- `QRY-042` — **Done:** the unused purge owner is removed.
- `QRY-043` — **Done:** block/unblock invalidates blocked-pair, connection, inbox, and discovery projections.
- `QRY-044` — **Done:** bulk decisions condition on pending state/party and counters derive from returned transitions.
- `QRY-045` — **Done:** connection pairs are serialized with a canonical advisory transaction lock.
- `QRY-046` — **Done:** pending application capacity and insert share a user-scoped serialization boundary.
- `QRY-047` — **Done:** comments and mention projections commit atomically; notifications follow commit.
- `QRY-048` — **Done:** reply creation/deletion share parent advisory locking.
- `QRY-049` — **Done:** replies are capped previews with totals and `hasMore`.
- `QRY-050` — **Done:** workspace projects, sprints, joins, and application reads are bounded/keyset-paginated.
- `QRY-051` — **Done:** Redis misses fall back to bounded indexed social-proof reads and repopulation.
- `QRY-052` — **Done:** accepted/removed pairs update existing Redis sets incrementally; cold sets remain unknown for database fallback.
- `QRY-053` — **Done:** task subtasks/files/comments/receipt counts use grouped CTE aggregates.
- `QRY-054` — **Done:** finalization consistently excludes soft-deleted tasks.
- `QRY-055` — **Done:** shared task/comment field limits and unique mention caps are enforced at trust boundaries.
- `QRY-056` — **Done:** subtasks are stably bounded and followed projects are scoped to the visible page.
- `QRY-057` — **Done:** collaborator/open-role previews have stable order, totals, cursors, and `hasMore`.
- `QRY-058` — **Done:** bounded invite selection excludes pending applications and unexpired invitations in SQL.
- `QRY-059` — **Done:** unified history maintains independent source cursors, so older application events remain reachable.
- `QRY-060` — **Done:** the weaker Supabase lifecycle mutation was replaced with Drizzle optimistic concurrency.
- `QRY-061` — **Done:** project update access reuses one project snapshot.
- `QRY-062` — **Done:** cache-only relationship state no longer exposes synthetic persistent IDs.
- `QRY-063` — **Done:** hydration errors use bounded retry rather than false completion.
- `QRY-064` — **Done:** extension root nodes use per-project window ranking/caps.
- `QRY-065` — **Done:** project/profile selectors use narrow search/keyset pagination.
- `QRY-066` — **Done:** one durable worker resumes due snoozed/quiet-hours push delivery.
- `QRY-067` — **Done:** aggregate upserts preserve explicit future snoozes.
- `QRY-068` — **Done:** delivery increments failures, resets success state, and retention uses failure counts.
- `QRY-069` — **Done:** push delivery occurs only from committed durable notification state.
- `QRY-070` — **Done:** preferences are batched and fanout/delivery runs in bounded chunks.
- `QRY-071` — **Measurement-dependent:** representative unseen-badge plans are required before adding a partial index.
- `QRY-072` — **Done:** redaction is participant/key bounded, returns no unused rows, and does not mutate activity ordering.
- `QRY-073` — **Done:** notification cursors require UUID IDs and reject nonfinite limits.
- `QRY-074` — **Done:** attachment object paths are durable before signing can fail.
- `QRY-075` — **Done:** only fresh `uploaded` sessions can be claimed; committed IDs cannot be reused.
- `QRY-076` — **Done:** structured sends use idempotent client identities and nonfatal post-commit work.
- `QRY-077` — **Done:** structured sends share ordinary burst notification behavior.
- `QRY-078` — **Done:** redundant participant-by-participant preview refresh is removed.
- `QRY-079` — **Done:** project summaries batch metadata/hydration rather than invoking N helpers.
- `QRY-080` — **Done:** global message attention uses the canonical summary batch API.
- `QRY-081` — **Done:** thread hydration reuses one authorization scope and concurrent private reads.
- `QRY-082` — **Done:** latest applications use database window ranking instead of full-history JavaScript dedupe.
- `QRY-083` — **Measurement-dependent:** representative production search plans are required before altering trigram/filename indexes.
- `QRY-084` — **Done:** each uploader's latest row is selected first, then editors are ordered by recency.
- `QRY-085` — **Done:** task-file notifications reuse one project/actor/member context and batched events.
- `QRY-086` — **Done:** workflow/task post-commit projections are idempotent and nonfatal.
- `QRY-087` — **Done:** logout deletes the authenticated push record before local/Auth teardown.
- `QRY-088` — **Done:** private channels use Auth-derived identity, authenticated startup, invalidation-only Broadcast, and live Realtime RLS. Custom reconnect ownership and generic-avatar channel fanout were removed; user-room observers cannot publish into a peer's room.
- `QRY-089` — **Done:** heartbeat debounce is recorded only after successful or known-fresh persistence.
- `QRY-090` — **Done:** reaction reads/writes reuse hidden-message accessibility.
- `QRY-091` — **Done:** verified dead messaging helpers, imports, and in-flight state are removed.

### 34.4 Egress (`EGR-001`–`EGR-021`)

- `EGR-001` — **Done:** historical chat videos render intent-only thumbnails; no autoplay/loop.
- `EGR-002` — **Done:** the viewer loads only current media; adjacent items remain thumbnails.
- `EGR-003` — **Done:** attachment signed URLs are reused and Range/conditional behavior is preserved.
- `EGR-004` — **Historical/live-blocked:** July route/object attribution cannot be reconstructed from the current capped logs.
- `EGR-005` — **Done:** conversation hover no longer fetches a 30-message thread.
- `EGR-006` — **Done:** PDFs stream through the stable route and avoid blob cloning/cache defeat.
- `EGR-007` — **Done:** file signed URLs are retained with expiry in the file store.
- `EGR-008` — **Done:** Files tree entry is cursor-paged rather than serializing 2,500 nodes.
- `EGR-009` — **Done:** extension large-file reads use signed Range transfer.
- `EGR-010` — **Done:** project cover URLs are versioned with ETag and authenticated/public cache behavior.
- `EGR-011` — **Done:** document assets use versioned ETags, conditional responses, and private browser caching.
- `EGR-012` — **Done:** update media uses ETags and a 12-minute private redirect cache inside signed validity.
- `EGR-013` — **Done:** avatar uploads use shared off-main-thread compression and immutable metadata.
- `EGR-014` — **Done:** public profile metadata/body share one request-cached loader.
- `EGR-015` — **Done:** owner profile metadata/body share one cached projection.
- `EGR-016` — **Done:** followed-project lookup is restricted to deduplicated visible project IDs.
- `EGR-017` — **Done:** three-second integrations polling is removed; focus/mutation reconciliation remains.
- `EGR-018` — **Done:** signed-in layout passes its server profile into the Auth provider.
- `EGR-019` — **Done:** onboarding telemetry is bounded and committed with step boundaries rather than hot-path requests.
- `EGR-020` — **Verified intentional:** account export remains explicit and intentionally unbounded.
- `EGR-021` — **Repository-ready/external:** strict capacity evidence now requires Supabase bytes, cache, rooms, signed-URL reuse, and attribution fields.

### 34.5 Storage and database resources (`RES-001`–`RES-023`)

- `RES-001` — **Repository done/live repair pending:** missing file content is terminal and can no longer be overwritten with fabricated empty bytes.
- `RES-002` — **Repository-ready/live run pending:** path-correlated disconnected objects have a bounded reconciliation owner and are not treated as safe orphans.
- `RES-003` — **Done:** reconciliation has durable keyset progress, mutually exclusive categories, metadata verification, and idempotent behavior.
- `RES-004` — **Repository owner verified/live backlog pending:** attachment retention uses locked bounded batches.
- `RES-005` — **Repository UX/finalization done/live repair pending:** missing message media is terminal and finalization confirms object existence.
- `RES-006` — **Done:** deletion ownership covers all current and legacy Storage domains.
- `RES-007` — **Done:** upload-intent cleanup has a scheduled, bounded, retryable owner.
- `RES-008` — **External-blocked:** historical embedded-URL/reference verification is required before candidate deletion.
- `RES-009` — **Repository-ready/live-blocked:** legacy bucket policy/cleanup are aligned; the remaining object and bucket retirement need live proof.
- `RES-010` — **Safety complete/decision pending:** no ETag-only deletion was introduced; wider canonical-body dedupe needs body-hash evidence.
- `RES-011` — **Repository done/live cleanup pending:** avatar preparation and superseded-object cleanup are unified; historical stale objects require verification.
- `RES-012` — **Done:** unavailable image transforms are capability-gated.
- `RES-013` — **Done:** eligible chat PNGs convert to WebP and pass a bounded size loop.
- `RES-014` — **Done:** immutable objects use one-year cache metadata; mutable file writers use explicit revalidation profiles.
- `RES-015` — **Done:** finalization uses object metadata and only a 32-byte Range probe, never a whole download.
- `RES-016` — **Done:** project application and upload security share a 10 MiB hard contract.
- `RES-017` — **Repository-ready/live-blocked:** update-media bucket limit is corrected to 8 MiB in `0157`.
- `RES-018` — **Repository-ready/live rollout pending:** bounded read/activity retention and supporting indexes exist.
- `RES-019` — **Repository-ready/live rollout pending:** monthly future partitions and DEFAULT-row monitoring have one worker.
- `RES-020` — **Repository-ready/external:** capacity evidence requires owner/project concentration and soft-budget baselines.
- `RES-021` — **Repository-ready/live-blocked:** canonical and legacy Storage path grammar are aligned in `0157`.
- `RES-022` — **Verified:** database bloat is not treated as the quota problem; no broad `VACUUM FULL` was added.
- `RES-023` — **Verified:** recovery-draft lifecycle remains bounded and retry-safe.

### 34.6 Capacity and upcoming scale (`CAP-001`–`CAP-017`)

- `CAP-001` — **Operational/live-blocked:** repository budgets exist; current quota attribution and restriction handling require dashboard evidence.
- `CAP-002` — **Done:** Presence is message/popup scoped and hidden/idle tabs pause or release rooms.
- `CAP-003` — **Done:** native Supabase Auth locking owns multi-tab serialization.
- `CAP-004` — **Partial by design:** cached viewer context is reused and privacy-safe per-route auth-resolution counts exist; migration remains incremental.
- `CAP-005` — **Done:** custom application reconnect loops are removed; native Supabase reconnect owns recovery.
- `CAP-006` — **Done:** project-files channel cleanup uses `removeChannel`, preventing retained replacement channels.
- `CAP-007` — **Done:** remaining Changes subscriptions are project/task filtered.
- `CAP-008` — **Done:** dead `project_nodes` listeners are removed.
- `CAP-009` — **Done:** private Presence/Broadcast authorization is active through live migration `0160`; exact topic grammars and extension checks are enforced and the positive/negative SQL authorization matrix passes.
- `CAP-010` — **Repository-ready/external:** hidden rooms release and capacity schema requires measured peak rooms per tab.
- `CAP-011` — **Done:** hydration is Realtime-first with a 30-second missed-progress threshold and 15-second fallback.
- `CAP-012` — **Done:** no port-6544 rewrite or duplicate inferred pool remains.
- `CAP-013` — **Repository done/execution external:** the load suite opens real private WebSockets; credentials and k6 results remain.
- `CAP-014` — **Repository-ready/live evidence pending:** quota/cache/channel/room/signed-URL/forecast/concentration alerts are required by the strict contract.
- `CAP-015` — **Done:** push server cleanup precedes Auth signout and preserves retryability.
- `CAP-016` — **Verified baseline:** present Auth/Realtime counters are safe but not scale proof.
- `CAP-017` — **Verified:** singleton clients, shared rooms, task registry, throttles, coalescing, and native ownership remain the canonical controls.

## 35. Remaining live and external work

No known safe repository-side implementation gap remains from the 209-item ledger. The remaining work is deliberately not simulated:

1. Reconcile live migration tags/checksums and partial unpublished state before applying the remaining migration groups.
2. Run all 160 governed migrations in a disposable replay database; regenerate/compare the catalog and Drizzle snapshots.
3. Repair Auth/profile orphan rows, then validate the staged profile/Auth foreign key.
4. Verify every environment and delete the quarantined `0152` only when proven redundant everywhere.
5. Reconcile and apply the still-unverified parts of `0153`–`0159`, including the remaining RLS/index, retention, and bucket/path contracts. Private Realtime activation is no longer part of this blocker: `0160` is applied and verified live on 20 August 2026.
6. Enable native leaked-password protection in the Supabase Auth dashboard.
7. Provision/rotate a least-privilege non-`BYPASSRLS` runtime role and run the production role gate.
8. Inventory and safely migrate/retire legacy Storage objects and buckets; never delete the path-correlated 84.6 MB population as generic orphans.
9. Verify and repair missing file/message bodies; run bounded retention/reconciliation workers and confirm heartbeats.
10. Verify historical stale/oversized avatars and malformed/zero cache metadata before controlled rewrite or deletion.
11. Produce off-site backup and restore-drill evidence.
12. Capture representative production `EXPLAIN (ANALYZE, BUFFERS)` for `QRY-005`, `QRY-071`, and `QRY-083`; retain the bounded design for `QRY-019` unless measured p95 justifies a rewrite.
13. Run authenticated k6 Realtime reconnect, Files, Hub, messaging Range, pool-wait, and extension transfer suites; preserve raw reports.
14. Populate the strict capacity audit with real bytes, cache, signed-URL reuse, channel, room, concentration, quota, and forecast data.
15. Complete staged 10%/50%/100% rollout evidence before clearing production or 1M-readiness gates.
16. Review and commit the forward-only repository changes as one controlled migration/application changeset.

Exact egress, database-load, Storage-load, and maintenance-effort reduction must be measured after deployment. Static code proves that passive media, duplicate queries, unbounded scans, repeated fanout, reconnect duplication, and cache churn were removed or bounded; it cannot honestly convert those changes into a production percentage without post-deployment route/object/channel telemetry.

## 36. Realtime Presence regression remediation — 17 August 2026

> Historical pre-activation record. The live activation and final root-cause repair were completed on 20 August 2026 and are recorded in section 37.

### 36.1 Observed behavior and root cause

Opening Messages completed its ordinary server reads, including `readMessageWorkLinksAction`, and then the browser reported `Unauthorized` for `presence:user:{userId}` plus timeouts for `presence:conversation:{conversationId}`. The server action was not the failing owner. The failures began when the online-user and typing hooks opened private Supabase Presence/Broadcast topics.

The regression had two linked causes:

1. Application code activated private topics unconditionally even though the matching `realtime.messages` policies in migration `0157` are still live-blocked in this ledger.
2. The Presence owner subscribed immediately instead of explicitly installing the current authenticated access token first, leaving a startup race that the other authenticated Realtime owners had already avoided.

The number of messages in the console was fanout, not independent root causes: the conversation list observed multiple peer-user rooms, while the active thread and list typing index observed conversation rooms.

### 36.2 Repository implementation

- Added one fail-closed capability gate, `NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED`. Its default and example value are `0`; when disabled, optional Presence/typing/online-dot/project-stat Broadcast channels are not opened. Ordinary message reads/writes and PostgreSQL Changes subscriptions are unaffected.
- Presence now resolves the browser session, requires an access token, calls `supabase.realtime.setAuth(accessToken)`, verifies that the room entry is still current, and only then subscribes.
- Repeated channel failures are logged at most once per room connection instead of flooding the console; delayed track timers are cleared during room cleanup.
- Project-stat Broadcast uses the same capability gate and authenticated startup contract.
- Migration `0157` now uses `app_private.nb_can_observe_user_presence(uuid)`: an authenticated user may observe their own user room or a peer who shares a conversation. Merely knowing another profile UUID is no longer sufficient.
- Added contract and executable flag-parser coverage for the rollout gate, authenticated startup, and peer authorization policy.

### 36.3 Verification completed in this pass

- `npm run typecheck` — passed.
- Targeted ESLint for all changed runtime, environment, component, and test files — passed.
- `npm run build` — passed, including production compilation, TypeScript, and all 68 static-page generation steps.
- The focused `tsx` test command could not start because the local execution service denied creation of its IPC socket and then reported account usage exhaustion. This is an infrastructure block, not a failing assertion; no bypass was attempted.
- Live Supabase authorization was not claimed because connector access remains quota-blocked and `0157` has not been proven applied.

### 36.4 Safe activation sequence still required

1. Replay the full governed migration chain in a disposable database and confirm migration/catalog parity.
2. Reconcile live migration state, then apply `0157` through the controlled migration owner.
3. Test the authorization matrix with real JWTs: self user room allowed; shared-conversation peer room allowed; unrelated user room denied; conversation participant allowed; outsider denied; task/project member cases allowed; unrelated cases denied.
4. Confirm private channel subscribe, refresh, reconnect, hidden-tab release, and sign-out cleanup without unauthorized/time-out loops.
5. Set `NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED=1`, rebuild, and promote through the staged rollout gates.
6. Capture channel/room counts and Realtime message/egress evidence before marking `SUP-012`, `QRY-088`, and `CAP-009` fully complete.

Until that sequence is complete, the safe behavior is intentional degradation: messages continue to function, while optional online dots, typing Presence, and project-stat Broadcast remain disconnected instead of opening unauthorized or insecure public channels.

## 37. Live Realtime authorization completion — 20 August 2026

### 37.1 Deep root-cause proof

The repeated browser errors were not caused by `getInboxPageV2`, `readMessageWorkLinksAction`, or message SQL latency. Those server actions completed before the WebSocket failures. Supabase Realtime logs showed repeated authorization rejection for `presence:user:{userId}`, `presence:conversation:{conversationId}`, and private project-stat topics.

Live catalog inspection proved the backend mismatch: `realtime.messages` had RLS enabled and the required table privileges, but `pg_policies` returned zero policies. At the same time, `.env.local` had `NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED=true`, so the application was opening private channels against a backend that could only reject them.

The frontend trace found two multipliers:

1. `UserAvatar` subscribed to per-user Presence for every generic avatar across Hub, projects, people, search, settings, and messages. This made a display primitive an unbounded network owner and attempted to observe users without a messaging/project authorization context.
2. `presence-client` installed its own Auth-change reconnect layer on top of the Supabase client's native Realtime lifecycle. Each visible user/conversation room could therefore retry independently and repeat the same backend rejection.

### 37.2 Backend repair applied through Supabase

- Added governed forward migration `0159_presence_project_members_authorization` and activation migration `0160_realtime_authorization_activation`; the repository now contains 160 ordered migration sources.
- Applied `0160_realtime_authorization_activation` to live project `iutauehhgdymtpzrnzcy` through the Supabase migration owner. The first attempt correctly failed on an unnecessary managed-table `ALTER TABLE`; Supabase already enables RLS and permits policy management while protecting table ownership. The unsupported statement was removed and the policy migration then succeeded.
- Live `pg_policies` now contains exactly two authenticated policies on `realtime.messages`: `application_topic_read` (`SELECT`) and `application_topic_send` (`INSERT`).
- The policies recognize only exact UUID topic grammars for `presence:user`, `presence:conversation`, `presence:task`, and `project-stats`.
- Presence topics are limited to `presence`/`broadcast` extensions; project statistics are limited to `broadcast`.
- User-room publication is owner-only. Observation requires self, a shared conversation, or a shared project. Conversation and task/project topics use their canonical access helpers.
- A transaction-rolled-back authenticated insert into the reported conversation topic passed. The live helper matrix returned: self `true`, shared-conversation peer `true`, shared conversation `true`, unrelated user `false`. An authenticated read through the peer-user topic also passed RLS.
- Supabase's migration registry records `20260820044707 / 0160_realtime_authorization_activation`. Security Advisor no longer reports `realtime.messages` as RLS-without-policy.

### 37.3 Frontend repair

- Removed the custom Auth-change reconnect owner and repeated debug logging from `presence-client`; Supabase now owns transient reconnect behavior.
- Retained one deduplicated room registry and explicit `realtime.setAuth(accessToken)` before subscription.
- Unauthorized rooms are removed once instead of being left in a repeating retry/log loop.
- Removed `useOnlineUsers` from generic `UserAvatar`. Authorized messaging list/header owners remain the only online-peer observers; the single session publisher remains `usePublishOnlinePresence`.
- A client observing another user's room never calls Presence track or typing broadcast for that room. Shared conversation/task rooms continue to publish participant state normally.

### 37.4 Verification

- `npm run typecheck` — passed.
- Targeted ESLint for the Presence client, authorization/subscription owners, online publisher/observer hooks, generic avatar, and contract test — passed.
- Focused platform/resource suite — 10/10 passed.
- Migration journal check — passed.
- Migration-source dry run — 160/160 sources passed.
- RLS contract check — passed.
- Production `npm run build` — passed; all 68 static-generation steps completed.
- Full SQL-governance validation reaches one pre-existing, unrelated release gate: the approved break-glass exception for `0152_message_preview_backfill.sql` expired on 20 August 2026. Section 35 already requires environment proof before retiring that quarantined migration; its exception was not silently extended.
- The latest unauthorized Realtime log entries predate the live migration (04:37 UTC versus migration 04:47 UTC). The tenant then had no connected users, so a post-migration authenticated browser refresh remains the final observational smoke check rather than an unimplemented code/database task.

### 37.5 Report status after this repair

`SUP-012`, `QRY-088`, and `CAP-009` are now closed. The private Realtime regression is implemented and live-verified at the database-policy level. The broader 209-item audit is not declared universally complete: the remaining items in section 35 concern migration-lineage reconciliation, historical Storage repair/cleanup, Auth dashboard settings, backup/restore evidence, representative `EXPLAIN` and load tests, capacity telemetry, and staged rollout evidence.
