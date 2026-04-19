# Task panel: Files & Mentions

Reference for the contracts that drive the Task panel's Files and Comments
tabs after the Wave 1-4 overhaul. Living document — update when the schema or
the resolver branches change.

---

## 1. File re-upload decision tree

When a file (or folder) is dropped onto a task's Files tab, the resolver in
`src/lib/projects/task-file-intelligence.ts` (`resolveTaskFileIntent`) maps
the candidate to one of a fixed set of intents. The Files tab modal renders a
choice for the user; `useTaskFileMutations` then routes the chosen intent to
the matching server action.

```
                   drop one or more files / folders
                                |
                                v
       +-----------------------------------------------+
       |  for each candidate, compute SHA-256 +        |
       |  match against existing project_nodes /       |
       |  task_node_links by name + path + hash        |
       +-----------------------------------------------+
                                |
                                v
       Candidate type?
       |
       +---- file ----+
       |              |
       |              v
       |   No name match in project ............ attach_new
       |   Name match, NOT linked to task ...... attach_existing
       |   Name match, linked, hash equal ...... no-op (toast: "no changes")
       |   Name match, linked, hash differs .... replace_existing            (default: save as new version)
       |   Name match inside a linked folder ... candidate_child_of_linked_folder
       |   Multiple matches ................... ambiguous (user disambiguates)
       |
       +---- folder --+
                      |
                      v
          Folder name not present .............. attach_new           (folder + children attached fresh)
          Folder name present, linked .......... folder_replace_existing  OR  folder_merge_into_existing
          Folder name present, NOT linked ...... folder_create_subfolder  (link as sibling/child)
          Children mostly match a linked folder. folder_merge_into_existing  (per-child file rules apply)
```

Hashes are computed client-side via WebCrypto (`src/lib/files/content-hash.ts`)
before the upload starts, so the resolver can short-circuit no-op uploads
without burning an S3 round-trip.

When the resolver picks `replace_existing` (or the user confirms `Save as new
version`), the action calls `replaceNodeWithNewVersion`
(`src/app/actions/files/versions.ts`) which:

1. Inserts the new blob into S3.
2. Inserts a `file_versions` row.
3. Bumps `project_nodes.current_version`.
4. Leaves the old blob untouched (history retention).

The Version History drawer reads `file_versions` ordered by
`(node_id, version DESC)` and offers download + restore.

---

## 2. Open-in-IDE round-trip

Browsers can't hand a local file to an IDE directly. The closed loop:

1. User clicks a file row -> chooser menu (`OpenInIdeMenu.tsx`):
   - `Open in Cursor` / `Open in VS Code` -> protocol-handler launch.
   - `Open in Workspace` -> internal Monaco editor (basic-editing scoped).
   - `Download` -> plain signed URL.
2. For an IDE option, the client:
   - Streams bytes from the signed URL.
   - Computes SHA-256.
   - Saves to `~/Downloads/NB-Workspace/<projectSlug>/<filename>`.
   - Writes an `openFileSessions` record to IndexedDB
     (`{ nodeId, filename, originalHash, openedAt, localPath, ide }`).
   - Navigates `window.location.href = "<ide>://file/<absolutePath>"`.
3. User edits + saves locally; drags the file back onto the Files tab drop
   zone.
4. Client computes SHA-256 of the dropped file and looks up the IDB session
   by `filename`:
   - Hashes match -> toast `"No changes since open"`.
   - Hashes differ -> dialog `"Save as new version of <NodeName>?"` with
     options `{Save as new version, Attach as new file, Cancel}`.
   - No matching session but filename matches a linked file -> falls through
     to `resolveTaskFileIntent` (Section 1) with hash dedup as the
     recommended branch.

If the protocol handler silently fails (no IDE installed), the file is still
on disk so the user can open it manually. The username component of the path
is captured once via prompt and cached in `localStorage` (`nb.user`).

---

## 3. Comment mention token format

Mentions inside `task_comments.content` are stored inline as tokens of the
shape:

```
@{<userId>|<DisplayName>}
```

Where:

- `<userId>` is a lowercase canonical UUID v4.
- `<DisplayName>` is 1-120 characters from `[^@{}|\n]` — the closing `}` is
  the unambiguous terminator, so multi-word display names are safe.
- The full grammar lives in `src/lib/projects/mention-tokens.ts`
  (`MENTION_TOKEN_RE`).

Authoritative helpers (server, composer, and renderer all import these — do
not write a parallel parser):

- `parseMentions(raw)` -> `{ plainText, mentionIds, segments }`. Never
  throws; unknown tokens fall through as plain text. This means pre-mention
  comments continue to render unchanged.
- `buildMentionToken({ userId, displayName })` -> emits a parse-roundtrippable
  token. Throws on invalid `userId` (loud failure beats silent skip).
- `sanitizeMentionDisplayName(raw)` -> strips `{`, `}`, `|`, `@`, collapses
  whitespace, and truncates to 120 characters.
- `serializeSegments(segments)` -> the inverse of `parseMentions`, used by
  the contentEditable composer when serializing its DOM.

### Round-trip example

```
raw      : "hi @{11111111-1111-4111-8111-111111111111|Alice Smith} take a look"
parse    : { plainText: "hi @Alice Smith take a look",
             mentionIds: ["11111111-1111-4111-8111-111111111111"],
             segments:   [text "hi ", mention(...Alice Smith), text " take a look"] }
serialize: identical to `raw`
```

### Why tokens-in-content (not a sidecar JSON document)

- Pre-mention comments render as plain text with zero migration.
- Renderers never need to join back to `profiles`: the display name is
  carried in the token. A user renaming themselves later does not retro-edit
  past chips (Slack / Linear semantics).
- The durable index for inbox + fan-out queries is the
  `comment_mentions(comment_id, mentioned_user_id)` table, written by
  `createTaskCommentAction` alongside the comment.

### Validation on the write path

`createTaskCommentAction` (`src/app/actions/task-comment.ts`) extracts mention
ids from the parsed token list and intersects them with
`{owner} ∪ project_members(projectId)`. Strangers can never be ping-mentioned
even if a hand-crafted payload smuggles their UUID through the token.

### Notification fan-out

`enqueueTaskCommentMentionNotifications`
(`src/lib/notifications/task-comment-mention.ts`) is currently a
structured-logger stub: it filters self-mentions + duplicates, logs one line
per recipient via the canonical logger keys (`viewerUserId` = author,
`subjectUserId` = recipient), and never throws. The durable projection is the
`comment_mentions` rows themselves; when the real notification queue lands,
the stub is the single integration point to swap.

---

## 4. Schema additions

Recap of the four migrations (Wave 1):

| Migration | Adds | Why |
|-----------|------|-----|
| `0068_file_versions.sql` | `file_versions` table + indexes + RLS | Version history for retained-blob lifecycle |
| `0069_project_nodes_current_version.sql` | `project_nodes.current_version int NOT NULL` | Render current version inline on file rows |
| `0070_comment_mentions.sql` | `comment_mentions` table + indexes + RLS | Indexed projection for notification fan-out |
| `0071_realtime_publication_extension.sql` | adds `file_versions` + `comment_mentions` to `supabase_realtime` | Live update of version pills + mention chips |

Backfill: existing files get an implicit `version=1` row via the migration;
the `content_hash` column is populated lazily on next upload, or by
`scripts/backfill-file-hashes.ts` for an immediate sweep.

---

## 5. Test coverage

| Surface | Test |
|---------|------|
| Token parse / build / round-trip | `tests/unit/mention-tokens.test.ts` |
| Resolver branches (file + folder + hash dedup) | `tests/unit/task-file-intelligence.test.ts` |
| Open-in-IDE + reupload (mocked protocol) | `tests/e2e/task-panel-ide-reupload-smoke.spec.ts` |
| Mention autocomplete + fan-out | `tests/e2e/task-panel-mentions-smoke.spec.ts` |

---

## 6. Explicit non-scope (tracked for follow-ups)

- Edit-own-comment (trivial extension, deferred — needs `editedAt` column +
  pencil affordance).
- Rich-text / markdown comments.
- Attaching files inside comment bubbles.
- Version-scoped comments ("comment on v3").
- Live multi-user Monaco editing.
- Replacing the notification stub with the real queue (single swap point in
  `task-comment-mention.ts`).
