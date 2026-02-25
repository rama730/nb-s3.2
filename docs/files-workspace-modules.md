# Files Workspace Modules

## Scope
This document defines module boundaries for:
- `/Users/chrama/Downloads/nb-s3/src/components/projects/v2/workspace`
- `/Users/chrama/Downloads/nb-s3/src/components/projects/v2/explorer`

## Primary orchestrators
- `WorkspaceShell.tsx`: wires store selectors, lifecycle hooks, and host components.
- `ExplorerShell.tsx`: wires explorer data hooks, mutation hooks, and host components.

## Workspace module boundaries
- `WorkspaceToolbarHost.tsx`: header controls and workspace actions.
- `WorkspacePaneHost.tsx`: editor panes, split resize, and empty-state rendering.
- `WorkspaceModalsHost.tsx`: quick open, command palette, find/replace, conflict dialog.
- `WorkspaceBottomPanelHost.tsx`: bottom panel rendering + active node navigation.
- `useWorkspaceUiState.ts`: modal/query local state only.
- `useWorkspaceLayoutState.ts`: pane layout local state and split resize handler.
- `useWorkspacePane.ts`: pane-derived selectors (`left/right active tab`, ordered tab ids, `getPaneForTab`).

## Tab manager module boundaries
- `WorkspaceTabManager.ts`: composition wrapper, restoration effect, public return contract.
- `tab-manager/useIndexQueueController.ts`: async index queue scheduling/metrics.
- `tab-manager/useTabDnD.ts`: tab drag/drop sensors + handler.
- `tab-manager/useTabMetadataPipeline.ts`: metadata fetch + signed URL cache.
- `tab-manager/useTabContentLoader.ts`: file content load + in-flight guards.
- `tab-manager/useTabSavePipeline.ts`: save/close/delete/open flows + conflict state.
- `tab-manager/types.ts`: shared internal types and utility helpers.

## Explorer module boundaries
- `ExplorerToolbarHost.tsx`: toolbar + mode/search/sort/action menu.
- `ExplorerOperationsHost.tsx`: operation center UI.
- `ExplorerInsightsHost.tsx`: node insights UI.
- `ExplorerDialogsHost.tsx`: create/rename/delete/move dialogs + quick open + command palette.
- `useExplorerOperationLog.ts`: operation tracking/undo state.
- `useExplorerMutations.ts`: mutation queue + create/upload/rename/move/delete pipelines.

## Dependency policy
- Workspace and explorer modules must use `@/stores/filesWorkspaceStore` for workspace state reads/writes.
- Shared type-only imports from `@/stores/files/types` are allowed.
- Run `npm run check:files:store-boundary` to enforce this rule.

## Anti-patterns to avoid
- Cross-host state mutation (host components should render + dispatch only).
- Broad store selectors that subscribe to full maps when key-level selectors are enough.
- New business logic added directly in orchestrators instead of dedicated hooks.
- Circular imports between host components and orchestration hooks.
