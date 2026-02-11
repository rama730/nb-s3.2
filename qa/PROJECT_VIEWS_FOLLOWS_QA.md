## Project Views & Followers QA Checklist

### Preconditions
- Logged in user with access to Hub and at least one project in Hub list.
- Project detail page is accessible.

### 1. Project Detail View Count
1. Open `/hub`.
2. Click a project card.
3. On project detail page, confirm `Views` count is visible.
4. Hard refresh the page once and confirm count does not jump multiple times in the same session.
5. Open the same project in a new tab (same browser session).
6. Confirm the view count does not increment again in the same session.
7. Open the same project in a new incognito/private session.
8. Confirm the view count increments by at least 1.

### 2. Follow/Unfollow from Project Detail
1. On project detail page, click `Follow`.
2. Confirm followers count increments immediately.
3. Refresh page and confirm follow state persists.
4. Click `Unfollow`.
5. Confirm followers count decrements immediately.
6. Refresh page and confirm follow state persists.

### 3. Follow/Unfollow from Hub Project Card
1. Go back to `/hub`.
2. Hover over the project card to reveal quick actions.
3. Click `Follow`.
4. Confirm followers count in the card updates.
5. Open the project detail page and confirm followers count matches.
6. Click `Unfollow` from detail page and return to Hub.
7. Confirm followers count in the card matches detail page.

### 4. Data Consistency
1. Compare followers count on project detail page and hub card.
2. Compare view count on project detail page and analytics tab (if visible).
3. Confirm all counts are stable across navigation without double increments.
