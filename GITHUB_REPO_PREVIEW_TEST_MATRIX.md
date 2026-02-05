## GitHub Repo Preview (Wizard Phase 1) – Manual Test Matrix

Goal: confirm the Phase 1 GitHub flow is **trustworthy**, **fast**, and **consistent** with the actual importer.

### Preconditions
- App is running (local or deployed).
- Redis/worker stack is running if you want to validate the full GitHub import end-to-end (queue → clone → index → Files tab).
- You can test both **unauthenticated GitHub (public repos)** and **GitHub-connected (private repo access)**.

### A. Phase 1 preview UX (before project creation)

- **A1: Public repo, not connected**
  - Select **Import from GitHub**
  - Paste a public repo URL (e.g. `https://github.com/vercel/next.js`)
  - Click **Preview files**
  - Expect:
    - Preview loads (root tree visible)
    - You can expand folders (lazy load)
    - Search works across loaded folders

- **A2: Private repo, not connected**
  - Paste a private repo URL
  - Click **Preview files**
  - Expect:
    - Preview fails with a clear message
    - CTA to **Connect GitHub**
    - You can click **Skip preview and continue**

- **A3: Private repo, connected**
  - Connect GitHub (OAuth)
  - Paste private repo URL
  - Click **Preview files**
  - Expect:
    - Preview loads successfully

- **A4: Very large repo**
  - Use a repo with many folders/files
  - Click **Preview files**
  - Expand multiple folders
  - Expect:
    - No page freeze (lazy expansion only)
    - Expanded folder results are cached (collapsing + re-expanding does not re-fetch)

- **A5: Ignore rules parity**
  - Use a repo that contains directories like `node_modules/`, `.next/`, `.git/`
  - Expect:
    - These are labeled as **Ignored** in preview
    - They are not expandable / not fetched deeper

- **A6: Oversized file parity**
  - Use a repo with a file > 25MB (or simulate one)
  - Expect:
    - Preview labels it **Too large**
    - This matches importer behavior (skipped)

- **A7: Branch correctness**
  - Ensure the preview shows the branch pill (default branch or selected branch)
  - Expect:
    - The branch used for preview matches `import_source.branch` (used by the importer job)

### B. Wizard progression logic (gating)

- **B1: GitHub selected + repo URL present**
  - First click on Phase 1 **Continue/Preview files**
  - Expect: stays in Phase 1 and shows preview panel (loading → ready/error)
  - Second click after preview is ready
  - Expect: advances to Phase 2

- **B2: GitHub selected + repo URL missing**
  - Click Continue
  - Expect: a clear error toast (no phase advance)

- **B3: Preview error**
  - Trigger an error (private repo without auth / rate limit)
  - Click **Skip preview and continue**
  - Expect: advances to Phase 2 immediately

### C. End-to-end (after creation)

- **C1: Create project with GitHub import**
  - Fill all project details (title, tagline, description, problem, solution, lifecycle, roles)
  - Create project
  - Expect:
    - Project detail shows all entered fields
    - Files tab shows sync status (`cloning` → `indexing` → `ready`)
    - When ready: repo files appear

### Notes / expected limitations
- GitHub `/contents` API can be rate-limited; preview is intentionally optional and should never hard-block the wizard.
- Preview is **not** a full recursive listing; it’s root-first with lazy expansion for performance.

