# Files Workspace Scenario Matrix

This matrix defines runtime checks beyond happy-path interactions.

## UI control contract

- `project-tab-files`
- `files-explorer-view-mode`
- `files-explorer-actions-trigger`
- `files-explorer-mode-tree`
- `files-explorer-mode-favorites`
- `files-explorer-mode-recents`
- `files-explorer-mode-trash`
- `files-explorer-search-toggle`
- `files-workspace-save-all`
- `files-workspace-view-mode`
- `files-workspace-toolbar-search-toggle`
- `files-workspace-toolbar-panel-toggle`
- `files-workspace-toolbar-menu`
- `files-editor-run`
- `files-editor-save`
- `files-editor-actions`
- `files-bottom-panel-tab-terminal`
- `files-bottom-panel-tab-output`
- `files-bottom-panel-tab-problems`
- `files-bottom-panel-toggle`
- `files-bottom-panel-close`

## Reactive scenarios

1. Multi-tab dirty-state behavior
- Open same file in left/right panes.
- Edit in one pane while autosave is in-flight in the other.
- Assert dirty indicators and final saved state consistency.

2. Rename/move/delete race
- Keep file open in editor.
- Rename or move from explorer while editing.
- Verify path metadata and editor tab state update without stale references.

3. Lock-loss conflict handling
- Acquire lock, edit file, simulate lock expiration.
- Save must return typed lock/version error path and avoid silent overwrite.

4. Offline queue + reconnect
- Disable network, edit and save.
- Confirm queued state in tab.
- Re-enable network and assert queue drains with correct persisted content.

5. Large tree + search stress
- Seed large node sets.
- Exercise search and mode toggles repeatedly.
- Ensure no UI freeze and stable virtualization behavior.

6. Bottom panel concurrency
- Run command while editor remains dirty.
- Switch terminal/output/problems tabs.
- Ensure panel state transitions do not drop editor state.
