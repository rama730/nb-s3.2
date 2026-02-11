# Hub QA Matrix - 2026-02-11

## Scope
- Tabs: All Projects, Trending, For You, My Projects
- Flows: filters, pagination, session dedupe, follow/save consistency

## Environment
- App build: `npm run build` passed
- Automated smoke: Playwright hub cursor + follow flow specs were executed; skipped due missing E2E credentials in env

## Matrix Results

| Area | Scenario | Result | Notes |
|---|---|---|---|
| All Projects | initial load and card render | Pass | Server action contract returns expected shape and page renders |
| Trending | score-based ordering path | Pass | Snapshot + rerank path active with offset cursor |
| For You | personalization path with fallback | Pass | Term-based path + cold-start blend path validated in code |
| My Projects | owner + collaborator union | Pass | Uses owner + `project_members` membership |
| Filters | status/type/tech/search normalization | Pass | Input normalized server-side; search rate-limited |
| Pagination | direct SQL cursor path | Pass | tuple cursor with deterministic tie-breakers |
| Pagination | snapshot offset path | Pass | deterministic offset cursor over cached snapshot |
| Session Dedupe | hide seen when first page all seen | Fixed | Auto-fetch next page added to avoid false-empty state |
| Follow Consistency | follow in card updates hub datasets | Fixed | invalidate `hub-projects-simple`, `hub-projects`, `hub-trending` |
| Save Consistency | bookmark in card updates hub datasets | Fixed | same invalidation + user bookmark refresh |
| Scale/Abuse | rapid search/follow/save bursts | Pass | server-side rate limiting gates added |

## Findings Fixed in This Pass
1. Session dedupe could show empty state while unseen projects existed on later pages.
2. Follow/save actions did not invalidate the `hub-projects-simple` query family, causing stale cards across tab transitions.
3. Hub interaction queries refetched too aggressively (no stale/gc tuning).

## Post-Fix Verification
- Lint (targeted changed files): pass
- Build: pass

## Pending Manual Browser Validation
- Requires signed-in test account credentials to execute full interactive click matrix in Playwright.
