# HeroUI v3 design-system and application integration audit

> Historical snapshot from 2026-07-21. Do not use its verification status as current database, migration, capacity, or Supabase evidence; use the 2026-08-13 complete SQL/Supabase audit and a fresh verification run.

**Audit date:** 2026-07-21  
**Target:** HeroUI React v3.2.2, source revision `4af1230b97616f4c48b59f9716412ca883ddd9cf` (`v3` branch)  
**Application:** `nb-s3` / Edge (Next.js 16, React 19.2, Tailwind CSS 4)  
**Disposition:** adopt HeroUI as the visual and interaction reference, but do **not** import its default theme globally or bulk-replace primitives.

## Executive decision

HeroUI is a strong fit for Edge: it is React 19/Tailwind 4 compatible, uses React Aria for keyboard and assistive-technology behaviour, is tree-shakable, and its default visual language is close to the product direction: quiet neutral surfaces, compact controls, controlled elevation, soft status colours, and polished motion. The library documents 71 public, top-level components in v3.2.2; all are accounted for below. HeroUI’s own introduction confirms the React Aria/Tailwind 4 foundation, accessibility focus, and customization model. [HeroUI introduction](https://heroui.com/en/docs/react/getting-started) · [component catalogue](https://heroui.com/en/docs/react/components)

The application is compatible, but not ready for a drop-in swap:

| Finding | Evidence | Consequence |
|---|---|---|
| Runtime is compatible | React 19.2.3 and Tailwind 4 are already installed; HeroUI requires React 19+ and Tailwind 4+. | No framework upgrade is required. |
| HeroUI is not installed | `npm ls @heroui/react @heroui/styles` is empty. | Installation and a migration branch are required. |
| Theme variables collide semantically | The app uses `--accent` for a pale selected surface and `--muted` for a surface; HeroUI uses `--accent` for the solid action colour and `--muted` for muted foreground text. Current code has 40 accent and 113 muted utility uses. | Importing `@heroui/styles` at root would restyle existing controls incorrectly. This is the main blocker. |
| Primitives are mixed | 44 files use the local Button, 28 use the local Dialog, only one uses local Tabs, while 171 files contain direct `<button>` elements. | A replacement must be surface-by-surface, never a blind find-and-replace. |
| Visual values are duplicated | 244 UI files use direct `zinc-*` or `gray-*` presentation classes. | Tokens cannot produce a uniform HeroUI result until those values are removed during each surface migration. |
| Loading is inconsistent | About 60 `.tsx` files contain skeleton/pulse logic; several use a full-surface pulse instead of shape-aware content placeholders. | A shared shimmer primitive is the highest-value first implementation. |

## Scope and evidence

This audit covers the complete public component index at the supplied URL, its source and style trees, and the application’s user-facing route/component tree. The HeroUI source was read at the revision above, including:

- `packages/react/src/components/<component>/`: implementation, entry point, and Storybook story for every documented component.
- `packages/styles/src/components/<component>/<component>.styles.ts`: Tailwind-Variants source for every documented component.
- `packages/styles/components/<component>.css`: published BEM-style CSS.
- `packages/styles/themes/shared/theme.css`, `packages/styles/themes/default/variables.css`, and `packages/styles/base/base.css`.
- Composite/support folders not shown as independent docs cards: `calendar-year-picker`, `color-input-group`, `date-input-group`, `list-box-item`, `list-box-section`, `menu`, `menu-item`, `menu-section`, `radio`, `switch-group`, `tag`, `empty-state`, `header`, `rac`, `hooks`, and `utils`.

The source tree totals 13,490 implementation lines excluding stories. A component normally comprises a folder with `index.ts`, one implementation, and one story; the exceptions above add supporting files. The largest/highest-risk sources are Calendar (451 lines), Table (462), RangeCalendar (472), Toast (534), Drawer (577), and CalendarYearPicker (611). Those should be integrated only where their richer behaviour is needed.

Local scope covers 300 UI `.tsx` files: projects (141), chat (29), UI primitives (18), onboarding (18), profile (15), settings (20), layout (12), hub (8), workspace (9), people (7), and supporting folders. The route surfaces are landing/auth, onboarding, hub, people, profiles, messages, project workspace (tasks/files/docs/sprints/analytics), settings, workspace, and admin notifications.

## The non-negotiable integration boundary

HeroUI’s quick start proposes importing `@heroui/styles` after Tailwind. That is correct for a greenfield application, but unsafe here because the default theme owns generic variables such as `--background`, `--foreground`, `--muted`, `--accent`, `--border`, and `--radius`. [HeroUI quick start](https://heroui.com/en/docs/react/getting-started/quick-start) · [HeroUI theming](https://heroui.com/en/docs/react/getting-started/theming)

Use this progression instead:

1. **Pilot with selective source CSS only.** Import HeroUI base/shared theme plumbing and the individual component CSS required by the pilot. Do not import `@heroui/styles` or `@heroui/styles/themes/default` globally.
2. **Create a local HeroUI adapter scope.** Preserve aliases to the existing Edge values before assigning HeroUI semantic variables inside the migrated component subtree. Do not place legacy `bg-muted` or `bg-accent` elements inside that scope until migrated—the words have different meanings.
3. **Migrate local primitives and feature surfaces.** A HeroUI component must own its whole interaction root. Do not wrap a Radix Dialog/Tabs/Select inside its HeroUI equivalent or mix their state/focus contracts.
4. **Perform the global token migration only after all high-traffic surfaces are converted.** This is the point at which importing the default HeroUI theme can be evaluated; it is not a first-step optimization.

The source-faithful selective path is supported by HeroUI’s documented base, shared theme, and per-component CSS export paths. The complete default theme is optional, not mandatory. Its semantic-token model is sound—accent, default, success, warning, danger, surface, overlay, field and separator roles—but those roles must be translated before Edge gives it global ownership. [HeroUI colors](https://heroui.com/en/docs/react/getting-started/colors)

### Required token translation

| HeroUI role | Edge source during pilot | Final rule |
|---|---|---|
| `--background`, `--foreground` | existing app background/foreground | Keep Edge values initially; migrate all app utilities to HeroUI semantics before changing globals. |
| `--surface`, `--surface-foreground` | `--card`, `--card-foreground` | Cards, panels, accordions and drawers use surface, never direct zinc fills. |
| `--overlay`, `--overlay-foreground` | `--popover`, `--popover-foreground` | Menus, modal, tooltip and command palette use overlay elevation. |
| `--accent`, `--accent-foreground` | `--primary`, `--primary-foreground` | HeroUI’s accent is the solid Edge action colour; it must not inherit Edge’s current selected-surface accent. |
| `--muted` | `--muted-foreground` | HeroUI muted is text; preserve the Edge muted surface under a renamed/app-owned alias during migration. |
| `--surface-secondary`, `--surface-tertiary` | Edge muted/background mixtures | Use for inset panels and skeleton bases; no raw `zinc-*`. |
| `--default`, status/soft values | derive from current neutral/status tokens with `color-mix()` | One source of truth for hover, focus and soft fills in both themes. |
| `--field-*`, `--focus`, `--separator` | Edge input/ring/border values | Normalize every input’s hover, focus, invalid and disabled states. |
| `--radius` | existing `0.625rem` in phase 1 | Do not silently reset to HeroUI’s default `0.5rem`; approve a global radius change separately. |

## Application integration map

| Surface | Responsible route/components | HeroUI priority | Keep / change |
|---|---|---|---|
| Root shell and header | `src/app/layout.tsx`, `src/components/layout/*`, `src/components/layout/header/*` | Button, Tooltip, Popover, Dropdown, Kbd, SearchField, ScrollShadow | Keep the theme provider, route performance observer, dynamic command palette and current scroll-root contract. Replace visually duplicated header actions and menus. |
| Authentication | `src/app/(auth)/*`, `src/components/auth/*` | Card, TextField/Input, InputOTP, Form, Alert, Button, ProgressBar | High-value early migration: low state complexity, repeated pages, visible brand impact. Retain Turnstile and auth/error logic. |
| Onboarding | `src/app/(onboarding)/*`, `src/components/onboarding/*` | Form fields, RadioGroup, Checkbox, Chip/TagGroup, ProgressBar, ButtonGroup, Skeleton | Preserve the four-step state/config system, responsive stepper and density tests; replace manual selectable-card/button styling. |
| Hub/project discovery | `src/components/hub/*`, `src/components/projects/ProjectCard.tsx` | Card, Avatar, Badge/Chip, Dropdown, Popover, Pagination, Skeleton, EmptyState | Migrate card anatomy and loading first. Preserve data queries, comparison logic and virtual/scroll behaviour. |
| People/profile | `src/components/people/*`, `src/components/profile/v2/*`, `src/components/skills/*` | Avatar, Card, Tabs, TagGroup, Chip, Button, Modal, Drawer, EmptyState | Strong visual fit; move Skills from hand-rolled chips to TagGroup only when keyboard remove/reorder is useful. |
| Messages | `src/components/chat/v2/*` | Avatar, Button/CloseButton, Dropdown, Tooltip, Popover, TextArea, Badge, Skeleton, Toast | Keep bespoke message bubbles, composer, keyboard shortcuts, virtualization and realtime state. Use HeroUI around them, not instead of them. |
| Project workspace—tasks | `src/components/projects/v2/tasks/*`, `src/components/projects/tabs/*` | Tabs, Toolbar, ToggleButton(Group), Select, Checkbox, Drawer, Modal, AlertDialog, Table/ListBox, Progress | Adopt controls and task panels. Preserve drag/drop, keyboard task behaviour, domain status badges and React Query hooks. |
| Project workspace—files | `src/components/projects/v2/files-tab/*`, `explorer/*` | Breadcrumbs, ScrollShadow, Dropdown, Tooltip, Drawer, Table, ProgressBar, Skeleton | Keep the highly stateful explorer, deep-link startup machine, workers and file leases. Apply HeroUI to row/action chrome only. |
| Project docs/editor | `src/components/projects/doc/*` | Toolbar, ToggleButtonGroup, Popover, Modal, Alert, Table (rendered document tables only), Skeleton | Preserve TipTap/CodeMirror/Yjs content and native document table semantics; do not replace editor internals with HeroUI Table. |
| Sprints/analytics | `src/components/projects/dashboard/*`, `analytics/*`, `sprints/*` | DatePicker/RangeCalendar, Meter/Progress, Tabs, Table, Drawer, Alert | Good fit for filters, health/status and drawers. Date conversion deserves isolated contract tests. |
| Settings/security | `src/components/settings/*`, `settings/ui/*` | Form, Switch, RadioGroup, Select, AlertDialog, Toast, ProgressBar, Card | Migrate high-trust controls carefully. Retain security step-up, delete-account and API handling; never weaken confirmation language/focus management. |
| Workspace/admin | `src/components/workspace/*`, `src/app/admin/notifications/page.tsx` | Drawer, Table, Tabs, ListBox, EmptyState, Skeleton | Use HeroUI Table for operational data, not for the project explorer; migrate drawers after core modal contract is verified. |

## Complete public component catalogue and placement

**Decision key:** **Adopt** = use HeroUI source as the implementation target; **Pilot** = use after token adapter and focused tests; **Defer** = available but no validated product need; **Do not use** = avoid for this product/surface. All rows correspond one-to-one to the component cards in the supplied HeroUI catalogue.

### Buttons

| Component | Decision and exact placement | Keep / avoid |
|---|---|---|
| Accordion | **Adopt.** Settings FAQs, project analytics detail sections, mobile filter disclosures. | Keep open-state/domain persistence where it exists; do not turn frequently used task controls into hidden accordions. |
| Alert | **Adopt.** Auth errors, upload/sync warnings, project/doc conflict banners, security notices. | Keep existing error copy and live regions; avoid using it for ephemeral confirmations (Toast). |
| AlertDialog | **Pilot.** Delete account, destructive task/file actions, discard edits. | Must replace the complete current Dialog confirmation, never only its panel styling. |
| Autocomplete | **Pilot.** Global search, skill/project/user mention searches. | Use only after matching existing debounced query, virtualization and ARIA-combobox behaviour; otherwise preserve GlobalSearch. |
| Avatar | **Adopt.** Header, messages, hub cards, people/profile, project members. | Preserve existing image compression/fallback rules and stacked-avatar helper semantics. |
| Badge | **Adopt.** Task status/priority, unread counts, sync state, application state. | Keep status color mapping in `src/lib/ui/status-config.ts`; never encode status colour ad hoc. |
| Breadcrumbs | **Adopt.** Files path bar and document/project hierarchy. | Preserve file deep-link URL encoding and overflow strategy. |
| Button | **Adopt first.** All auth, settings, hub, task, composer and project calls to action; replace the 171 raw buttons gradually. | Keep native `button` only for editor/drag interactions that HeroUI cannot own without event regression. |
| ButtonGroup | **Adopt.** Wizard footer, list/grid view controls, grouped project actions. | Do not use as visual spacing for unrelated destructive and primary actions. |
| Calendar | **Defer.** No confirmed standalone calendar requirement. | Use DatePicker/RangeCalendar only at product input points; do not introduce a calendar merely because it exists. |
| Card | **Adopt.** Auth panels, hub/project cards, profile sections, settings sections, dashboard cards. | Preserve specialized interactive/drag card wrappers and current data boundaries. |
| Checkbox | **Adopt.** Bulk task/file selection, privacy/settings, onboarding confirmations. | Use a native/React Aria label association; do not retain hand-styled checkbox siblings. |
| CheckboxGroup | **Pilot.** Multi-select onboarding skills/privacy and bulk filters. | Do not force into single-choice radio use cases. |
| Chip | **Adopt.** Compact non-removable skills, filters and status metadata. | Use TagGroup for interactive/removable collections. |
| CloseButton | **Adopt.** Every HeroUI overlay close affordance, composer attachments, removable non-tag UI. | Preserve accessible labels and avoid icon-only unlabeled controls. |
| ColorArea | **Do not use.** No product colour authoring feature is in scope. | Appearance settings retain its curated accent palette. |
| ColorField | **Do not use.** No validated free-form colour input. | Do not expose brand/appearance hex input without accessibility and contrast validation. |
| ColorSlider | **Do not use.** No colour-editor workflow. | Same rationale as ColorField. |
| ColorSwatch | **Defer.** Could display preset appearance palettes later. | Current swatches are adequate until a palette editor is approved. |
| ColorSwatchPicker | **Do not use.** Curated palette selection does not require a full picker. | Keep a small, domain-specific appearance selector. |
| ColorPicker | **Do not use.** No content/design-editor colour requirement. | Avoid an expensive interaction surface with no product owner. |
| ComboBox | **Pilot.** Task links, assignee/role selection, project selection, command palette selectors. | Requires async collection/virtualization testing; do not replace simple static Selects. |
| DateField | **Pilot.** Granular due date/sprint date editing. | Validate locale, time zone, empty values and server serialization before rollout. |
| DatePicker | **Pilot.** Create/edit task, sprint creation, project updates. | One shared date adapter is mandatory; preserve existing `date-fns` serialization boundaries. |
| DateRangePicker | **Pilot.** Analytics date filters and sprint range. | Adopt only where both endpoints are meaningful; avoid converting two independent dates automatically. |
| Description | **Adopt through Form.** Field help across auth, onboarding, project and settings forms. | Keep sensitive security explanations explicit and near the control. |
| Disclosure | **Adopt.** Mobile side panels, compact task/file detail sections. | Keep stateful workspace rails and code editor panes bespoke. |
| DisclosureGroup | **Adopt.** Settings groups and mobile nav groupings. | Avoid replacing semantic task tables/list rows. |
| Drawer | **Pilot.** Mobile sidebar, workspace panel, sprint/file history drawer, file inspector. | Source includes drag-to-dismiss; test nested scrolling, keyboard focus, desktop resize and existing `WorkspaceDrawerHost`. |
| Dropdown | **Adopt.** Row overflow actions, message actions, profile menu, project/file menus. | Replace Radix menu root as a unit; retain only current domain action handlers. |
| ErrorMessage | **Adopt through Form.** Inline React Hook Form/auth validation. | Keep API error mapping; do not expose raw server errors. |
| FieldError | **Adopt through Form.** Form invalid state under all auth/onboarding/settings inputs. | Use one of ErrorMessage/FieldError consistently, not both in the same field. |
| Fieldset | **Adopt.** Privacy, notification and create-project option groups. | Keep legends for accessibility; no decorative fieldsets. |
| Form | **Adopt.** Auth, onboarding, settings, create/edit project/task/sprint. | Keep React Hook Form, Zod and server action logic; this only replaces field composition and visual states. |
| Input | **Adopt.** Standard one-line inputs across auth/settings/project forms. | Migrate with Label, Description and FieldError together. |
| InputGroup | **Adopt.** Search prefixes, URL/repository fields, message attachment controls. | Use only for meaningful leading/trailing actions; no ornamental icons. |
| InputOTP | **Pilot.** MFA/recovery-code verification flows. | Retain existing `MfaSetup` validation and avoid accepting pasted values incorrectly. |
| Kbd | **Adopt.** Command palette, messaging shortcuts, file quick-open hints. | Keep actual shortcut registration; visual keycaps must reflect platform keys. |
| Label | **Adopt through Form.** Every migrated field. | Do not use visual text in place of a programmatic label. |
| Link | **Adopt selectively.** Inline docs/help/profile/project links. | Keep Next `Link` routing; use HeroUI render/composition rather than navigation regressions. |
| ListBox | **Pilot.** Command palette results, notification choices, filter lists. | Requires performance/virtualization and keyboard audit for long lists. |
| Meter | **Adopt.** Profile/project completion, storage/usage thresholds, task health. | Do not use for indeterminate work—use ProgressBar/Spinner instead. |
| Modal | **Pilot.** Project edit/apply, profile edit/invite, create task/sprint, document publish. | Complete state/focus/overlay migration required; keep all existing mutations and unsaved-change guards. |
| NumberField | **Pilot.** Capacity, estimates, pagination size and project numeric settings. | Validate min/max, locale and server-number conversion; do not use a raw text input for numeric data after migration. |
| Pagination | **Adopt.** Hub results, people results and future admin result pages. | Preserve URL/query keys and infinite-scroll surfaces; do not add pagination to virtualized streams. |
| Popover | **Adopt.** Emoji/reaction controls, task link chips, editor insert tools, profile actions. | Test portal clipping against workspace panes and preserve current focus-return behaviour. |
| ProgressBar | **Adopt.** Upload/import/hydration, Git sync, onboarding/project progress. | Keep realtime state/progress calculations; component only visualizes reliable values. |
| ProgressCircle | **Defer.** Small inline progress in compact buttons or avatar uploads. | Avoid competing with Spinner; use when determinate progress is known. |
| RadioGroup | **Adopt.** Onboarding choice cards, privacy modes, appearance modes, project settings. | Preserve current keyboard/touch tests and render rich cards around the radio—not bare visual buttons. |
| RangeCalendar | **Pilot.** Inline analytics/sprint date range selection. | Date adapter and locale/time-zone tests are required. |
| ScrollShadow | **Adopt selectively.** Header/content edge affordances in task/file/message panes. | Retain `AppScrollArea` as the scroll owner; ScrollShadow is visual only. |
| SearchField | **Pilot.** Header global search, messages, people and files filter boxes. | Preserve query debounce, URL state and search workers; do not fork query logic. |
| Select | **Adopt.** Static settings, task status/priority, sort fields and onboarding selections. | Use ComboBox for dynamic search/large collections instead. |
| Separator | **Adopt.** Menus, settings and card sections. | Replace manual zinc borders only when the surrounding component moves to semantic tokens. |
| Skeleton | **Adopt first.** All loading states, beginning with project cards, hub, messages, files, tasks, settings and docs. | Use shimmer by default, preserve layout shape, and honor existing reduced-motion preference. Detailed plan below. |
| Slider | **Defer.** No validated range input exists. | Do not invent an appearance or priority slider. |
| Spinner | **Adopt.** Button pending state, short local actions, small async inline states. | Do not use for page loading where a shaped Skeleton prevents layout shift. |
| Surface | **Adopt.** Unified base for panels, popovers, cards, command palette and drawers. | It is the token/visual backbone; avoid nesting unnecessary elevated surfaces. |
| Switch | **Adopt.** Settings toggles, notification/privacy flags, feature preferences. | Replace the raw reduce-motion checkbox only together with its label/error/control state. |
| Table | **Pilot.** Admin notifications and folder list mode; document renderer retains semantic HTML table output. | Do not replace Kanban, virtual chat, explorer tree or rich-text document tables with Table. |
| Tabs | **Adopt.** Profile, settings, workspace/task details, project tabs and editor mode controls. | Replace each Radix Tabs root atomically; preserve URL state/lazy data and test roving keyboard focus. |
| TagGroup | **Pilot.** Editable skills, task labels, selected recipients/filters. | Use only where add/remove keyboard semantics improve the existing Chip collection. |
| Typography | **Adopt first.** Auth/onboarding/settings/hub and reusable card text; later project surfaces. | Define the Edge type scale once, then eliminate hand-set text sizing/weights from migrated surfaces. |
| TextField | **Adopt through Form.** Conventional labeled inputs with validation. | Do not combine with Input unless the needed compound API is clear; choose one field convention. |
| TextArea | **Adopt.** Project updates, comments, settings free text and simple composer fields. | Keep the bespoke message/doc rich composer internals. |
| TimeField | **Defer.** No confirmed time-of-day product field. | Add only with time-zone and server-domain requirements. |
| Toast | **Do not replace now.** Keep the existing Sonner integration in `src/components/ui/sonner.tsx`. | HeroUI Toast would create a second notification state system; revisit only during a planned unified notification migration. |
| Toolbar | **Adopt.** Doc/editor command strips, task bulk actions, file actions. | Preserve editor keyboard/input event ownership and use ToggleButton controls within it. |
| ToggleButton | **Adopt.** View toggles, formatting toggles, task filter chips, appearance choices. | Use a semantic pressed state, not generic buttons with selected colour. |
| ToggleButtonGroup | **Adopt.** List/grid, sort/view options, doc formatting groups. | Do not use for mutually exclusive navigation—Tabs is the correct primitive. |
| Tooltip | **Adopt.** Icon-only header/file/message/editor actions. | Require an accessible name; retain no-tooltip policy for touch-only essential actions. |

## Supporting source components not shown as separate documentation cards

The public source also exports support primitives. They are covered here so the source audit is not limited to the documentation cards:

| Source folder(s) | Role | Integration decision |
|---|---|---|
| `calendar-year-picker`, `calendar/*` | Calendar navigation/grid internals. | Enter only through Calendar/DatePicker rollout; no direct product use in phase 1. |
| `color-input-group`, `date-input-group` | Compound field internals. | Do not import directly; consume through Color/Date public components. |
| `list-box-item`, `list-box-section`, `menu`, `menu-item`, `menu-section` | Collection composition behind ListBox/Dropdown. | Use only when custom collection rendering needs them; keep collection keys/actions domain-owned. |
| `radio`, `switch-group`, `tag` | Children of their documented group components. | Use through RadioGroup/Switch/TagGroup migrations. |
| `empty-state`, `header` | Small presentational building blocks. | Adopt styling/anatomy for empty list/search pages; do not create a competing application-wide abstraction until first real reuse. |
| `rac`, `hooks`, `utils`, `icons` | React Aria re-exports, helpers, internal icons. | Do not depend on internal paths from application code; import the documented top-level package API only. |

## Shimmer skeleton: required implementation design

HeroUI Skeleton defaults to shimmer, exposes `shimmer`, `pulse`, and `none`, and supports a synchronized parent shimmer by applying `skeleton--shimmer` to the parent and disabling child animations. The published source is a 2-second linear translation from `-100%` to `200%`, with a `surface-tertiary/70` base. [HeroUI Skeleton](https://heroui.com/en/docs/react/components/skeleton)

### Decision

Implement one shared `AppSkeleton` facade backed by HeroUI Skeleton after the selective CSS adapter exists. It must expose only `animationType`, `className`, and semantic shape composition; it must not become another loading-state framework. The global default is shimmer. In the existing `html[data-reduce-motion="true"]` and `prefers-reduced-motion` paths, force `animationType="none"` (or disable the pseudo-element) rather than merely accelerating the motion.

### Exact visual contract

- **Base:** `relative`, `overflow-hidden`, non-interactive, predictable radius, semantic tertiary surface; never raw `zinc-100`/`zinc-800`.
- **Motion:** 2s linear left-to-right shimmer; no independent animation for each child in a list/card. Wrap a skeleton composition in the parent `skeleton--shimmer` class for a single light band.
- **Dark mode:** derive base and shimmer from the mapped `--surface-tertiary`; do not use a white hard-coded band that flashes against dark surfaces.
- **Accessibility:** skeleton root is non-interactive; the parent loading region owns `aria-busy` and a concise `aria-live` status only when users need progress feedback. Never announce every skeleton row.
- **Layout:** mirror final content dimensions, aspect ratio and density tokens. Skeletons must prevent cumulative layout shift, not merely fill a region.
- **Pending actions:** use Button pending + Spinner for a known local action; do not replace a button label with an unrelated page skeleton.

### First wave of replacements

| Replace | With | Reason |
|---|---|---|
| `src/components/projects/ProjectCardSkeleton.tsx` | Project-card composition: header chips, title/description lines, skills, metrics, avatar stack within one synchronized shimmer parent. | High-visibility hub feed and currently hard-codes `zinc` plus independent pulse. |
| `src/components/chat/v2/MessagesSurfaceSkeletons.tsx` | Inbox/thread shapes retain their current accurate geometry but use shared skeleton primitives. | High frequency; eliminates dozens of repeated `animate-pulse` utilities without changing chat layout. |
| `src/components/projects/skeletons/*` | Tasks/files/doc/analytics/settings compositions use semantic panels and synchronized groups. | Removes inconsistent base fills and creates one recognizable loading language. |
| Dynamic editor fallbacks in `ProjectDocEditor.tsx` | Editor/side-panel shape skeletons. | Avoids blank pulsing rectangles during expensive editor loads. |
| Auth/onboarding/settings Suspense fallbacks | Form/card-shaped skeletons only where loading is observable. | Prevents full-screen blocks while keeping the existing server/client loading split. |

### Do not change

- Keep the current reduced-motion provider and tests; it is already broader than a library-local preference.
- Keep request/error/realtime state machines. Skeletons represent only the loading phase, never error or empty data.
- Keep `AppScrollArea`. HeroUI’s own base CSS contains a commented-out global scrollbar rule because it caused modal/backdrop closure issues; importing it would be a regression risk for this app’s nested workspaces.

## What is necessary, what is not, and what does not work well

### Necessary to achieve a HeroUI-consistent product

1. A token adapter, then a planned global semantic-token migration.
2. One shared Button, field, overlay, surface, typography, status and skeleton contract—not individual Tailwind recreations in feature files.
3. Atomic replacement of interaction roots (Dialog, Tabs, Select/ComboBox, Dropdown), with keyboard, focus-return, portal, mobile and reduced-motion tests.
4. Removal of raw zinc/gray presentation values as each component is migrated.
5. A visual regression matrix for light/dark, compact/default/comfortable density, all five accent palettes, narrow/mobile viewport, keyboard-only navigation, and reduced motion.

### Not necessary now

- Colour editing components, standalone calendar, time fields, generic slider, or a new toast mechanism.
- A wrapper library around every HeroUI component before a second genuine application use appears.
- A wholesale rewrite of chat, file explorer, rich-text editor, realtime providers, React Query, React Hook Form, Zod or domain actions. HeroUI is the interface layer, not a replacement for product logic.
- Full default-theme import before Edge’s conflicting generic variables are retired or renamed.

### Strengths to preserve

- Accessible React Aria controls, structured compound components, BEM slots, `data-*` state styling, Tailwind 4 compatibility and package-level tree shaking.
- Strong default surface/overlay distinction, restrained shadows, semantic status colours, focus treatment, button pending support, composite tables, and the source-accurate shimmer implementation.
- Existing Edge strengths: persisted density/accent/reduced-motion settings, SSR theme prehydration, native scrolling control, Sonner integration, realtime loading boundaries, and specialized workspace/editor interaction models.

### Risks and weak fits

- **Token collision:** default HeroUI import changes existing Tailwind utility meaning. This is a release blocker, not a polish item.
- **Primitive duplication:** Radix and React Aria may coexist temporarily, but a single surface must have one focus/overlay owner. Running both versions of a Dialog/Tabs/Select on one surface is an accessibility and regression risk.
- **Complex source where unnecessary:** Calendar/RangeCalendar/Table/Toast/Drawer are substantial implementations. Use their capability only when it earns the complexity.
- **Drawer gesture:** HeroUI Drawer contains pointer-drag dismissal. It needs deliberate testing with nested scroll areas, code editor canvases, file tree drag/drop and desktop widths.
- **Table mismatch:** HeroUI Table is appropriate for data grids, not Kanban, virtual message streams, explorer trees, or rich-text document tables.
- **Shimmer compositing:** HeroUI’s synchronized parent shimmer uses `mix-blend-mode: overlay`; validate it on the app’s dark surfaces and honor reduced motion. Use independent shimmer only when a container cannot safely clip its children.
- **Date/time:** React Aria date components require a clear conversion boundary; date-only task/sprint values must not acquire accidental timezone shifts.

## Delivery sequence and acceptance gates

| Phase | Deliverable | Exit gate |
|---|---|---|
| 0 — contract | Add HeroUI packages, selective imports and scoped adapter on a feature branch; no default theme import. | Existing theme/density/reduced-motion contract stays green and legacy UI is visually unchanged outside pilot. |
| 1 — loading and type | Shared HeroUI-backed Skeleton, Typography and Surface; migrate auth + hub project-card loading. | No layout shift in card/form loading; shimmer is static for reduced motion; light/dark/accent snapshots pass. |
| 2 — primitive foundation | Button, field/form, Badge/Chip, Card, Avatar, Tooltip/Popover, Separator. | Keyboard/focus/invalid/pending states tested; no raw colour additions in migrated files. |
| 3 — overlays/navigation | Dropdown, Modal/AlertDialog, Drawer, Tabs, Breadcrumbs, SearchField. | Escape, outside click, focus return, nested portal and mobile tests pass. |
| 4 — product workflows | Hub, people/profile, settings/onboarding, then task/file/editor chrome. | Domain actions, realtime, drag/drop, deep links and rich editor behaviour remain unchanged. |
| 5 — data/input specialists | Table, ComboBox/ListBox, date controls, pagination and meter/progress. | Collection performance, locale/time-zone, sorting/filtering and screen-reader checks pass. |
| 6 — converge | Decide whether Edge can fully own HeroUI global tokens/default theme; delete superseded local primitive styles only after replacement coverage. | Visual parity matrix and full test/release gate pass; no double primitive systems remain on migrated routes. |

## Ponytail full-audit findings

- `yagni:` Do not globally import HeroUI’s default theme now. Selective component CSS plus an adapter is the smallest source-faithful replacement. [`src/app/globals.css`](../../src/app/globals.css)
- `delete:` Retire bespoke skeleton styling only after each shape is migrated to the shared Skeleton; replacement is one composition primitive, not a new loading framework. [`src/components/projects/ProjectCardSkeleton.tsx`](../../src/components/projects/ProjectCardSkeleton.tsx)
- `native:` Keep `AppScrollArea` as the app’s native scrolling owner; HeroUI’s source itself avoids global scrollbar styling because of overlay interaction risk. [`src/components/ui/AppScrollArea.tsx`](../../src/components/ui/AppScrollArea.tsx)
- `yagni:` Keep Sonner rather than adding HeroUI Toast beside it; one notification queue is sufficient. [`src/components/ui/sonner.tsx`](../../src/components/ui/sonner.tsx)
- `shrink:` Replace repeated raw button class strings only after the shared Button is adopted; a codemod before the interaction contract exists would be a false simplification. [`src/components`](../../src/components)

**Net:** no safe bulk deletion in the audit pass. The approved staged migration can safely consolidate duplicated visual code, but only after interaction and theme contracts are demonstrated.

## Audit conclusion

Adopt HeroUI v3.2.2 as the reference design system and source for migrated primitives. Begin with a scoped, source-faithful shimmer Skeleton plus foundation tokens—not a root stylesheet import. The highest-return first target is the shared loading language, followed by auth/onboarding/hub primitives; the highest-risk late targets are workspace overlays, date controls, collection controls, and the rich document/file surfaces. This approach produces a genuinely consistent HeroUI visual system while preserving the specialized behaviours that make Edge a collaboration product rather than a generic dashboard.
