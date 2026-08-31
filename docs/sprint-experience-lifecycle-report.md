# Sprint Experience Lifecycle Report

## Status

This is a product and design report only. It documents the proposed Sprint, task-context, and assignment experience; it does not authorize or include implementation, data migration, or deletion of existing behavior.

## Objective

Make the Sprint tab a compact, trustworthy story of the Sprint without repeating header information or turning it into a noisy technical activity feed. A reader should quickly understand:

- what Sprint they are viewing;
- who created it and when;
- what tasks belong to its story;
- who owns each task now; and
- where to open richer work context when needed.

## Findings from the current experience

### Duplicate Sprint context

The selected-Sprint header already presents the Sprint name and goal. Repeating both under the creation event consumes valuable vertical space without adding information.

### Creator-attribution fallback

The visible `Creator unavailable` text is not a useful normal-state label. Attribution should come from a durable display-name/avatar snapshot retained when the Sprint is created, so a later profile change or departure does not make history unclear.

### Incorrect assignment statement

The current task sentence is built from the current assignee and task creator rather than the person who made the assignment. This produces misleading output such as `Rama assigned to Ramanaidu Ch task` when Ramanaidu Ch actually assigned the task to Rama.

The data model already distinguishes the assignment action's actor from the assignee in task activity. The presentation must use those separate fields when it describes an assignment. It must never infer the actor from either the task creator or current assignee.

### Weak task-title hierarchy

The task title is currently visually similar to surrounding metadata. The task title needs to be the dominant text element so a reader can scan the actual work quickly.

## Recommended Sprint layout

### Selected-Sprint header

The header is the sole identity and purpose summary for a Sprint:

```text
Sprint 1 — Validate the onboarding extension
Short supporting description, when present
```

It contains the name, goal/tagline, optional short description, and compact authorized actions. It does not repeat creator text, dates, progress bars, large summary cards, or a second schedule summary. It remains part of normal page flow rather than being sticky.

### Sprint creation event

The first timeline event should be intentionally minimal:

```text
Ramanaidu Ch created this sprint                         18 Jun 2026
```

It shows the real creator's avatar and display name, the action, and a timestamp. It must not repeat the Sprint name, goal, or full description because those belong in the header.

When the current creator profile is not available, render the saved name snapshot with a neutral avatar. If no attribution was captured at all, use a calm fallback such as `A project member created this sprint`; do not expose a misleading system-error phrase as normal product copy.

### Compact task row

Each task appears once in the outer Sprint story:

```text
Rama · Update the related files                                      [Show details]
```

The assignee is secondary, while the task title is darker and semibold/bold. The collapsed task row should not show avatars, files, comment rows, version labels, or an assignment-history sentence.

The title is the visual anchor. Description text is optional, clamped, and lighter than the title. Status should normally live in the expanded context, unless a concise status signal is necessary for a specific operating need.

### Expanded task context

Opening a task exposes its useful current context in this order:

1. **Task overview** — bold task title, current workflow stage, short description.
2. **Ownership** — created by and current owner/assignee, including an intentional `Unassigned` state.
3. **Files and versions** — grouped by file identity, with versions available only after another disclosure.
4. **Task handoff** — an authorized route to the task and its discussion, without rendering conversation content in Sprint.

Only one task context should be open at a time. Opening another task closes the previous one while retaining cached data. The selected task should be reflected in the URL, so a browser back action, notification, or shared link reopens the correct Sprint and task.

## Assignment language and data contract

### Definitions

- **Creator:** the person who created the task.
- **Assignment actor:** the person who assigned or reassigned the task.
- **Assignee/current owner:** the person currently responsible for the task.

These are independent roles and must never be substituted for one another.

### Presentation rules

When an assignment action is intentionally displayed, use its recorded event data:

```text
Ramanaidu Ch assigned “Update the related files” to Rama
```

For older data that lacks a durable assignment event, do not invent history. Show only the current fact:

```text
Assigned to Rama
```

The outer Sprint list should normally avoid assignment-event sentences. It should be a stable, readable list of work. Accurate assignment details belong in task context or the dedicated task activity view where audit detail is genuinely needed.

### Required event behavior

Every assignment or reassignment event should retain:

- event ID and timestamp;
- task ID and Sprint-at-the-time-of-event;
- assignment actor ID plus a safe display-name snapshot;
- previous assignee, when applicable; and
- new assignee ID plus a safe display-name snapshot.

The current task snapshot remains the source of truth for current ownership. Event data is used only to make historical statements accurately.

## End-to-end lifecycle

| Stage | Outer Sprint experience | Expanded task / deeper experience |
| --- | --- | --- |
| Sprint created | One creator-attributed row with date only | — |
| Task created or added | One compact task row in its origin Sprint | Creator, current owner, workflow stage, description |
| Task assigned or reassigned | No extra outer timeline row | Accurate assignment event only where activity detail is requested; current owner remains clear |
| Work progresses | Existing task row remains stable | Show current workflow stage, not a repeated transition log |
| Files added or updated | No peer timeline rows | Group by file identity, then disclose versions on demand |
| Discussion occurs | No peer timeline rows | Show only an authorized handoff/count that opens the complete task conversation |
| Task moves to another Sprint | Preserve its one historic origin row | Current Sprint is reflected in operational task views; do not duplicate history |
| Sprint completes | Optional compact close event | Task context remains available and readable |
| Profile or permission changes | Use safe attribution fallback | Omit protected data and avoid broken actions |

## Product rules to lock

1. The outer Sprint story contains only the creation event, one row per task, and an optional completion event.
2. The creation row contains no repeated Sprint name, goal, or description.
3. The header owns Sprint identity and purpose; the timeline owns activity attribution and work entry points.
4. A task has one outer Sprint row, even if it changes workflow state, receives comments/files, changes assignee, or later moves to another Sprint.
5. The outer row never invents assignment history from present-day task fields.
6. An expanded task presents current truth first: title, stage, owner, files, and a compact handoff to Task-tab discussion.
7. Files remain nested inside task context; comments never become peer Sprint events or embedded Sprint content.
8. Only one task context is open at a time, and the selection is deep-linkable.
9. The selected-Sprint content is free-flowing page content, not a trapped scrolling card or nested dashboard panel.
10. Mobile replaces the desktop Sprint-history rail with one compact Sprint picker and gives task context the available full width.

## Task-context branching model

### Core intent

The main Sprint timeline must stop at each task row. Opening a task must not extend, touch, or visually continue the Sprint's main threadline through task details, files, file versions, comments, or other task-related content.

Instead, the task's reply/disclosure icon is the local origin for a small child branch. The branch communicates that the newly visible content belongs to that one task, not to the Sprint as a whole.

```text
○ Ramanaidu Ch created this sprint                         18 Jun

↳ Rama · Update the related files                         [Hide details]
  └─ Task context
     ├─ Task details
     └─ Files & versions

↳ Asha · Review onboarding copy                           [Show details]
```

The page-wide Sprint history therefore remains calm and scannable. The only purpose of its markers is to identify the Sprint creation, compact task entries, and an optional Sprint completion event. It has no line that passes through a task's nested detail groups.

### Local branch rules

- A closed task has no visible child connector. It remains a compact task row.
- Opening the task creates a short local branch from that task's reply/disclosure icon.
- The local branch ends with the task's expanded content. It never reconnects with, or becomes part of, the main Sprint line.
- Nested groups may use additional short connectors only to show immediate parent-child relationships. They must not form a dense decorative tree.
- The task row itself remains the stable parent. Files, versions, subtasks, and current task metadata are descendants of it; discussion remains in the Task tab.
- Opening another task closes the previous task branch. This preserves orientation and prevents a long, tangled expanded page.

The intended relationship for files is especially important:

```text
↳ Update the related files
  └─ Files & versions
     └─ ExportButton.test.tsx
        ├─ Current version: Version 3
        └─ Earlier versions
```

A file version is nested under its file; a file is nested under its task; neither is a sibling event in the Sprint timeline.

## Expanded task-context design

### Group order and purpose

Every opened task uses the same predictable group order:

1. **Task details** — current task snapshot and essential operating information.
2. **Files & versions** — task attachments grouped by stable file identity.
3. **Task handoff** — compact actions that route into the complete task and its authoritative discussion.

This is a current-context view, not an audit-log replay. Repeated status changes, assignee changes, attachment churn, and comments do not become a visually noisy sequence in the Sprint tab.

### Task details

The first section should make the task itself unmistakable:

- The title is dark and semibold/bold—the strongest text element in the entire expanded context.
- The description is secondary, comfortably readable, and can be clamped when long with an explicit way to read more.
- Current workflow stage is shown with its project-specific column label, not a forced generic vocabulary.
- Current owner is clearly labelled, with a deliberate `Unassigned` state rather than an empty field.
- Creator is available as context but never confused with the current owner or an assignment actor.
- Priority, due date, linked Sprint, and a subtask summary appear only when present and useful to executing the work.

The section presents today's true task state. It must not claim a present owner performed a past assignment merely because they are assigned now.

### Files and versions

The closed group begins with a concise, useful summary, such as `Files & versions · 3 files`. It may add a simple current-state hint, such as `1 updated recently`, only when that state can be computed reliably.

Opening the group reveals one row per file identity. A file row includes:

- file name;
- current version or immutable version label, when versioned;
- most recent updater and timestamp where helpful; and
- an authorized action to open or download the current version.

Opening one file row reveals its versions in descending order. Each version identifies its immutable version number/label, uploader, timestamp, and authorized actions. The current version is visually clear, while earlier versions remain available without flooding the initial view.

New files and new versions must be treated differently. A new attachment creates a new file group. Uploading a replacement creates a new version beneath the existing file group. The experience must not accidentally display a replacement as a second unrelated file.

### Task discussion handoff

The Sprint task context does not render a Discussion group or reply content. It can expose an authorized `Open discussion` action, optionally with a safe reply count, that opens the exact task's Discussion area in the Task tab.

The Sprint view does not show participant names, latest-reply previews, compose controls, or any conversation history. Composing, full-history search, notification preferences, and conversation controls remain exclusively in the authoritative task/message surfaces.

### Subtasks and related work

When a task has subtasks, the Task details group should present a concise completion summary first, for example `3 of 5 subtasks complete`. A disclosure can reveal individual subtasks. Subtasks remain task detail; they do not create outer Sprint rows.

Other related work, such as linked documents or dependencies, should follow the same rule: show a concise current summary inside the task context and route to the owning product surface for deeper management. Do not make them peer Sprint events.

## Adding, changing, and removing task content

### Task information

Editing a task title, description, workflow stage, priority, due date, owner, or subtask list updates the current task snapshot. It does not append a new row to the outer Sprint timeline.

Task edits should save through one focused, authorized edit experience and return an explicit success or error state without unnecessarily reloading the entire Sprint page. The expanded task remains open after a successful update, and only the affected section is refreshed.

### Ownership and assignment

Reassignment changes the current-owner field immediately. It does not add an outer Sprint event.

If the product exposes assignment history in an appropriate detailed activity surface, that history must use recorded event data: `assignment actor assigned task to assignee`. For example, `Ramanaidu Ch assigned “Update the related files” to Rama`. Historical actor identity must never be inferred from the task creator or current owner.

For legacy records without an assignment event, show a current statement such as `Assigned to Rama`; never fabricate an actor or a past assignment narrative.

### Adding files

An authorized user can attach an existing project file or upload a new file from the task context. The newly attached file appears in the Files & versions group immediately after the mutation succeeds.

The UI must distinguish:

- **Attach a new file** — creates a new file group under this task.
- **Upload a new version** — adds a version beneath an existing file group.
- **Link an existing project file** — establishes a task-to-file relationship without duplicating the underlying file.

Clear labels and confirmations are necessary because these actions have different consequences.

### Removing files and versions

`Remove from task` must detach the file only from the current task. It must make clear that the project file, other task links, and its version history remain unaffected.

`Delete file` is a separate, higher-impact action available only when authorization permits it. Its confirmation must state whether the deletion affects other tasks or project-wide access. A globally deleted or unavailable file should be represented, where historical context is needed, as a non-clickable `File unavailable` item; no broken open/download action may remain.

Removing an individual immutable version should be exceptional and follow the existing retention/permission policy. The version list must not silently renumber or imply that a removed version was never present.

### Discussion and comments

Adding a comment never adds a peer Sprint event or embedded reply content. It may update an authorized compact `Open discussion` reply count in the open task context. Deleting or redacting a comment follows the Task tab's existing permission policy and may remove or refresh that compact Sprint signal without exposing inaccessible text.

## State and edge-case design

| Situation | Intended Sprint-tab behavior |
| --- | --- |
| No current owner | Show `Unassigned`; do not leave ownership blank. |
| No attached files | Show `No files attached yet` inside the open task, plus an authorized add action. |
| No discussion | Show an authorized `Open discussion` route only when the task policy permits starting one; otherwise omit it. |
| One file with many versions | Show the current version first; disclose earlier versions on demand. |
| Many files | Show a count first, then progressively load individual file groups. |
| Former creator/assignee/actor | Use a stored readable name snapshot and neutral fallback avatar. |
| File unavailable or deleted | Retain clear historical context when needed, but remove actions that would fail. |
| Task deleted or archived | Present a safe unavailable/archived state; avoid silently losing the surrounding Sprint context. |
| Task restored | Restore the task's normal compact row and current context without adding a duplicate historical row. |
| Task moved to a different Sprint | Keep the one original Sprint-story row; current placement is handled by operational task surfaces. |
| Viewer loses access while open | Clear protected Files data and remove any protected discussion handoff/count on the next authorization check; leave the task row functional. |
| Concurrent task/file/comment update | Refresh only the affected task group while preserving the reader's open state and scroll position. |
| Task-context load failure | Show retry inside the affected task or group; leave the rest of the Sprint usable. |

## Interaction, mobile, and accessibility requirements for branches

- The task reply/disclosure icon and its label are a real button with an accessible name such as `Show details for Update the related files`.
- The button exposes `aria-expanded` and `aria-controls`; file disclosures follow the same pattern. The discussion handoff is a normal labelled navigation action.
- Connector lines are visual structure only and are hidden from assistive technology. Screen-reader order must state the task, then its details, files, and discussion handoff naturally.
- Visible keyboard focus, full-row touch targets, and non-colour text labels are mandatory.
- On narrow screens, local indentation becomes shallower so names and task titles remain readable. The branch still begins at the task control, but it must not make content too narrow.
- Only one task context is open on mobile as well as desktop.
- Outer Sprint rows load first. Task context loads on demand; file groups and version histories use independent pagination/cursors. Full discussion history is loaded only in the Task tab.
- Real-time updates reconcile by stable IDs and revisions/timestamps rather than delivery order, avoiding duplicate files or version rows after a refetch; comment activity can refresh only a safe discussion handoff/count.

## Definition of success for task context

A person can glance at the Sprint tab and understand the Sprint story without being overwhelmed by nested operational detail. When they open a task, it is immediately obvious that Task details, Files & versions, subtasks, and related work belong to that task—not to the overall Sprint timeline—while discussion has one clear Task-tab home.

The visual branching, information hierarchy, and action wording together make the user confident about what they are viewing, what will change when they act, and whether they are changing only the task relationship or the underlying project-wide file/work item.

## Smooth task disclosure and prepared content lifecycle

### Core intent

Opening a task in the Sprint tab must feel like one composed interaction. It must not abruptly reveal a panel and then begin rendering files, versions, and related task content as a visually separate second step.

Opening is a presentation action, not the point at which data loading begins. By the time a user opens a normally visible task, the task's useful initial context—including its Files & versions summary and initial file/version information—should already be prepared in a viewer-authorized cache.

The local task branch expands smoothly from the task's reply/disclosure icon. The main Sprint timeline remains still and must never extend through the newly revealed task context.

```text
Closed
↳ Rama · Update the related files                         [Show details]

Opening
↳ Rama · Update the related files                         [Hide details]
  └─ local branch grows smoothly

Open
↳ Rama · Update the related files                         [Hide details]
  └─ Task details
     Files & versions · 3
     [Open discussion · 4 replies]
```

### Opening sequence

For a prepared task, the sequence is coordinated as follows:

1. The disclosure control responds immediately and its chevron/reply treatment changes state.
2. A short local connector grows from the task's reply/disclosure icon.
3. The task-context container expands as part of the same motion.
4. Task details, Files & versions, and an authorized discussion handoff enter together from already available data.
5. The user can immediately understand the task's current context without waiting for file rows to appear later or causing the page to jump.

The panel should use restrained structural motion—approximately 180–240ms for normal expansion—rather than decorative animation. Its content may fade in with a small vertical offset, and the chevron may rotate in sync, but the movement must be quiet and never delay access to controls.

Closing reverses the motion smoothly, preserves the reader's scroll position, and keeps the task row as the stable parent. The branch disappears with its content and does not alter nearby outer Sprint rows.

### Data available at initial task open

The outer Sprint list remains the first payload, but each initially visible task should include a lightweight, viewer-authorized context preview:

- current project-specific workflow stage;
- current owner and creator information;
- file count;
- a current file/version summary for the initially visible file groups;
- an optional safe discussion reply count and a flag that establishes whether the viewer may open the authoritative Task-tab discussion;
- flags that establish whether the viewer may access files.

The exact initial context is intentionally bounded. It should make the first expanded screen complete and useful, rather than attempting to ship every historical version or any discussion replies.

For example, opening a task with files should immediately show:

```text
Files & versions · 3
ExportButton.test.tsx · Version 2 · Rama · 2 min ago
Design-spec.pdf · Version 4 · Ramanaidu Ch · yesterday
```

The reader can then open one file to view its earlier versions. That deeper version history is nested and may use a separate prepared/lazy payload, but current version information must not arrive late after the task context has appeared.

### Background prefetch strategy

Task-context preparation uses explicit intent and visibility priority:

1. **Direct intent:** prefetch immediately when a user hovers, keyboard-focuses, or presses a task disclosure control.
2. **Visible work:** prefetch the initially visible task rows as they enter the viewport.
3. **Idle completion:** prepare remaining visible rows only during idle time, using strict concurrency and payload-size limits.

On touch devices, where hover does not exist, visible task rows are the important preparation trigger. The task's visible initial context should be compact enough that this does not turn an ordinary Sprint load into an unbounded bulk fetch.

The cache is scoped to the current viewer and project permissions. A prepared payload cannot be reused for a viewer whose authorization has changed.

### Warm-cache opening and fallback behavior

When a task is prepared, opening reads from the local cache and synchronizes the branch animation with already-renderable content.

When someone opens a task before preparation is complete—for example, immediately after the Sprint first loads, from a deep link, or on a slow connection—the product must not introduce a sudden layout jump. The branch still opens smoothly into a stable, intentionally sized inline loading state. That state is placed inside the expanded task context, then replaced in place once the needed initial context arrives.

This fallback protects the interaction but should be rare for normally visible tasks. It must not block the disclosure control, freeze the timeline, or replace the entire Sprint view with a loader.

### Nested file preparation

Initial task preparation is not a reason to fetch unlimited detail:

- Initial task open includes the file summary and a bounded set of current file groups.
- Opening a file group reveals a bounded version list, prepared on file-row intent where possible.
- A large version archive uses independent cursor pagination after the initial versions.
- Initial task open includes only an authorized Task-tab discussion handoff, optionally with a safe count.
- Full discussion history is prepared and paginated only in the Task tab when the reader opens the authoritative conversation.

This makes the first task open feel complete while keeping large Sprint pages responsive and preventing a background request for every historical version or message.

## Cache freshness, updates, and recovery

### Freshness rules

Prepared task context is held in a short-lived, permission-aware cache. On opening, the application can render cached context immediately and revalidate in the background when it is older than the freshness window.

The UI must not collapse a task or clear already useful content merely because a revalidation begins. A subtle refresh state is acceptable only when it communicates a real delay or conflict.

### Mutation and real-time handling

After an authorized mutation, update only the affected cached task group:

- a task edit updates Task details;
- reassignment updates current ownership;
- workflow movement updates the current stage;
- a new attachment updates Files & versions;
- a new version updates its existing file group;
- a new comment may update only an authorized discussion handoff/count.

The reader's expanded/collapsed state and scroll position remain stable. Real-time events and mutation responses are reconciled by durable entity ID plus revision or timestamp, never arrival order. This prevents duplicate file/version rows or an incorrect discussion count when a refetch and a real-time event overlap.

Closing a task retains its prepared context for a short period, so reopening the same task feels immediate. A permission change, project switch, hard invalidation, or stale revision clears/revalidates the relevant cached context safely.

### Error and offline behavior

If a context request fails, leave the task row and the rest of the Sprint fully usable. Display retry within the affected task group rather than replacing the whole Sprint page with an error state.

If a safe cached context is available while offline or temporarily disconnected, it may be shown with a clear stale/offline indication where necessary. Protected data must never be exposed from a cache after permissions are revoked or cannot be confirmed.

## Motion, accessibility, and responsive requirements

- The local branch animates only inside the opened task and begins at its reply/disclosure icon; it does not animate the main Sprint threadline.
- The expanded container reserves or measures its intended space so delayed content does not abruptly increase its height after the opening motion has completed.
- Task details, Files & versions, and the discussion handoff use coordinated entry timing rather than independently appearing late.
- File-version disclosures use the same smaller local-motion pattern and remain visibly nested beneath their file.
- Respect reduced-motion preferences by presenting the same hierarchy immediately or with minimal opacity change rather than spatial expansion.
- All disclosure controls remain real buttons with keyboard support, `aria-expanded`, `aria-controls`, visible focus, and clear accessible labels.
- On mobile, use shallower local indentation and full-row touch targets so opening motion and nesting do not reduce readable text width.
- Deep links to a selected Sprint/task prepare the necessary initial context during route resolution, then open the branch smoothly once the route state is ready.

## Smooth-disclosure scenarios and expected behavior

| Situation | Expected behavior |
| --- | --- |
| Normal visible task | Opens smoothly with prepared task/file context already visible. |
| User opens immediately after Sprint load | Opens smoothly; uses a stable inline loading state only if preparation is unfinished. |
| Slow network | No page-level jump or freeze; retry is local to the affected task/group. |
| No files | Opens immediately to intentional `No files attached yet` content, with an authorized add action. |
| Many files | Shows prepared summary and initial file groups; subsequent groups load progressively. |
| Many versions | Shows current version on task open; older versions load when the file is opened. |
| New file/version while task is open | Updates the affected file group in place without resetting the panel. |
| File removed or deleted | Updates the summary/row clearly and removes actions that would fail. |
| Direct task link | Resolves the Sprint and prepares task context before presenting the open branch. |
| Offline or cache-only state | Shows safe cached context with an intentional freshness/offline state when needed. |
| Reduced-motion preference | Presents the identical hierarchy with minimal/no expansion motion. |
| Permission loss while open | Clears protected cached Files data and removes protected discussion handoff/count while preserving a safe task row. |

## Definition of success for smooth disclosure

The task interaction feels immediate even when the network is not. A user perceives details, current file/version information, and a clear handoff to task discussion as an integrated part of the task they opened—not as content fetched and inserted after the task panel already appeared.

The task's local branch makes ownership clear, the outer Sprint story stays stable, and large histories remain performant because only the useful initial layer is prepared in advance while deeper history loads intentionally on demand.

## Discussion ownership: Task tab is the single source of truth

### Decision

Task discussion must not be duplicated as embedded content in the Sprint timeline. The Task tab is the single home for reading, writing, editing, deleting, moderating, searching, and receiving notifications for task conversation.

The Sprint tab owns the Sprint story: what work entered the Sprint, who owns it now, its current stage, and concise entry points into deeper work. Once it renders full reply threads under multiple tasks, it becomes a second Task tab, consumes too much vertical space, and makes the purpose of each surface unclear.

### Surface ownership

| Surface | Owns | Does not own |
| --- | --- | --- |
| Task tab | Task conversation, reply composition, full reply history, mentions, read state, comment editing/deletion, task activity and complete work context | Sprint-level planning/story presentation |
| Sprint tab | Compact Sprint story, task entry points, current task snapshot, files/version summary, and navigation to deeper task work | Embedded discussion thread, composer, message read state, full comment history, or a duplicate conversation experience |
| Message and notification surfaces | Inbox, notification delivery, broader messaging, and cross-task communication entry points | A duplicate task-detail model |

Comments therefore exist once, under their task. All authorization, retention, editing, deletion, moderation, read-state, notification, and real-time behavior is performed by that one authoritative task discussion rather than copied into the Sprint view.

### Sprint task-context presentation

An opened task in the Sprint tab retains a lightweight, current task snapshot. It does not contain a `Discussion` group that displays reply content.

```text
Task details
Update the related files
Current owner: Rama
Current stage: To Do

Files & versions · 1
ExportButton.test.tsx · Version 2

[Open task]   [Open discussion · 4 replies]
```

`Open discussion · 4 replies` is a navigation action, not an embedded reply section. It opens the exact task in the Task tab with the Discussion area selected. The return path preserves the selected Sprint, task position, and previously opened task context where feasible.

The discussion action is shown only when the current viewer is authorized to access the task conversation. It may use a compact visible-reply count when that count is useful and permission-safe. If no discussion exists, it can read `Open discussion` or remain absent according to the task's collaboration policy.

### What the Sprint tab must not show

The Sprint task expansion must not render:

- individual comments or reply text;
- latest-comment previews;
- a reply composer;
- reply editing, deletion, reactions, mentions, moderation, or notification controls;
- read/unread state; or
- an independently paginated task-conversation history.

Comment previews are deliberately excluded. They can be sensitive, become stale quickly, occupy valuable Sprint space, and still imply that the Sprint tab is a second conversation owner. A compact action/count supplies the appropriate amount of context without duplicating the work surface.

### Discussion lifecycle

1. A task enters a Sprint and receives one compact outer Sprint row.
2. Opening that row shows current task details and Files & versions context only.
3. If conversation is available, the reader sees a compact `Open discussion` handoff, optionally with an authorized reply count.
4. Selecting the handoff routes to the exact task's Discussion area in the Task tab.
5. Comment creation, replies, edits, mentions, deletions, reactions, moderation, read state, and notifications remain exclusively in that Task-tab discussion.
6. Returning to the Sprint restores the reader to the Sprint/task context without copying any conversation content back into the timeline.

### Limited Sprint-level communication signals

The only communication-related signal appropriate in the Sprint tab is a compact, actionable indicator:

- a permission-safe reply count that provides useful collaboration awareness; or
- a structured task state such as `Needs decision` or `Blocked`, when it is stored as task/workflow state rather than inferred from a comment.

These are operating signals, not copied conversation. They must navigate to or be resolved through the authoritative task experience.

### Edge cases

- **No discussion:** show an intentional `Open discussion` action only when task policy allows starting one; otherwise omit it.
- **Viewer lacks access:** omit both the count and action. Do not disclose that protected discussion exists.
- **Discussion becomes unavailable:** retain the task context, remove the stale action/count, and show a safe access state only where necessary.
- **Task is archived/deleted:** discussion follows the Task tab's existing retention and access rules; the Sprint tab never attempts to render copied historical replies.
- **Task moves between Sprints:** the same task discussion remains with the task; it is not recreated or duplicated for another Sprint.
- **Real-time comment activity:** may refresh a safe count/action state in the Sprint cache, but never inserts a comment into the expanded Sprint context.

### Definition of success for discussion ownership

Users understand the division of responsibility without having to think about it: they plan and review work in Sprints, then work and communicate in Tasks. Every task discussion has one authoritative home, while the Sprint tab stays focused, fast, and readable even when many tasks have active conversation.

## Interaction, accessibility, and resilience

- Use real buttons for task and file disclosures, with `aria-expanded`, `aria-controls`, visible focus styling, and descriptive accessible names. The discussion handoff is a clearly labelled navigation action.
- Do not communicate stage, blocked state, completion, or errors by colour alone.
- Prepare the bounded task context before normal task opening; do not delay the outer Sprint list for unbounded file history or task conversation.
- Use pagination/cursors for long task lists and file-version histories; discussion history is paginated only in the Task tab.
- Preserve a readable historical attribution snapshot if a member later renames their profile, leaves the project, or loses visibility.
- When access changes, remove protected file data and any protected discussion handoff/count safely, while leaving the task row functional.
- On context-load failure, show retry inside that task only; do not fail the whole Sprint surface.
- Reconcile real-time updates by durable entity IDs and revision/timestamp rather than arrival order.

## Validation scenarios before delivery

1. Ramanaidu Ch assigns a task to Rama.
2. Rama reassigns the task to another teammate.
3. Task creator, assignment actor, and assignee are three different people.
4. A task is created already assigned.
5. A task is unassigned after previously having an owner.
6. The original actor profile is unavailable after an event is recorded.
7. A task moves between Sprints without gaining a duplicate outer timeline row.
8. A task has no files, many file versions, no discussion, or a long discussion.
9. A viewer loses access while task context is open.
10. Keyboard navigation, screen-reader announcements, narrow mobile screens, deep links, retries, and concurrent updates all retain their intended behavior.

## Documentation alignment required before implementation

The existing Sprint concept document currently recommends showing the Sprint name and tagline in the creation event. This report supersedes that recommendation: the creation event should only show creator attribution, the action, and the timestamp. The header remains the sole presentation of Sprint name and goal.

## Implementation boundary

Any future implementation should use the existing task/sprint records and durable activity events as sources of truth, preserve historical data, and introduce only forward-compatible schema changes if a data gap is proven. The rollout should use the existing feature-flag and release process, with regression coverage for the validation scenarios above.

# Application-wide end-to-end review

## Review scope and evidence

This section records a read-only review of the application as it exists. It covers the principal routes, user-facing product domains, lifecycle code, data and permission boundaries, real-time behavior, operational controls, test inventory, and the current Sprint/task implementation.

The review did not alter product code, production data, migrations, or this product's implemented behavior. It also did not run credentialed browser E2E, a real database migration replay, load tests, or production deployment checks. Those remain required before any production-readiness claim.

### Verified checks

| Check | Result | Meaning |
| --- | --- | --- |
| Typecheck | Pass | The TypeScript compiler accepted the current application snapshot. |
| Production build | Pass | The application compiled successfully for production. |
| Unit tests | Pass: 618 tests / 123 suites | Existing unit-level contracts passed. |
| Page performance contract | Pass: 18 pages / 18 contracts | Route data budgets and declared page behavior pass static validation. |
| Query-key contract | Pass | Query-key ownership and invalidation conventions pass static validation. |
| Runtime-boundary contract | Pass | Request, public-read, active-surface, and worker boundaries pass static validation. |
| Lint | Fail: 143 errors / 60 warnings | The repository-wide quality gate is not green. |
| Authorization contract | Fail | The formal task-mutation project-scope contract is not currently satisfied. |

The application has a meaningful engineering foundation: authenticated and public request paths, viewer-scoped access, real-time boundaries, background workers, migration governance, observability, caching, security controls, and substantial Files-focused coverage. However, the failed lint and authorization gates mean the full release posture is not currently green.

## Immediate release blockers

### Lint gate failure

The repository-wide lint command currently reports 143 errors and 60 warnings. Some failures come from non-product tool, benchmark, and scratch files being included in the product lint scope, including content under `.agents` and scratch directories. That is a configuration-boundary problem.

There are also real application findings which must not be hidden by changing lint scope:

- Files startup logic reads and writes refs during render, which React flags as unsafe.
- Folder-content logic passes ref-derived values during render.
- Global search evaluates `Date.now()` during render, which can make rendering non-deterministic.
- Workspace UI contains invalid unescaped markup.
- Application, worker, and file-action code contains source-level correctness errors such as mutable values that should be constants.
- Messaging and workspace code contains warnings for unused imports, unsafe `any` usage, hook dependencies, and raw image performance behavior.

The intended remediation sequence is:

1. Restrict lint to product, test, and supported service source paths; exclude vendored tools, benchmarks, and disposable scratch material.
2. Fix all real product-source errors without broadly disabling the relevant rules.
3. Treat a zero-error product lint result as a release prerequisite.

### Authorization-contract failure

The authorization contract check currently fails its assertion that task mutations are scoped to the supplied project.

The live task write path locks a task, reads its project, checks that the locked task belongs to the supplied project, and then proceeds in the same transaction. This may be functionally safe, but the formal contract expects an explicit database write scope and no longer recognizes the locking-based implementation.

This is an assurance gap, not an unproven claim of exploitation. Before release, one of the following must happen:

- make project scope explicit in the task mutation query/update boundary; or
- update the formal authorization contract to verify the locking transaction, ownership/membership checks, and project equality checks that actually protect the mutation.

No release should be described as authorization-gate clean until the behavior and contract agree.

## Current Sprint implementation versus the agreed target

The current Sprint implementation remains materially behind the experience defined in this report.

### Current behavior that must change

- The Sprint-created row repeats the Sprint name and goal already shown in the header.
- Creator presentation depends on current profile availability and falls back to `Creator unavailable`; it does not yet use a durable human-readable attribution snapshot.
- Task summary wording is derived from current assignee and task creator, rather than the recorded assignment actor, producing misleading assignment language.
- The outer Sprint connector continues through expanded task content instead of ending at the task row and beginning a separate local task branch.
- Task content is conditionally inserted immediately on open, with no coordinated smooth branch/panel transition.
- Files and versions begin fetching after the task is opened rather than being prepared in advance for normal visible tasks.
- Task expansion currently embeds comment activity in the Sprint tab, despite the Task tab already having an authoritative Comments surface.
- The Sprint context does not provide the agreed `Open task` / `Open discussion` handoff model.
- The selected task and section are not fully represented in Sprint route state, so direct links, browser navigation, notification entry, and return context cannot consistently reopen the precise expanded context.

### Required target behavior

The Sprint tab must implement the product model defined in the preceding sections of this report:

- compact header as the sole owner of Sprint identity and purpose;
- compact creator/date-only event;
- one task row per historical origin task;
- local task branch from the reply/disclosure icon only;
- prepared, smooth opening with bounded current task/file context;
- file/version hierarchy nested under the task and file identity;
- no embedded task discussion; only an authorized Task-tab handoff; and
- deep-linkable Sprint, task, and section context.

## Sprint history integrity gap

The present Sprint read model selects tasks by their current `tasks.sprint_id`. A task that is moved to another Sprint therefore disappears from its original Sprint and appears in the new one.

That conflicts with the agreed historical lifecycle. A task belongs to one permanent outer Sprint story: the Sprint where it was first created or first added. Current Sprint membership is still mutable for operational task boards, but it must not rewrite historical Sprint narrative.

The existing task schema does not yet hold an immutable task-origin Sprint reference and origin timestamp. Task activity records track some move events, but the current Sprint timeline query does not construct its story from immutable origin attribution.

Before the visual redesign, introduce and validate a forward-compatible origin model:

- `timeline_origin_sprint_id` — immutable first Sprint attribution;
- `timeline_origin_at` — immutable timestamp for the outer task row;
- deterministic legacy backfill policy;
- race-safe create/add/move behavior that cannot create two origins;
- current `sprint_id` retained only as mutable operational placement.

The outer Sprint timeline then reads origin attribution. Current task boards and planning controls continue to read current placement.

## Discussion ownership gap

The Task tab already provides a dedicated task discussion system with comments, replies, pagination, likes, mentions, edits/deletions, task-scoped access checks, and activity behavior. The Sprint task expansion separately filters comment activity and renders it beneath the task.

This duplicates a collaboration surface and risks divergence in access, notification, read state, deletion, pagination, preview safety, and real-time behavior.

The authoritative ownership decision is:

```text
Sprint tab: task context + [Open discussion · authorized count]
Task tab: authoritative complete discussion
```

The Sprint view must not render reply text, latest-comment previews, a composer, full thread history, editing/deletion/reaction controls, read state, or independently paginated discussion. It may show an authorized count/action and structured task state such as `Blocked` or `Needs decision`; selecting it opens the Task tab directly to its Comments section.

## Cross-tab navigation and return-context gap

The application has rich URL state across Files, Tasks, Docs, Updates, and Sprints, but it needs one consistent context contract. Every cross-surface journey should preserve project, surface, entity, optional section, and return context.

```text
project → surface/tab → entity → optional sub-section → return context
```

Required examples:

- Sprint task to Task details: `?tab=tasks&drawerType=task&drawerId=<task>&panelTab=details`
- Sprint task to Task discussion: `?tab=tasks&drawerType=task&drawerId=<task>&panelTab=comments`
- Sprint task to Files: `?tab=files&fileId=<file>&from=sprint`
- Direct Sprint task link: `?tab=sprints&sprintId=<sprint>&taskId=<task>&section=files`

The target must preserve selected Sprint, selected task, task section, and reader position where feasible after a cross-tab handoff or browser Back action. Direct notification links must resolve safely if the entity is deleted, moved, no longer visible, or the viewer has lost permission.

## Application lifecycle register required

The app contains many strong feature-level lifecycles, but it needs one product-level lifecycle register that defines source of truth, state transitions, permissions, notifications, retention, recovery, and cross-surface ownership for each major entity.

| Entity | Required lifecycle |
| --- | --- |
| Identity | Sign up → verify → onboard → active → security recovery → deactivate/delete. |
| Workspace membership | Invite/request → accepted → active role → role change → removed/withdrawn. |
| Project | Draft/create → private or discoverable → active lifecycle stages → complete/archive → delete/recovery policy. |
| Sprint | Plan → active → complete/cancel → archive, with creator attribution and immutable task-origin story. |
| Task | Create → assign/unassign → active/blocked/done → archive/delete/restore, with current owner separate from creator and assignment actor. |
| File | Upload/link → version → attach/detach → trash → restore → permitted purge. |
| Task discussion | Create/reply/edit/delete or tombstone → mention/notify → retention, with one Task-tab owner. |
| Docs | Draft → collaborate → publish → revise → archive/recover. |
| Messages | Draft/active/archive → send/edit/delete → delivery/read state → notification preference. |
| Integration/import | Connect → validate → preview → authorize → worker import → reconcile → retry/rollback/disconnect. |
| Privacy | Visibility change → viewer-scoped rendering → audit where required → account deletion cleanup. |

Every user-facing surface should answer the same four questions:

1. What is the authoritative entity and owning surface?
2. What can this viewer read or mutate?
3. What happens if the action fails, conflicts, is retried, or is reversed?
4. Where does the user go next without losing context?

## Product-wide experience improvements

### Shared tab standard

Each project tab should follow a shared interaction standard:

- compact orientation header;
- named owner for each type of information;
- predictable empty, loading, error, and retry states;
- complete URL/deep-link state;
- local rather than whole-page refresh after mutation;
- return context after cross-tab movement; and
- a clear permission explanation when an action is unavailable.

### Error and recovery behavior

The existing project tab error boundary isolates tab failures and emits sanitized telemetry. However, it currently renders the raw error message to the end user. Replace it with safe, human-readable product copy while retaining diagnostic detail only in telemetry.

For each major mutation, define the same recovery contract:

- optimistic state, where safe;
- conflict/version detection;
- retry path;
- rollback or server reconciliation;
- offline/stale-cache behavior;
- permission loss while open; and
- deletion, archive, restore, and retention behavior.

### Accessibility and quality system

There is no evident application-wide visual-regression or automated accessibility suite covering the primary routes. Before broad UI changes, provide coverage for:

- keyboard-only workflows;
- screen-reader labels, focus, and state announcements;
- reduced motion;
- responsive narrow-screen behavior;
- colour and contrast states;
- error/retry focus restoration; and
- deep-link opening and browser-back behavior.

## Test and verification gaps

The unit suite is strong, particularly around the Files experience. End-to-end coverage is less even across the application.

The project-tabs E2E matrix confirms that the Sprint tab renders, but no dedicated Sprint E2E specification currently exercises the complete Sprint lifecycle. Required coverage includes:

1. Create, edit, complete, and delete a Sprint.
2. Create or add a task to a Sprint.
3. Move a task between Sprints while preserving its immutable origin story.
4. Verify creator, assignment actor, and assignee when all are different people.
5. Open an expanded task with local branch motion and prepared file/version context.
6. Update a file or version while the task context is open.
7. Hand off from Sprint to the Task-tab discussion and return safely.
8. Verify owner, member, viewer, and public-visitor permissions.
9. Verify keyboard, reduced-motion, and narrow-screen behavior.
10. Verify reconnect, conflict, retry, unavailable file, deleted task, and permission-loss behavior.

Credentialed browser E2E, real migration replay, load, RLS, live-lineage, security evidence, and production-rollout checks remain separate requirements for a release claim.

## Engineering structure risks

Several modules are large enough to slow future change and weaken review confidence:

- `src/app/actions/project/_all.ts` — approximately 8,625 lines.
- `src/app/actions/messaging/_all.ts` — approximately 4,137 lines.
- `src/components/projects/tabs/ProjectSettingsTab.tsx` — approximately 4,501 lines.
- `src/components/projects/tabs/UpdatesTab.tsx` — approximately 2,594 lines.

Do not split merely by file length. Split by durable ownership and narrow contracts:

- project lifecycle and membership;
- Sprint planning/history;
- task workflow/assignment;
- project settings/governance;
- update feed;
- messaging and notifications.

Each resulting domain should have one canonical authorization path, one data contract, clear cache ownership, explicit real-time reconciliation, and focused tests.

## Delivery order

1. Restore a green release baseline: product lint and authorization-contract checks.
2. Adopt the application lifecycle register and explicit ownership rules.
3. Establish the Sprint data foundation: immutable task origin and safe creator-attribution snapshots.
4. Implement the agreed Sprint experience: compact creator event, correct task semantics, local branch, prepared smooth task context, nested files/versions, and Task-tab discussion handoff.
5. Standardize cross-tab deep links and return-context behavior.
6. Add Sprint lifecycle, role/permission, accessibility, responsive, conflict, recovery, and real-time E2E coverage.
7. Decompose large domain modules while preserving public behavior contracts.
8. Run the complete release, database-lineage, security, load, and production-rollout gates against appropriate disposable or staging environments.

## End-to-end review conclusion

The application is architecturally ambitious and has a sound base of contracts, tests, and operational boundaries. The next step is not more isolated UI work. It is to make entity ownership, lifecycle history, cross-tab navigation, resilience, and release evidence consistent across the entire product.

The Sprint work is a useful proving ground for that discipline: it touches task ownership, file lineage, discussion ownership, real-time freshness, access control, cross-tab navigation, responsive interaction, audit history, and performance. Completing it to the standard in this report establishes a reusable pattern for the rest of the application.
