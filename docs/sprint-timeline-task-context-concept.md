# Sprint Timeline and Task Context Concept

## Status and purpose

This document defines the agreed target for the Sprint tab's timeline and its task-detail dropdown. It is a product and architecture specification for later implementation. It does **not** authorize removal of current code, database history, or user data.

The target is a calm, human-readable Sprint story. A Sprint should explain what was started and what work exists. Detailed files, versions, and discussion belong inside the relevant task, not as a long stream of unrelated timeline rows.

The design takes inspiration from ReUI's pipeline-step and collapsible timeline patterns, without copying its UI or introducing the ReUI package. The relevant principles are: concise summaries, progressive disclosure, recognizable states, and consistent icon treatment.

### Scope boundary

This concept changes the Sprint tab's selected-Sprint content and its task-context disclosure only. It does not redesign the Tasks, Files, Updates, messages, or global notification screens. Those surfaces continue to own their existing detailed views; the Sprint tab links into them when deeper work is needed.

## 1. Product principles

1. **One clear Sprint story.** The outer view contains meaningful Sprint and task events only.
2. **Tasks are the unit of work.** A task appears once in the outer view; file versions and comments do not create extra peer rows.
3. **Current truth over status noise.** Repeated changes such as `To Do → In Progress → To Do` do not create a visible log. The task dropdown displays the current state.
4. **Details are on demand.** Files, versions, and discussions are available when a person opens the associated task.
5. **Human attribution is explicit.** Where creation matters, show the actual person and their avatar—not a generic role such as “a project leader.”
6. **The interface is quiet.** Avoid continuous decorative thread lines, random icons, excessive badges, and dense technical metadata.
7. **Ownership is predictable.** A task, its files, and its discussion have one task-context home. They must not reappear as duplicate peer events in the Sprint story.

## 2. Sprint layout and header

### 2.1 Free-flowing content area

The right-hand Sprint area is normal project content, not a docked panel or a self-contained dashboard frame. It must follow the same free-flowing reading model as the Updates tab:

- no enclosing card border around the Sprint header and timeline;
- no large rounded container, dock-like edge, or internal panel boundary that traps the content;
- no unnecessary divider separating the header from the first event;
- normal page spacing that lets the header, timeline, and expanded task context read as one content column.

The selected-Sprint content uses the same maximum content width, responsive gutters, and vertical rhythm as Updates. An expanded task uses indentation and spacing to express hierarchy rather than a heavy card border.

The left-hand Sprint history selector may remain a separate navigation control. This requirement applies specifically to the right-hand selected-Sprint content.

On narrow screens, Sprint history becomes a compact selected-Sprint control that opens a drawer or picker; the chosen Sprint then uses the full content width. The mobile control must preserve selection, keyboard access, and deep-link behavior without duplicating the desktop history column.

### 2.2 Scroll behavior

The selected-Sprint header is part of the document flow. It scrolls away naturally with the timeline content and must not use sticky, fixed, or pinned positioning. The persistent global application and project navigation retain their existing behavior; they do not cause the selected-Sprint header to remain visible.

This behavior must be tested against the actual page scroll container, including nested desktop layouts and mobile navigation, so an ancestor’s sticky or overflow rule cannot accidentally keep the header pinned.

### 2.3 Compact header

The header is intentionally small. It contains only the selected Sprint’s identity and purpose:

```text
Sprint 1 — Validate the onboarding extension
Short supporting description, when present
```

- Show the Sprint name first.
- Remove the icon next to the Sprint name.
- Separate the Sprint name and tagline with a dash or vertical separator; the implementation may choose the clearer responsive option.
- Place the optional short description on the line below. Clamp it in the header rather than allowing a large text block.
- Remove the generic “project leader started this sprint” text.
- Remove all dates from the header, including right-aligned date ranges. Creation time belongs to the attributed Sprint-created event in the timeline.
- Keep authorized Edit or overflow controls compact and visually secondary; they must not restore the header’s former card-like height.

The header must not duplicate the creation event. It answers “what is this Sprint?”; the timeline answers “who created it, when, and what happened next?”

The three text fields are deliberately distinct:

| Field | Purpose | Header | Creation event |
| --- | --- | --- | --- |
| Sprint name | Identifies the Sprint | Required | Required |
| Tagline | One-line objective | Required when present | Required when present |
| Description | Optional fuller context | Optional, clamped | Never shown |

If product research shows that people duplicate tagline and description, the description should be removed rather than creating two competing summaries.

### 2.4 Macro visual layout

This section is the visual source of truth for the whole selected-Sprint experience. It describes hierarchy and placement, not exact pixels, colors, or component library choices. `│` indicates alignment only; it is **not** a continuous decorative timeline line.

#### Desktop: complete Sprint page

```text
Existing global application navigation
Existing project navigation
─────────────────────────────────────────────────────────────────────────────
Sprint history                         Selected Sprint — free-flowing content
──────────────────────────────         ───────────────────────────────────────
Sprint history                          Sprint 1 — Validate the onboarding extension
New Sprint                              Short supporting description, when present
                                      
Upcoming                                ○  Asha Patel created sprint · Sprint 1       18 Jun
  • Sprint 1                             │  Validate the onboarding extension
    tagline + dates                      │
                                      ↳  Asha Patel · Create account validation
                                         [Show task details]
                                      
                                      ↳  Marco Ruiz · Prepare onboarding copy
                                         [Show task details]
                                      
                                      ○  Sprint closed, when applicable
                                      
                                      [Load more]
```

The left column is navigation only. The right column is not a card, dock, or nested scrolling region: it shares the normal project page background and scroll. The selected-Sprint header sits above the first item, then scrolls out of view with it. There is no second schedule header, progress bar, header date, generic starter sentence, large action block, or enclosing timeline border.

#### Desktop: an open task in place

```text
↳  Asha Patel · Create account validation                         [Hide details]
   └─ Task context (indented, no heavy outer card)
      Current task pipeline
      ├─ Created
      ├─ Current owner: Asha Patel
      └─ Current stage: In Progress

      Files and versions                                      2 files attached ▾
      ├─ Design-spec.pdf · Version 3 · Asha · 19 Jun          ▸
      └─ Copy-review.md · Version 1 · Marco · 18 Jun          ▸

      Discussion                                              4 replies ▾
      └─ Latest: Marco · 12 min ago · optional safe preview
```

The reply/disclosure marker belongs to the task row, not to a page-spanning thread. Opening the task expands only its indented context. File groups and discussion each disclose one level deeper; their rows do not escape to become new outer timeline items. The creator avatar appears on the Sprint-created item only. A closed task stays text-only.

#### File and discussion drill-down

```text
Design-spec.pdf · Version 3 · Asha · 19 Jun                    ▾
  Version 3 · Asha · 19 Jun                                    [Open] [Download]
  Version 2 · Asha · 18 Jun                                    [Open] [Download]
  [Load earlier versions]

Discussion · 4 replies                                         ▾
  Asha · 10:12  Current form copy is ready.
  Marco · 10:26  I will review the error state.
  [Open full task conversation]  [Load earlier replies]
```

Actions appear only when the existing file/discussion policy permits them. If the viewer cannot access an item, neither a count nor a preview is shown. A deleted file becomes a labeled unavailable history row with no broken action.

#### Tablet and mobile

```text
Existing global application navigation
Existing project navigation
────────────────────────────────────
[Sprint 1 ▾]  compact Sprint picker / drawer trigger
────────────────────────────────────
Sprint 1 — Validate the onboarding extension
Short supporting description

○ Asha Patel created sprint · Sprint 1
  Validate the onboarding extension

↳ Asha Patel · Create account validation       [Show details]
  └─ Open context uses full available width
     Pipeline
     Files ▾
     Discussion ▾

[Load more]
```

On narrow screens there is no simultaneous history column. The compact picker is the sole history control; selection keeps the same URL/deep-link behavior as desktop. Each disclosure has a full-row touch target, and nested content indents modestly without reducing readable line width. Only one task can be open, which prevents an excessively tall, confusing mobile page.

#### Reading and interaction stages

```text
1. Select a Sprint
   → history card on desktop / compact picker on mobile

2. Orient
   → compact name, tagline, optional short description

3. Read the permanent Sprint story
   → creator event, one compact entry per task, optional close event

4. Open exactly one task
   → current pipeline, grouped files, grouped discussion

5. Open a file group or discussion summary only when needed
   → versions or replies, each independently paginated

6. Continue deeper work in its existing home
   → Tasks, Files, or full task conversation; Sprint keeps only the summary
```

#### Layout invariants

| Area | Must be present | Must not appear |
| --- | --- | --- |
| Selected-Sprint header | Name, tagline, optional clamped description, compact authorized controls | Icon, dates, schedule, progress bar, creator sentence, large card frame |
| Sprint-created row | Creator avatar/name, `created sprint`, name, tagline, timestamp | Generic role wording or full description |
| Closed task | User name, task name, reply/disclosure control | Avatar, status history, files, comments, technical activity |
| Open task | Current pipeline, grouped files, grouped discussion | Page-wide thread line, duplicate outer events, an independent conversation product |
| Files | Stable file groups and version disclosure | One outer timeline row per attachment or version |
| Discussion | Count/latest summary and reply disclosure | One outer timeline row per reply |
| Mobile | One compact Sprint picker and full-width content | Duplicate desktop history column or trapped inner scroll panel |

## 3. Sprint creation event

The first Sprint entry records the person who created it.

| Element | Required presentation |
| --- | --- |
| Person | Creator avatar and display name |
| Action | `created sprint` |
| Sprint | Sprint name |
| Supporting text | Sprint tagline only; never the full description in this row |
| Time | Creation date/time, using the application’s normal relative-time treatment where appropriate |

Example:

`Asha Patel created sprint · Sprint 1`  
`Validate the onboarding extension`

This replaces generic text such as “A project leader kicked off the sprint.” The creator snapshot must remain available even if the person later changes their profile name or leaves the project; current profile data may enhance the display when it is still available. The displayed person may link to their profile when that profile remains visible to the viewer; otherwise the event remains readable with its stored name snapshot and a neutral fallback avatar.

## 4. Outer Sprint timeline

### 4.1 Structure

The outer timeline is a vertically ordered list in the same free-flowing content column as the header, with no enclosing card. It has no continuous line running through every item. Each major event has one standalone marker in the existing left alignment. It communicates the event category but is not visually connected to neighbouring items.

The Sprint-created item uses a restrained Sprint/start marker. Each task uses a reply/disclosure marker. These are not play icons or file icons. The Sprint marker is informational and hidden from assistive technology; the task marker is a real button because it opens the task context.

### 4.2 Outer-view content

The outer view contains only:

- the Sprint-created event;
- one compact entry per task; and
- optionally a Sprint-close event when a Sprint is completed.

It does not render peer rows for file attachment, file version, comment, task assignment, or each task-status change.

The list is ordered by canonical event timestamp and stable ID. Initial loading is bounded, with an explicit accessible `Load more` action for older task entries. This keeps a long-running Sprint readable without an unbounded initial render.

### 4.3 Color and icon system

The visual system is intentionally limited:

- neutral gray for structure, inactive states, and historical information;
- one project accent for selected controls and the current pipeline step;
- green only for a completed task or completed Sprint;
- amber only for blocked or needs-attention status;
- red only for a genuine error or failed action.

Icons must come from one existing, accessible icon set and retain fixed sizes, labels, and hover/focus behavior. The UI must not choose icons randomly by file type or event type.

## 5. Task entry states

### 5.1 Closed task entry

A closed task is deliberately compact. It shows only:

- the user’s name;
- the task name; and
- a small reply/disclosure control that opens task context.

The closed row does not show an avatar, status-history chips, attached-file rows, comment rows, file-version labels, or technical activity. The control exposes an accessible name such as `Show task details for [task name]`.

### 5.2 Open task entry

Opening the task reveals a self-contained task-context panel. A reply-style anchor icon communicates that its contents belong to the selected task. This local visual relationship is not a revival of the old, page-spanning thread line.

The open panel has three sections, in this order:

1. **Current task pipeline**
2. **Files and versions**
3. **Discussion**

Only one task context may be open at a time. Opening another task closes the first, preserves its cached data, and avoids a long page of simultaneously expanded panels. The selected task is reflected in the URL, for example `?task=<task-id>`, so browser navigation and notifications reopen the correct context. Closing returns to the compact task row without losing the reader’s scroll position.

## 6. Current task pipeline

The open task panel presents a concise, step-by-step process view, inspired by pipeline steps rather than an audit log:

```text
Created
Current owner: Asha Patel / Unassigned
Current stage: In Progress
```

This is intentionally a current-state pipeline, not an assertion that every task passes through fixed stages. `Current owner` is optional and may remain `Unassigned`; a task can be active without an assignee. `Current stage` maps to the project’s current workflow-column label, rather than forcing every project to use generic status vocabulary.

The pipeline uses the current task snapshot. It must not list every past movement between workflow columns. If a task changed status ten times, the task still presents one current status. The creator and current assignee remain visible as meaningful context, but old assignee changes are not rendered as a public Sprint history. Blocked, done, cancelled, archived, and unavailable stages receive distinct text treatments as appropriate; color never carries the meaning by itself.

## 7. Files and versions

### 7.1 File grouping

Files are grouped by stable file identity inside the task panel. A new attachment and later updates to it do not become separate outer Sprint entries. If the existing product permits a file to belong to more than one task, the file remains one reusable file record and each authorized task context displays its own relationship to it.

Each closed file group communicates the current useful state:

- file name;
- current version, when versioned;
- most recent updater; and
- updated time, where helpful.

Examples:

- `Design-spec.pdf · Version 3`
- `2 files attached`
- `1 file updated`

The system does not say “new since you viewed” unless it reuses an existing, reliable per-user task read state. The default summary is viewer-independent, avoids hidden state, and remains correct across devices.

### 7.2 Version details

Opening a file group reveals its version list in descending order:

- Version number or immutable version label;
- person who uploaded the version;
- timestamp; and
- an authorized action to open or download that version.

The current version is clear but previous versions remain available to authorized users. The action set—open, download, compare, or restore—must reuse the existing file permission model and be explicitly allowed by project policy. A deleted or unavailable file remains represented as unavailable history without exposing a broken action.

### 7.3 Multiple files

When many files belong to a task, the task panel shows a compact attachment summary first. A nested disclosure reveals individual file groups. Large attachment sets paginate or load more on demand; they never expand every version by default. The initial context response contains at most five file groups; subsequent groups use an independent cursor.

## 8. Discussion

Discussion stays in the task panel as a grouped context, not as separate Sprint rows.

The collapsed discussion summary can show:

- total visible reply count;
- latest visible participant; and
- latest visible reply time or short safe preview.

Opening it shows the relevant replies in chronological order, with a clear route to the full task conversation when necessary. Long discussions use cursor pagination and start with the most useful recent context, not the entire message archive. The initial context response contains at most five visible replies.

The expanded Sprint view is a concise task context, not a second conversation product: composing, notification controls, rich search, and the complete message archive remain in the existing task conversation surface.

Discussion visibility obeys existing project and task permissions. A person who cannot access a comment or file must not receive its title, preview, metadata, or count through the Sprint endpoint.

## 9. Data contract and lifecycle

The outer Sprint timeline consumes a compact, canonical data shape. Expanding a task requests a task-context payload scoped to that task and the current viewer.

### 9.1 Sprint attribution and outer-row contract

A task belongs to one outer Sprint story: the Sprint in which it was first created or first added. If it later moves to another Sprint, it may appear in that Sprint's normal current-work surfaces, but it does not create a second outer `task created` timeline row. The original Sprint story remains stable and the move stays internal operational data unless a future, separately approved audit experience requires it.

```text
SprintCreatedRow: creator snapshot, sprint name, tagline, timestamp
TaskSummaryRow: task id, original Sprint attribution, creator name snapshot, task title, origin timestamp
SprintClosedRow: closer snapshot, sprint name, timestamp
```

### 9.2 Task-context contract

```text
TaskContext:
  task snapshot: creator, current assignee, current workflow/status
  attachment summary: total files, latest file-change type, latest update time
  file groups: file id, current version, updater, version count
  discussion summary: visible reply count, latest visible reply metadata
  cursors: files, versions, and discussion continuation cursors
```

File versions must reference stable task, file, and version IDs. Repeated delivery of the same update must be idempotent. Server responses must be sorted by stable timestamp plus ID so real-time delivery and refetches cannot reorder or duplicate details. Cache keys and server authorization are scoped to project, Sprint, task, signed-in viewer, and the current permission context so one viewer never receives another viewer's attachment or discussion summary.

The implementation uses one focused task-context query and existing task, file, discussion, permission, notification, and real-time infrastructure. It must not create a generic timeline framework, a separate service, or a new dependency solely for this feature. Existing `updatedAt` values or server-issued revision tokens are sufficient; no speculative `current-state revision` abstraction is needed.

This redesign introduces no new project role or timeline-specific permission. Existing project, task, file, and discussion authorization decides what each viewer may see and do; opening Sprint context must never widen that access.

### 9.3 Minimal attribution storage and legacy data

The timeline must derive facts from the existing Sprint, task, file, and discussion records. It must **not** introduce a general-purpose `project_sprint_events` table, an event bus, or a duplicate task/file history merely to render this screen.

The only extra persistence that may be necessary is one narrow immutable task-origin pair: Sprint reference and origin timestamp. First, implementation must check whether the current schema already preserves the Sprint in which a task was created or first added and the time at which that happened. If it does not, add the two nullable fields `timeline_origin_sprint_id` and `timeline_origin_at` to the existing task record in one forward-only migration:

- set both values atomically when a task is created in, or first attached to, a Sprint;
- never overwrite either value when the task moves later;
- use the task's then-current Sprint as the deterministic legacy fallback during one bounded backfill; and
- leave unassigned/never-Sprint tasks without an attribution until they first enter a Sprint.

The backfill is one forward migration with an explicit, reversible-at-the-renderer rollout—not a series of Sprint-specific SQL files. A task creation or first-Sprint assignment must set this pair in the same transaction as the existing task mutation, preventing two concurrent updates from creating conflicting outer rows. Outer Sprint ordering uses this immutable origin timestamp, never a task's later `updatedAt` value.

### 9.4 Status-event policy

The Sprint UI must not create or display one visible activity item per workflow move. If the platform already requires an internal audit for security, support, or compliance, it may retain those records under its existing retention policy outside this user-facing Sprint timeline. No new Sprint-specific status-audit system is created. The task-context view is built from the current task snapshot, not replayed status history.

## 10. Real-time behavior, notifications, and caching

When a relevant change occurs:

| Change | Outer Sprint row | Open task context |
| --- | --- | --- |
| Task created | Add one task row | Shows current pipeline |
| Task status changed | No additional outer row | Current pipeline updates |
| Task reassigned | No additional outer row | Current assignee updates |
| New file attached | No additional outer row | Attachment summary and file group update |
| New file version | No additional outer row | Matching file group displays new current version |
| New discussion reply | No additional outer row | Discussion summary and visible reply list update |

Only the selected/open task context should refresh for file or discussion activity. The entire Sprint must not refetch because one version or comment arrives. Notifications continue to use the existing notification infrastructure and should deep-link to the relevant task context, subject to permissions and notification preferences.

Reconnect after an offline period performs one refetch of the open task context. Real-time payloads and mutation responses are reconciled by entity ID plus `updatedAt` or revision, never arrival order. File-version notifications are coalesced so a burst of uploads does not produce a notification per version. Deep links select the Sprint, open the task, and reveal the relevant authorized section; otherwise they fall back safely to the task row.

Real-time subscription is demand-driven: subscribe only while the relevant Sprint is being viewed and only hydrate the one open task context. A closed Sprint or closed task does not maintain background detail subscriptions. Existing project updates can refresh the compact outer list when necessary; no Sprint-only socket channel is required.

## 11. Performance, accessibility, and resilience

### Performance

- Fetch the outer Sprint list first; fetch task context only after a user opens that task.
- Load no more than 30 outer task rows initially, then use an explicit cursor-based `Load more` action.
- Aggregate file and discussion summaries on the server to avoid client-side N+1 queries.
- Fetch versions and long discussions with independent cursors.
- Invalidate or reconcile only the affected task context after a file/comment mutation.
- Deduplicate real-time and refetched entities by stable IDs.
- Use cursor pagination before adding list virtualization. Virtualize only if measured production rendering of a loaded page is slow after pagination is in place.

Use existing server-action/error monitoring to measure outer-list load time, task-context hydration, continuation usage, fetch failures, duplicate real-time reconciliation, and expanded-panel usage. Do not create a separate Sprint analytics pipeline for this screen. Any measurements are aggregate operational data and must not record file names, comment text, or other private content.

### Accessibility

- Use real buttons for task, file, and discussion disclosures.
- Maintain `aria-expanded`, `aria-controls`, visible focus states, and keyboard operation.
- Give icon-only controls descriptive accessible labels.
- Do not rely on color alone to express current, blocked, or completed state.
- Preserve screen-reader-readable pipeline order and attachment/discussion counts.

### Resilience and edge cases

- No files or discussion: show a short empty state inside the open task only.
- Deleted file/version: retain an unavailable history item without an action that fails.
- Lost permissions: omit protected attachment/discussion content completely.
- Multiple simultaneous updates: use server order plus entity IDs to resolve duplicate delivery.
- Large version/discussion histories: lazy-load and paginate.
- Missing former-user profile: display a stored name snapshot with a neutral fallback avatar.
- A viewer who loses access while a task is open: clear protected file/discussion content and show an access-safe state on the next authorization check.
- Real-time event before mutation response: retain the newest entity revision and discard stale data.
- Outer-list failure: retain normal project navigation and provide one retry action; do not replace the page with a new error framework.
- Task-context failure: leave the task row usable, show an inline retry in that task only, and do not close or refetch unrelated contexts.

## 12. Implementation boundaries

The agreed redesign may remove obsolete Sprint timeline UI and application behavior after approval. It must not delete applied database migration files or alter the production migration journal. Database changes, if still needed after the target is implemented, are additive forward migrations.

The current implementation is not the final design described here. No destructive cleanup, code replacement, data deletion, or schema rollback is part of this report. Implementation reuses the application's existing feature-flag and release process for internal verification, limited-project rollout, and then general availability. Rollback disables the new rendering while preserving data and existing task/file/discussion sources.

## 13. Acceptance criteria

The work is complete when all of the following are true:

1. The right-hand Sprint content is border-free and free-flowing rather than trapped inside a card or dock.
2. The selected-Sprint header is compact, scrolls away with content, has no icon or header date, and contains only name, tagline, optional description, and compact authorized controls.
3. Sprint creation displays the real creator’s avatar, name, action, Sprint name, and tagline.
4. The outer Sprint view has no continuous thread line and uses deliberate standalone markers.
5. A task appears once in closed form with only its user name, task name, and disclosure control.
6. Opening a task reveals the current pipeline, not a status-transition log.
7. Files and versions are grouped under their task and then by file identity.
8. Discussion is grouped under its task and never becomes a peer Sprint event.
9. Multiple file versions and discussion replies remain performant and readable through nested disclosure and pagination.
10. Icons, color states, keyboard behavior, access controls, real-time reconciliation, and failure states are consistent across the feature.
11. Existing deployment history remains safe; any necessary data evolution uses forward-only migrations.
12. A task moved between Sprints never creates a duplicate outer creation row.
13. Tasks with no assignee, custom workflow stages, blocked/done/archived states, no files, and no discussion have intentional, readable states.
14. A task with large file-version or discussion history loads details incrementally without slowing the outer Sprint list.
15. Permission changes, reconnects, loading failures, retry behavior, mobile layouts, keyboard interaction, and deep links are verified before rollout.
16. Legacy tasks receive one deterministic origin-Sprint attribution without a new general event table, and concurrent task creation/movement cannot create duplicate outer rows.

## 14. Locked implementation decisions

- Only one task-context panel is open at a time.
- A closed task is text-only: user name, task title, and reply/disclosure control; no task avatar.
- The outer Sprint list initially loads 30 task rows. An open task initially loads five file groups and five visible discussion replies; each detail stream continues with an independent cursor.
- Viewer-relative phrases such as “new since you viewed” are excluded unless a reliable existing per-user read state can be reused.
- Tasks retain one outer Sprint attribution: the Sprint in which they were first created or added. Moving a task later does not create a duplicate outer row.
- Existing internal audit retention remains governed by its current policy, but ordinary workflow movement never becomes a visible Sprint timeline log and this feature creates no new audit subsystem.
- Existing Sprint/task/file/discussion records remain the source of truth. The only permitted new persistence is one narrow immutable task-origin pair—Sprint reference and origin timestamp—when the current schema lacks it.
- Cursor pagination is the baseline scalability mechanism. List virtualization, a Sprint-specific socket channel, a generic timeline service, and a new telemetry pipeline are explicitly out of scope unless production measurement proves a concrete need.

These decisions are the source of truth for the implementation target. This report remains a design and implementation plan, not authorization to begin code or database changes.
