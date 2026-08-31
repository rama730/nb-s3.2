# Project guidance co-leader

## Conclusion

A Guide is an optional named project co-leader. “Guide” is only a display label: a project may instead use Advisor, Mentor, Counselor, Guide Counsellor, or another plain-text name.

The appointment does not create a new permission system, project tab, group, or message card. When the person accepts, they receive the existing Co-leader/admin membership, can view and work throughout the normal project, and are added to the existing project group. The appointment record only identifies them as the visible guidance contact and controls its label and lifecycle.

The existing project-invite application card in messages remains exactly as it is. A guidance invitation uses the current card and its existing Accept/Decline behavior; the chosen label is supplied through the existing role-title content rather than a new card layout or action.

## 1. Core model and authority

A project has zero or one active guidance appointment. It works normally without one.

| Person | Authority |
| --- | --- |
| Project Lead / Owner | Owns the project, transfers ownership, archives/deletes, and controls the appointment. |
| Named guidance co-leader | The visible guidance contact; has existing Co-leader/admin operating capability. |
| Co-leader | Existing elevated project capability. |
| Member / Viewer | Existing contribution or read-focused capability. |

The named person appears above ordinary Co-leaders in presentation and is protected from unilateral change by other team members. This is not a hidden permission level: they use the same existing admin capabilities to create tasks, screens, documents, files, updates, and other normal project work.

Members and Co-leaders may propose that a project needs a Guide and may raise concerns with the Lead. Only the Lead creates, renames, ends, or replaces the appointment. The Lead remains accountable for unresolved decisions.

## 2. Label, display, and portfolio

The label is safe, length-limited plain text. It never changes permissions, ownership, search, capacity, routes, database roles, or notification rules.

Use a consistent project header pattern:

`Project title · Advisor: Asha Patel · Created by Noah · Status`

When the chosen label is exactly **Guide**, the header may say `Guided by Asha Patel`. The Team area shows Lead and named person first in a **Project Leadership** group. If no appointment is active, show no label.

Public attribution requires the appointed person’s consent; private projects show it only to authorized viewers. A label rename changes visible attribution and writes a project activity entry, but does not change access.

Portfolio attribution is separate from hands-on contribution. Guidance appointments are shown using their chosen label, do not imply a delivery role, respect public consent, and are separated from ordinary project contributions. To prevent a large guidance portfolio becoming chaotic, show active and recent appointments first with a bounded public list; retain the full authorized history privately.

## 3. One invitation system with two entry points

There is one invitation system with two ways to start it:

| Entry point | Known context | Next selection |
| --- | --- | --- |
| Candidate Profile → **Invite to** | Candidate | Project |
| Project Team card → **Invite** | Project | Candidate |

Both routes use the same durable invitation, validation, status, acceptance/decline behavior, notifications, activity history, membership outcome, and cancellation behavior. They are not separate systems.

Ordinary open-role invitations may be sent by a Lead or Co-leader when project policy allows. A guidance appointment is always Lead-only. An **invitation** is Lead-initiated; an **application** is candidate-initiated.

The shared flow is:

1. The user opens **Invite to** from a candidate profile or **Invite** from the project Team card.
2. The composer resolves the missing project or candidate context.
3. The inviter chooses one type: ordinary open role or guidance appointment.
4. The invitation is created and delivered through the existing inbox and, when permitted, the existing message UI.
5. The candidate accepts or declines.
6. Acceptance rechecks all current conditions, then updates membership, group access, and appointment state atomically.

## 4. Composer and existing message card

### One recruitment composer surface

The existing **Invite Collaborator** module is the single visual surface for recruitment. It is reused from the Team card, a candidate profile, a project application, and a profile-started application. The entry point supplies the context it already knows, so the composer asks only for the missing project, candidate, or role.

The shared shell keeps the same header, step structure, selection controls, loading/empty states, accessibility behavior, and final confirmation. Its action remains explicit: **Send Invitation** for a Lead-initiated invitation and **Submit Application** for a candidate-initiated application. The application retains its fit statement, quick prompts, optional portfolio/GitHub, and availability fields.

The composer loads the initial connected-people list once and only performs wider people search after two characters. It caches project options during the open session, discards stale search responses, and records aggregate latency and result-count metrics without recording search terms. Application drafts are private to the signed-in user and selected project, expire after seven days, and are cleared on successful submission. Retry keys use browser-native SHA-256 where available; final authorization, role availability, privacy, duplicate, Guide, and capacity checks remain server-authoritative.

When a Lead chooses the Guide appointment, the composer performs a small Lead-only preflight using the existing appointment record. It can show an active appointment or a capacity warning before send, but the durable invitation command rechecks both conditions transactionally.

This is one interaction surface, not one business record: invitations continue through the durable invitation command, while applications continue through the existing application command and review queue. This prevents the UI from creating duplicate systems or blurring who must make the next decision.

### Ordinary role invitation

From a profile, the composer starts with a Project selector and then loads available roles. From the Team card, the project is already selected; after choosing a candidate, the same role selector and note are shown.

### Guidance appointment

A guidance appointment is a distinct choice in the same composer, never an ordinary open role. The Lead enters the display label, optional review date, and note. The label may be Guide, Advisor, Mentor, Counselor, or another suitable name.

Only one invitation type is active at a time. The candidate sees the project name and visibility, Lead name, chosen label or ordinary role, note, access outcome, optional review date, and active appointment count before accepting.

### Existing message application card

Do not create or redesign a Guide card. When messaging is allowed, render the existing `project_invite` application card exactly as it works today:

- existing project title, role-title, note, pending state, and Accept/Decline actions;
- chosen guidance label supplied through the existing role-title content;
- existing accepted, declined, cancelled, and expired presentation; and
- no new buttons, layout, or guide-specific message behavior.

The durable invitation remains the source of truth. The message card is an existing presentation and action surface for that invitation.

When direct messaging is not permitted, the durable invitation appears in the existing **Applications** inbox as a generic project invitation fallback. It exposes the same Accept and Decline transitions without introducing a Guide-specific message card or a separate inbox.

## 5. Team-card candidate search

The Team-card modal starts with the first bounded page of eligible connections, preserving the familiar current flow. One field reads **Search connections or people**.

- Empty query shows eligible connections.
- A query of two or more characters, or an `@username` query, searches eligible people across the application.
- Exact usernames rank first, followed by name-prefix and fuzzy matches.
- Selecting a candidate stops search and reveals the role or appointment fields.

Search is server-side, debounced by about 250–300 ms, cancelable, cursor-paginated, and rate-limited through existing infrastructure. It returns only the profile card and candidate state needed for selection. Existing name and username indexes are reused; no separate search service is required.

Candidate/role alignment is optional and lazy: fetch it only after both candidate and ordinary role are selected. It never blocks an otherwise eligible invitation.

| Candidate state | Behavior |
| --- | --- |
| Eligible | Selectable and inviteable. |
| Already a member | Show status; do not invite again. |
| Ordinary invitation pending | Show it; the Lead may cancel it. To change content, cancel and resend. |
| Application pending | Show **Review application**; never approve it by sending an invitation. |
| Role full | Disable the ordinary role with an explanation. |
| Privacy, block, or account restriction | Omit from results; do not disclose the reason. |
| No results | Keep the query and show a concise empty state. |

The result list supports keyboard selection, loading and empty-state announcements, and a clear **Change candidate** action. Search analytics record aggregate latency and outcomes, not raw names or usernames.

## 6. Acceptance, project access, and group membership

Before acceptance, the candidate receives enough invitation information to decide but does not receive private project access.

When a guidance invitation is accepted, one transaction must:

1. Lock the pending invitation and project.
2. Confirm the invitation is unexpired and the candidate is not the current Owner.
3. Recheck project status, Lead authority, privacy/account eligibility, membership, and appointment capacity.
4. Create or promote the candidate’s existing project membership to `admin`/Co-leader.
5. Activate the guidance appointment and record the candidate’s previous membership role.
6. Synchronize the candidate into the existing project group conversation.
7. Write the existing project activity/audit event and resolve the invitation.

After commit, the person can open the normal project and its existing details, tasks, screens, documents, files, updates, analytics, and project group. The system then sends best-effort inbox, push, browser, and optional DM delivery.

If project-group synchronization cannot complete, the transaction fails. The application must never report an accepted appointment while the person lacks the corresponding project-group membership.

An ordinary invitation follows the same durable invitation and group-membership path but creates normal member access and consumes an open-role seat only when applicable.

## 7. Lifecycle and continuity

`None → Pending → Active → Ended / Revoked`

`Pending → Declined / Cancelled / Expired`

An invitation expires after 14 days unless accepted, declined, or cancelled first. Store a real expiration timestamp and enforce it during read, send, and acceptance checks. A Lead cancels a pending invitation; any changed role, label, or note requires a new invitation.

The appointed person may step down. Replacement is sequential in version one:

`Lead ends appointment → chooses restoration outcome → sends new appointment invitation`

There is no hidden overlap, co-guidance queue, automatic replacement, probation, or renewal state. The review date is a reminder only; inaction keeps the appointment active.

Ending an appointment is not automatically removing a collaborator. Run the existing collaborator-impact check for assignments, created work, reviews, applications, files/documents, and group participation. The Lead chooses to restore the prior role, keep the person as Co-leader or Member, remove them, or reassign affected work.

If they remain a project member or Co-leader, they remain in the existing project group. If the Lead removes them through the existing collaborator lifecycle, that lifecycle removes them from the project group.

Archiving ends the appointment. Deleted, deactivated, blocked, or suspended accounts lose project access and trigger a Lead notification. An active appointment survives ownership transfer; the new Lead manages it and may cancel pending appointment invitations.

## 8. Notifications and capacity

Do not build a separate notification workspace. Add a derived **Guidance** filter/group in the existing notification experience for projects where a person has an active appointment.

| Delivery | Events |
| --- | --- |
| Immediate | Direct assignments, direct mentions, urgent blockers, security/access events, appointment changes. |
| Grouped or digest | Routine edits, ordinary updates, non-critical uploads. |

Existing project overrides, quiet hours, mutes, channels, and deduplication remain authoritative. Do not notify someone about their own routine action. When an appointment ends, future activity from that project no longer appears in Guidance.

Capacity counts active appointments only. Warn at 10 and block activation above 12. Recheck the count inside acceptance; do not use a mutable counter or workload-scoring model in version one.

## 9. Minimal technical design

Reuse existing systems:

- existing `project_members.role = admin` for Co-leader permissions;
- existing collaborator lifecycle for membership and project-group synchronization;
- existing People/Connections search indexes and privacy handling;
- existing project activity/audit history; and
- existing notification infrastructure and preferences.

Add only:

1. One durable `project_invitations` record: project, inviter, candidate, invitation type, immutable ordinary-role or guidance-label snapshot, note, status, expiration, idempotency key, and optional delivery references.
2. One narrow `project_guidance_appointments` record: project, person, label, status, accepted/ended dates, optional review date, public-attribution consent, previous membership role, and end details.
3. Database constraints: one pending ordinary invitation per candidate/project; one pending or active appointment per project; and no current Owner as appointee.
4. One shared server command that owns authorization, eligibility, duplicate prevention, state transitions, and atomic writes.

The UI is never authoritative. A client idempotency key makes double-clicks, reconnects, and retries return the original pending invitation rather than create duplicates. Delivery is best effort and cannot undo a valid invitation or acceptance.

## 10. Rollout, verification, and non-goals

Introduce the durable invitation path behind one feature flag. New sends use the shared command; existing pending message-bound invitations are migrated once or handled through a temporary compatibility adapter. Keep a kill switch for new sends while allowing already-created invitations to be viewed and resolved.

Measure search latency and zero-result rate, invitation failures, idempotency conflicts, acceptance failure reasons, notification retry rate, active appointment counts, notification volume, and early appointment endings. Do not retain raw search terms in analytics.

Test both entry points against the same invitation command, plus non-connected candidates, privacy/block restrictions, application-pending behavior, duplicate sends, concurrent acceptance, role and appointment capacity, message-delivery failure, expiry, ownership transfer, group synchronization, step-down, and prior-role restoration.

Do not add a Guide tab, Guide-specific project details page, Guide group, new message-card component, designation-specific permission matrix, separate search service, general-purpose invitation framework, invitation editing, weighted capacity scoring, multiple active appointees, separate notification workspace, or automatic review-date removal unless measured use demonstrates a real need.

The final implementation principle is:

`One durable invitation command + one narrow appointment record + existing Co-leader/admin permissions + existing search indexes + existing activity history + existing notification and group infrastructure.`

## 11. Implementation mapping and verification

The implementation follows the principle above without adding a Guide tab, a new role, a new project group, or a replacement for the current message application card.

| Report requirement | Implemented through |
| --- | --- |
| Durable invitation and one-active-guide constraints | `project_invitations` and `project_guidance_appointments` migration, indexes, partial unique constraints, database checks, and read-only row-level security policies. |
| Shared profile, Team-card, and application flow | The existing Invite Collaborator component is the one recruitment composer: profile and Team-card invitations use invitation mode, while project and profile applications use application mode. The existing invitation and application server commands remain separate. |
| Lead-only appointment authority | Server-side owner checks for creation, rename, replacement, end, and archive; the composer hides the guidance option for Co-leaders. |
| Existing authority and full project use | Existing `project_members.role = admin`, so accepted appointees use normal Co-leader permissions across tasks, screens, files, documents, updates, and the project workspace. |
| Existing project group membership | Existing collaborator lifecycle performs group synchronization in the acceptance transaction. A failed synchronization rolls back acceptance. |
| Existing message card | The existing `project_invite` card receives the durable invitation id and chosen label in its existing role-title field; its UI and actions are not redesigned. |
| Delivery-restricted candidates | The durable record and notification are created independently of DM delivery; the existing Applications inbox provides the fallback accept/decline surface. |
| Search, privacy, and pending application handling | The Team-card server search begins with connections, searches eligible public people after two characters, uses existing privacy/block resolution and rate limiting, ranks exact usernames first, and returns application-pending as **Review application** rather than approving it. |
| Label and hierarchy | The project header shows `Guided by` for the exact label Guide or the chosen label otherwise. The Team card promotes the Lead and appointed person into Project Leadership. |
| Lifecycle, capacity, and archive | Fourteen-day expiry is enforced on send, inbox read, and acceptance; capacity warns at 10 and blocks at 12; ending reuses the existing collaborator role/removal lifecycle; archive ends an active appointment atomically. |
| Attribution and audit | Attribution consent is stored with the appointment; public display requires both consent and a public project, while private-project attribution stays limited to project participants. Activation, rename, end, and archive write project activity events. |

Verification completed for this implementation:

- migration journal validation passed;
- migration source validation passed for all 143 migrations;
- the Ponytail database-hardening cross-project access check passed;
- the focused Guidance capacity test passed as part of the unit suite; and
- type checking reported no errors in the Guide implementation paths. The repository retains unrelated existing type errors in the messaging realtime/cache files, which are outside this concept change.
