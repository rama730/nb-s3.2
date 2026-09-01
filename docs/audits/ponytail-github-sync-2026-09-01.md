# Reviewed GitHub Sync — implementation and verification

## Implemented

- GitHub Sync is a Files collection beside Project files, Task files, and Deliverables. It owns the main content area; the former nested GitHub drawers are removed. Desktop and mobile use the same workspace.
- Connect an existing repository/branch or prepare creation of a personal/organization repository. New repositories default to private and are only created at final confirmation. Organization creation depends on the user's GitHub permissions.
- Compare both directions against a per-repository, per-branch, per-path baseline. Select eligible additions/edits together; explicitly select deletions and resolve conflicts. Review retained content snapshots before executing.
- Existing repositories default to a separate branch and pull request. Direct commits are explicit. Publication uses native Git, a pinned parent commit, verified content hashes, fast-forward-only push, and remote SHA verification. It never force-pushes, auto-merges, or bypasses branch protection.
- Pulls use canonical file leases/revisions, immutable content, task-link-preserving file IDs, and transactional per-file checkpoints. Unambiguous unchanged-content renames preserve the file ID. Incoming deletions go to Trash. Ambiguous/edited renames are reviewed as additions/deletions/conflicts, not guessed.
- Durable review/queue/run records retain progress and remote side-effect identities for retry. Connection revisions, local revision/path/content checks, worker fencing, and fixed remote identities reject stale reviews. Repository creation and PR creation are recovered by recorded operation identity rather than blindly replayed.
- Signed webhooks record incoming-change hints and known PR-close/merge results. They cannot automatically pull over local work. Configure both `push` and `pull_request` events.
- Content contributions are recorded at the `file_versions` persistence boundary, including active-version edits. Metadata-only changes do not create contribution events. Existing local version evidence is retained; GitHub imports are not credited to the importer.
- The workspace contributor card shows actual editors with Edge profiles where linked, and GitHub profiles for external authors. Existing profile contribution cards expose file contribution counts within their existing visibility rules. Membership and repository access are never automatically granted.
- Each editor approves their own GitHub-associated commit email/noreply identity. A single editor is the commit author; multiple approved editors receive co-author trailers. Publisher identity is kept separate. Unlinked editors remain credited in Edge without inventing a GitHub identity.
- The new tables are server-only under RLS. Tokens are sealed, expiry-bounded, and not returned to the browser. Completed/cancelled snapshots are cleaned after seven days only when no live node or revision references them.

## Macro flow

```text
Files collections              Main content
Project files                  GitHub Sync
Task files                     Account / self-approved author identity
Deliverables                   Existing repository | Create private repository
GitHub Sync ←                   Repository + branch + Push / Pull
Recent                         Compare → Select → Resolve → Review → Confirm
Starred                        Operation history / recovery
Trash                          Actual contributors and linked profiles

Push: reviewed snapshot → separate branch + PR OR direct commit → verify SHA
Pull: reviewed GitHub SHA → canonical revisions / Trash → checkpoint → refresh Files
Webhook: incoming hint or PR result → no automatic workspace overwrite
```

## Safety boundaries and current limits

- Project owners configure/execute sync; project members can view their contribution context and approve their own identity. Public viewers do not receive sync controls or private contributor activity.
- Project files are eligible. Private task-system files, task-only nodes, aliases, Trash, credentials, generated/dependency paths, symlinks, submodules, and Git LFS pointers are excluded or rejected. Linked task references to an eligible canonical project file remain intact.
- Current bounded operation: 500 compared paths, 10 MB/file, 64 MB repository workspace/operation, 30,000 metadata entries. Larger repositories require a dedicated Git client/streaming worker extension; they fail explicitly, never silently truncate.
- Incoming author discovery is bounded to 100 path-history commits and 2,000 commits per baseline comparison. It filters out pre-baseline authors; initial imports record the latest attributable author. Stored provenance explicitly says history is incomplete. It is not a reconstruction of all historical edits or co-authors.
- A GitHub commit is not equivalent to every team member appearing in every GitHub contributor UI. Attribution, associated email, target/default branch, merge state, privacy, and GitHub's aggregation rules matter. No non-contributor is credited merely because they belong to the team. See [GitHub contribution reference](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference) and [repository contributor graphs](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-a-projects-contributors).
- Pull is checkpointed per file, not falsely presented as an all-files atomic GitHub/database transaction. Interrupted operations retain applied paths. A later conflict requires a fresh comparison without deleting earlier revision history.

## Deployment

`0161_reviewed_github_sync.sql` was verified in a rollback-only database transaction and applied to the configured application database. Existing files and GitHub repositories were not modified by deployment.

The application migration ledger only records through 0149, while newer Files changes already exist in the working application. To avoid replaying unrelated historical migrations, the narrowly scoped deploy script applies **only 0161**, validates its checksum/status, and records that migration in the existing journal. It does not fabricate entries for earlier migrations.

```sh
node --env-file=.env.local scripts/deploy-reviewed-github-sync.mjs --verify
node --env-file=.env.local scripts/deploy-reviewed-github-sync.mjs --apply
```

Runtime prerequisites:

1. Serve the updated Next.js application and register the updated Inngest functions (`git-push`, `git-pull`, `git-sync-recovery`). The worker needs native Git, temporary disk, and enough execution time; do not deploy this worker in an Edge runtime.
2. Retain the existing signing/encryption secrets, storage service access, Inngest event/signing configuration, and GitHub OAuth provider. Account linking uses the existing Supabase OAuth callback and requires manual identity linking to be enabled for linking a new provider.
3. Authorize the intended GitHub account. Repository selection/creation requires its own OAuth authorization; a globally installed GitHub App is not proof that a user can connect every repository accessible to that app.
4. Configure a signed GitHub webhook for push and pull-request events if automatic incoming notifications/PR result updates are wanted. Webhooks are optional for manual comparison, not for remote authorization.
5. Resolve older migration-ledger drift separately before a broad production migration replay. Runtime database roles without service-role/superuser privileges require an explicit server-only grant/policy deployment; public/client roles must not be granted these tables.

## Checks performed

- TypeScript typecheck: passed (also restored the missing existing `Eye` icon import that blocked compilation).
- Production Next.js build: passed, including compilation, TypeScript, and page generation.
- Focused sync ESLint: passed.
- Files/collaboration/contribution unit suite: 617 passed.
- Reviewed-sync, worker, comparison/status checks: 16 passed, including actual pushes to a temporary **local bare Git repository**, concurrent-push rejection, PR branch isolation, and literal handling of pathspec-like filenames.
- Two additional API boundary tests passed: populated-repository missing-branch rejection and downloaded-blob integrity validation (635 unit checks total across these runs).
- Migration journal/source checks: passed. Database rollback check passed for SQL validity, RLS isolation, real-content attribution, metadata-only suppression, and unique event sequences.
- Authenticated browser smoke check on the configured E2E user's existing project: full-width collection, successful server reads, private-repository default, and desktop/mobile overflow passed. No fixture project or repository was created.
- Public-viewer browser check: no GitHub Sync controls, no horizontal page overflow.
- Sync-scoped diff whitespace check: passed. The whole pre-existing dirty worktree still has unrelated trailing whitespace in `ProjectLayout.tsx`; it was left untouched.

Reproducible focused checks:

```sh
npm run typecheck
node --import tsx --test tests/unit/github-reviewed-sync.test.ts tests/unit/git-sync-worker-contract.test.ts tests/unit/github-sync-preview-comparison.test.ts tests/unit/github-sync-status-contract.test.ts
node --import tsx --test tests/unit/github-sync-api.test.ts
node --env-file=.env.local --import tsx tests/integration/github-sync-workspace-smoke.mts
```

## External acceptance still required

No live GitHub repository was created, no user files were published, and no real GitHub push/pull/PR/merge or webhook delivery was performed. The browser account used for verification has no GitHub authorization. An authorized disposable repository/account is required to verify OAuth, organization policy/SSO, branch protection, deployed worker delivery, webhook configuration, and GitHub's eventual contributor display end to end. Local tests cannot establish those external outcomes.
