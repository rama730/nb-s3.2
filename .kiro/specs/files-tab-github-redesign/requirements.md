# Requirements Document

## Introduction

The Files tab on the project detail page is currently implemented as a mini IDE (editor tabs, split panes, bottom console with Run/Output/Problems, language runners for Python/JS/TS/SQL/Java, lint-on-edit, quick-fix pipeline, cursor presence, zen mode, command palette, outline/source-control/insights side panels, saved views, sidebar resize handle). The goal of this spec is to rebuild the Files tab as a lightweight GitHub "Code" tab-inspired experience focused on browsing and viewing files. The new design is "Option B — GitHub + Minimal Tree": a thin collapsible tree sidebar on the left, a GitHub-style breadcrumb bar + file list in the main area (columns: Name, Last updated, Size, By), and a single-file view that replaces the file list when a file is opened (no editor tabs, no split editor panes).

This spec also captures two explicit quality mandates from the user:

1. A known bug — the metadata panel showing stale data after a file is closed — must be fixed.
2. Every remaining Files-tab feature must be functionally verified end-to-end during implementation, and any malfunction discovered must be documented and fixed before the spec is considered complete.

This spec is scoped to the Files tab only. The Tasks tab and every other project tab are out of scope.

## Glossary

- **Files_Tab**: The Files tab rendered on the project detail page at `/projects/{projectId}` when the Files tab is active. The subject of this spec.
- **Project_Node**: A row in the `projectNodes` table representing either a file or a folder. Has `id`, `parentId`, `name`, `type` ("file" | "folder"), `size`, `updatedAt`, `updatedBy`, `currentVersion`.
- **Node**: Shorthand for Project_Node when context is unambiguous.
- **Sidebar_Tree**: The collapsible tree view on the left side of the Files_Tab. Renders folders and files in a hierarchical indented list. Supports expand/collapse, inline search, and keyboard navigation.
- **Breadcrumb_Path**: The ordered list of folder segments from the project root to the currently focused node, rendered as a clickable breadcrumb bar above the file list. The final segment is the current folder (or the parent folder of the currently viewed file).
- **Breadcrumb_Bar**: The rendered UI component at the top of the main area that displays the Breadcrumb_Path.
- **Current_Location**: The folder or file that defines what the main area renders. For the root folder, Current_Location equals the project root.
- **File_List**: The GitHub-style list rendered in the main area when Current_Location is a folder. Columns: Name, Last updated, Size, By.
- **Single_File_View**: The view that replaces the File_List when a file is opened. Shows a metadata strip (size, version, updated, type), Raw/Edit actions, and the file content (text editor for text files, asset preview for images/video/audio/PDF/markdown).
- **Metadata_Strip**: The header block inside the Single_File_View that displays the currently-viewed file's metadata (name, size, version, last-updated timestamp, last-updated-by, MIME type).
- **Selection**: The single Project_Node that is currently selected in the Sidebar_Tree and/or File_List. There is at most one Selection at a time in the browsing flow.
- **Deep_Link_Path**: A slash-separated path string provided via the `?path=` URL query parameter. Example: `?path=src/components/Foo.tsx`.
- **Role_Owner**: A user who owns the project. Has full read/write access to the Files_Tab.
- **Role_Member**: A user who is a member of the project. Has full read/write access to the Files_Tab.
- **Role_Viewer**: A user with read-only access (including unauthenticated viewers of a public project). Can browse, view, and download files; cannot upload, create, rename, delete, or move.
- **Git_Enabled_Project**: A project where git integration is connected (`filesFeatureFlags.wave4GitIntegration` is true and a repo is linked for the project).
- **Version_Pill**: A small badge rendered next to a file name when `currentVersion > 1`, showing "v{currentVersion}".
- **Change_Indicator**: A single-letter dot badge (M, A, or D) rendered next to a file row when Git_Enabled_Project is true and the file has an unpushed change status.
- **Quick_Open**: The ⌘P / Ctrl+P fuzzy-file-finder dialog. Opens a searchable overlay listing files in the project.
- **Favorite**: A file or folder that the user has starred. Favorites are persisted per project in the workspace store.
- **Recent**: A file that the user has recently opened. Recents are persisted in localStorage per project.

## Requirements

### Requirement 1: GitHub-inspired Files Tab Layout

**User Story:** As a project owner, I want the Files tab to look and behave like GitHub's Code tab, so that browsing files feels familiar, lightweight, and uncluttered.

#### Acceptance Criteria

1. WHILE the Sidebar_Tree is visible, THE Files_Tab SHALL render a two-column layout consisting of a left Sidebar_Tree column and a right main area column.
2. THE Files_Tab SHALL render a Breadcrumb_Bar as the topmost element of the main area that displays the path segments of Current_Location from the project root to Current_Location.
3. IF Current_Location resolves to a folder, THEN THE Files_Tab SHALL render a File_List in the main area containing exactly four columns in left-to-right order: Name, Last updated, Size, By.
4. IF Current_Location resolves to a folder that contains zero entries, THEN THE Files_Tab SHALL render the File_List with its column headers visible and display an empty-state indicator in place of list rows.
5. IF Current_Location resolves to a file, THEN THE Files_Tab SHALL render a Single_File_View in the main area in place of the File_List.
6. THE Files_Tab SHALL render exactly one file in the Single_File_View at any given time.
7. WHILE the Sidebar_Tree is collapsed, THE Files_Tab SHALL hide the left column entirely and render the Breadcrumb_Bar and the main area content (File_List or Single_File_View) at the full width of the Files_Tab.
8. IF Current_Location does not resolve to a valid folder or file, THEN THE Files_Tab SHALL render an error indicator in the main area indicating the location could not be found and SHALL preserve the Sidebar_Tree in its current expanded or collapsed state.

### Requirement 2: Sidebar Tree

**User Story:** As a project member, I want a thin collapsible tree sidebar, so that I can navigate the folder hierarchy without the current heavy IDE-style explorer.

#### Acceptance Criteria

1. THE Sidebar_Tree SHALL render Project_Nodes in a hierarchical indented list with uniform non-zero indentation per nesting level, and SHALL render a visible expand/collapse affordance on every folder node whose state reflects whether that folder's children are currently visible in the tree.
2. WHEN the user changes the value of the Sidebar_Tree's inline search input, THE Sidebar_Tree SHALL filter visible Project_Nodes such that only nodes whose name contains the input value as a case-insensitive substring, together with all ancestor folders of those nodes, remain visible.
3. WHILE the Sidebar_Tree's inline search input value is empty, THE Sidebar_Tree SHALL render all Project_Nodes honoring the current expand/collapse state of each folder without applying any filter.
4. WHEN the user activates the collapse control, THE Files_Tab SHALL hide the Sidebar_Tree and render the main area at the full horizontal width of the Files_Tab content region.
5. WHEN the user activates the expand control while the Sidebar_Tree is hidden, THE Files_Tab SHALL render the Sidebar_Tree at a fixed width of 280 pixels.
6. THE Sidebar_Tree SHALL have a fixed width of 280 pixels whenever visible.
7. THE Files_Tab SHALL NOT render a drag handle or any other user-driven control for resizing the Sidebar_Tree width.
8. WHEN the user clicks a folder node in the Sidebar_Tree, THE Files_Tab SHALL set Current_Location to that folder.
9. WHEN the user clicks a folder node in the Sidebar_Tree, THE Sidebar_Tree SHALL expand the folder and render its direct children below the folder row.
10. WHEN the user clicks a file node in the Sidebar_Tree, THE Files_Tab SHALL set Current_Location to that file and render the Single_File_View.

### Requirement 3: Breadcrumb Navigation

**User Story:** As a project viewer, I want clickable breadcrumbs that mirror the current folder, so that I can jump back to any ancestor folder in one click.

#### Acceptance Criteria

1. THE Breadcrumb_Bar SHALL render Breadcrumb_Path segments from the project root to Current_Location, separated by a visible "/" character between segments.
2. WHILE Current_Location resolves to a folder, THE Breadcrumb_Bar SHALL render the root segment followed by every ancestor folder segment followed by the Current_Location folder segment as the final entry.
3. IF Current_Location resolves to a file, THEN THE Breadcrumb_Bar SHALL render the root segment followed by every ancestor folder segment followed by the file name segment as the final entry, and THE file name segment SHALL NOT be clickable.
4. WHEN the user clicks a folder segment in the Breadcrumb_Bar, THE Files_Tab SHALL set Current_Location to that folder within 200 milliseconds.
5. WHEN the user clicks the root segment in the Breadcrumb_Bar, THE Files_Tab SHALL set Current_Location to the project root within 200 milliseconds.
6. IF the Breadcrumb_Path contains more than 6 segments, THEN THE Breadcrumb_Bar SHALL display the first segment, an ellipsis affordance, and the last 4 segments, and SHALL expose the hidden segments via the ellipsis affordance.

### Requirement 4: File List

**User Story:** As a project member, I want a GitHub-style file list with name, last-updated, size, and author columns, so that I can scan a folder's contents quickly.

#### Acceptance Criteria

1. WHILE Current_Location resolves to a folder that contains between 1 and 1000 entries, THE File_List SHALL render one row per child Project_Node of Current_Location.
2. THE File_List SHALL render folder rows before file rows, and within each group SHALL sort alphabetically by name using case-insensitive comparison, with ties broken by the node `id` in ascending lexicographic order.
3. THE File_List SHALL render the following columns in left-to-right order: Name, Last updated, Size, By.
4. THE File_List SHALL render the "Last updated" column as a relative time string derived from `Project_Node.updatedAt` using the pattern "{N} {unit} ago" (for example "2 hours ago"), where unit is the largest unit of seconds, minutes, hours, days, weeks, months, or years whose count is at least 1, and SHALL render the column value as "—" when `updatedAt` is missing or null.
5. THE File_List SHALL render the "Size" column for files as a human-readable byte string using the 1024-byte base with units B, KB, MB, GB, TB and one decimal place of precision (for example "12.4 KB"), and SHALL render the column as empty for folders.
6. THE File_List SHALL render the "By" column as the display name of the user who last updated the node, falling back to the user's username when no display name is set, and "—" when no updater is recorded or when the recorded updater no longer exists in the system.
7. WHEN the user clicks a folder row in the File_List, THE Files_Tab SHALL set Current_Location to that folder.
8. WHEN the user clicks a file row in the File_List, THE Files_Tab SHALL set Current_Location to that file and render the Single_File_View.
9. WHILE Current_Location resolves to a folder whose contents are being loaded, THE File_List SHALL render its column headers and a loading indicator in place of list rows.
10. IF loading the contents of Current_Location fails, THEN THE File_List SHALL render its column headers and an error indicator in place of list rows, and SHALL expose a retry affordance.

### Requirement 5: Single-File View

**User Story:** As a project member, I want a single-file view with a metadata strip and Raw/Edit actions, so that I can read, copy, or edit a file without juggling editor tabs.

#### Acceptance Criteria

1. WHILE Current_Location resolves to a file, THE Single_File_View SHALL render a Metadata_Strip containing the file's name, size formatted in the same human-readable byte style as the File_List (1024-byte base, one decimal), current version, last-updated timestamp formatted as an ISO 8601 string (for example "2026-05-10T14:23:00Z"), last-updated-by display name, and MIME type.
2. WHEN the user activates the "Raw" action, THE Single_File_View SHALL reveal the file's raw content as plain text or original bytes with no editor toolbars, no syntax highlighting, and no line numbers.
3. WHERE the current user has role Role_Owner or Role_Member, THE Single_File_View SHALL render an "Edit" action control.
4. WHERE the current user has role Role_Viewer, THE Single_File_View SHALL NOT render an "Edit" action control.
5. IF Current_Location resolves to a file whose MIME type matches image/*, video/*, audio/*, application/pdf, or whose extension is `.md` or `.markdown`, THEN THE Single_File_View SHALL render the corresponding asset preview below the Metadata_Strip using the existing preview component for that media kind.
6. IF Current_Location resolves to a file whose MIME type matches image/*, video/*, or audio/* and whose size is 0 bytes, THEN THE Single_File_View SHALL render a placeholder indicating the media is empty in place of the asset preview.
7. THE Single_File_View SHALL NOT render editor tabs, split panes, or a bottom console.
8. WHEN the user activates the "Edit" action, THE Single_File_View SHALL replace the read-only content view with an editable text editor loaded with the file's current content.
9. IF any metadata field required by criterion 1 is unavailable for Current_Location, THEN THE Single_File_View SHALL render "—" for that field in the Metadata_Strip and render the remaining available fields.

### Requirement 6: Tree ⇄ Breadcrumb ⇄ File List Synchronization

**User Story:** As a project member, I want the tree, breadcrumb, and file list to stay in sync no matter which one I click, so that my current location is unambiguous.

#### Acceptance Criteria

1. WHEN the user changes Current_Location through any surface (Sidebar_Tree, Breadcrumb_Bar, File_List, Quick_Open, or Deep_Link_Path), THE Files_Tab SHALL update the Sidebar_Tree highlight, the Breadcrumb_Bar, and the main-area content (File_List or Single_File_View) to reflect the new Current_Location within 200 milliseconds.
2. WHILE Current_Location resolves to a file, THE Sidebar_Tree SHALL render every ancestor folder of the file in the expanded state so the file is visible in the tree.
3. WHILE Current_Location resolves to a folder, THE Sidebar_Tree SHALL render every ancestor folder of that folder in the expanded state so the folder is visible in the tree.
4. IF the Breadcrumb_Path and the Sidebar_Tree highlight disagree about Current_Location for more than 200 milliseconds, THEN THE Files_Tab SHALL treat the condition as a defect and SHALL surface the inconsistency in a development-mode console warning.
5. FOR ALL sequences of navigation actions, THE Breadcrumb_Path segments SHALL equal the ancestor chain (root → ... → Current_Location) of the highlighted Sidebar_Tree node (tree ⇄ breadcrumb sync property, suitable for property-based testing).
6. IF a navigation surface requests a Current_Location that cannot be resolved to a Project_Node, THEN THE Files_Tab SHALL leave Current_Location unchanged and SHALL surface an error indicator in the main area.

### Requirement 7: File and Folder Operations

**User Story:** As a project owner, I want to upload, create, rename, delete, and move files and folders, so that I can maintain the project contents.

#### Acceptance Criteria

1. WHERE the current user has role Role_Owner or Role_Member, THE Files_Tab SHALL expose actions to upload a single file, upload a folder, create a new file, create a new folder, rename a node, delete a node, and move a node.
2. WHERE the current user has role Role_Viewer, THE Files_Tab SHALL NOT expose upload, create, rename, delete, or move actions.
3. WHEN the user drops one or more files onto a folder row in the File_List or onto a folder in the Sidebar_Tree, THE Files_Tab SHALL upload the dropped files into that folder.
4. WHEN the user renames a node via inline rename (F2) or a rename dialog, THE Files_Tab SHALL persist the new name and update the Sidebar_Tree, File_List, and Breadcrumb_Bar to reflect the new name without a page reload.
5. WHEN the user deletes an active node, THE Files_Tab SHALL confirm and move it to Trash. The 2026-08-31 approved redesign supersedes Open Question 3: Trash is a left-navigation collection. Each trashed item SHALL offer Restore and, for users with manage-files permission, Delete permanently. Permanent deletion SHALL review the affected items/versions/links, require distinct irreversible confirmation, retain shared storage objects, and preserve a retryable intent if storage cleanup fails. Cancellation SHALL leave the item unchanged.
6. WHEN the user moves a node to a new parent folder, THE Files_Tab SHALL persist the new parent and update the Sidebar_Tree and File_List to reflect the new location.
7. IF the current user lacks permission for a requested operation, THEN THE Files_Tab SHALL display an error toast and SHALL NOT mutate any Project_Node.
8. IF an upload (including drag-and-drop upload) fails due to a network or server error, THEN THE Files_Tab SHALL display an error toast describing the failure and SHALL require the user to retry manually without auto-retrying.
9. IF a rename, create, or move operation would produce a node whose name is empty, whose name contains a "/" character, or whose name is a duplicate of an existing sibling within the target parent folder, THEN THE Files_Tab SHALL reject the operation, display an error toast describing the violation, and SHALL NOT mutate any Project_Node.
10. IF the user attempts to move a folder into itself or into any of its descendants, THEN THE Files_Tab SHALL reject the operation, display an error toast describing the violation, and SHALL NOT mutate any Project_Node.

### Requirement 8: Favorites and Recents

**User Story:** As a project member, I want to star frequently-used files and see my recently-opened files, so that I can return to important files quickly.

#### Acceptance Criteria

1. THE Files_Tab SHALL render a star toggle control on every Project_Node row in the Sidebar_Tree and File_List, where the control is rendered as a filled star icon when the node is a Favorite and as an outlined star icon otherwise.
2. WHEN the user clicks the star toggle on a node, THE Files_Tab SHALL add the node to Favorites if not currently favorited, and SHALL remove the node from Favorites if currently favorited, and SHALL update the star icon to reflect the new state.
3. WHEN Favorites change, THE Files_Tab SHALL persist Favorites per project via the workspace store.
4. WHEN the user opens a file, THE Files_Tab SHALL record the file as a Recent for the current project such that the file appears at the top of the Recents list and appears exactly once in the list.
5. THE Files_Tab SHALL persist Recents per project in localStorage under the key `files-recent-open:{projectId}`, capped at 50 entries, evicting the oldest entries first when the cap would be exceeded.
6. WHEN the Files_Tab mounts for a project, THE Files_Tab SHALL restore Favorites from the workspace store and Recents from the localStorage key `files-recent-open:{projectId}`.
7. IF persisting Favorites or Recents fails due to localStorage unavailability or a quota error, THEN THE Files_Tab SHALL continue to function in-memory for the current session and SHALL NOT surface a modal error.

### Requirement 9: Quick Open

**User Story:** As a power user, I want to jump to any file by fuzzy name with ⌘P, so that I do not have to traverse folders manually.

#### Acceptance Criteria

1. WHEN the user presses ⌘P on macOS or Ctrl+P on non-macOS while the Quick_Open dialog is closed, THE Files_Tab SHALL open the Quick_Open dialog; WHEN the user presses the same shortcut while the Quick_Open dialog is already open, THE Files_Tab SHALL close the Quick_Open dialog without changing Current_Location.
2. WHILE the Quick_Open dialog is open and the search input is empty, THE Quick_Open dialog SHALL display up to 20 Recents for the current project, most-recent first, and SHALL display an empty-state indicator if Recents is empty.
3. WHEN the user types into the Quick_Open search input and the input length is between 1 and 256 characters, THE Quick_Open dialog SHALL rank files by fuzzy match against name and path within 200 milliseconds of the last keystroke and display up to 50 results, and SHALL display a no-results indicator when no file matches.
4. WHEN the user presses ArrowDown or ArrowUp while the Quick_Open dialog is open, THE Quick_Open dialog SHALL move the result-list focus to the next or previous result respectively, wrapping from last to first and first to last, and SHALL scroll the focused result into view.
5. WHEN the user selects a file in the Quick_Open dialog by Enter or mouse click, THE Files_Tab SHALL set Current_Location to that file, render the Single_File_View with the appropriate asset preview or editor based on the file's MIME type (per Requirement 13), and close the dialog.
6. IF the file selected in the Quick_Open dialog cannot be resolved to an existing Project_Node, THEN THE Quick_Open dialog SHALL display an error indicator inside the dialog, SHALL leave Current_Location unchanged, and SHALL remain open.
7. WHEN the user presses Escape while the Quick_Open dialog is open, THE Files_Tab SHALL close the dialog, discard the search input, and leave Current_Location unchanged.

### Requirement 10: Deep Linking via URL Query Parameter

**User Story:** As a user arriving via a shared link, I want the Files tab to open directly at the referenced file or folder, so that I land exactly where the sender intended.

#### Acceptance Criteria

1. WHEN the Files_Tab mounts and the URL query string contains `path=` with a non-empty URL-decoded value whose length is at most 4096 characters, THE Files_Tab SHALL resolve the Deep_Link_Path (URL-decoded and with leading and trailing whitespace trimmed) to a Project_Node in the current project after the project's root node listing has loaded.
2. WHEN the resolved Project_Node is a folder, THE Files_Tab SHALL set Current_Location to that folder and expand every ancestor folder of that folder in the Sidebar_Tree.
3. WHEN the resolved Project_Node is a file, THE Files_Tab SHALL set Current_Location to that file, render the Single_File_View, and expand every ancestor folder of that file in the Sidebar_Tree.
4. WHEN the user changes Current_Location through any surface, THE Files_Tab SHALL update the URL via `history.replaceState` so that `?path=` reflects the new Current_Location and no new browser history entry is pushed.
5. IF the Deep_Link_Path cannot be resolved to an existing Project_Node, OR IF the URL-decoded `path=` value is empty, OR IF the URL-decoded `path=` value exceeds 4096 characters, THEN THE Files_Tab SHALL leave Current_Location at the project root, render an inline error state in the main area identifying that the deep link target could not be found, and log the resolution failure to the browser console.

### Requirement 11: Version Pills

**User Story:** As a project member, I want to see a version badge on files that have multiple versions, so that I can tell at a glance which files have history.

#### Acceptance Criteria

1. WHILE a Project_Node is of type "file" and `currentVersion` is an integer greater than 1, THE File_List SHALL render a Version_Pill immediately adjacent to the file name with the text `v{currentVersion}` (for example `v2`).
2. IF a Project_Node is of type "file" and `currentVersion` is missing, null, undefined, zero, negative, or equal to 1, THEN THE File_List SHALL NOT render a Version_Pill for that node.
3. WHILE Current_Location resolves to a file whose `currentVersion` is an integer greater than 1, THE Metadata_Strip SHALL display the version value using the text format `v{currentVersion}`.
4. IF a Project_Node is not of type "file", THEN THE File_List SHALL NOT render a Version_Pill for that node.

### Requirement 12: Git Change Indicators

**User Story:** As a project member working with git, I want to see which files have local modifications, so that I can find pending changes without opening a separate Source Control panel.

#### Acceptance Criteria

1. WHERE the project is a Git_Enabled_Project, THE File_List SHALL render a Change_Indicator on each file row whose git status is "modified" (M), "added" (A), or "deleted" (D), using a distinct visual treatment per status so that M, A, and D are unambiguously distinguishable from each other.
2. WHERE the project is not a Git_Enabled_Project, THE File_List SHALL NOT render any Change_Indicator.
3. THE Files_Tab SHALL NOT render a dedicated Source Control panel as part of the new Files_Tab design.
4. WHEN git status for a file in the current File_List changes, THE File_List SHALL refresh the rendered Change_Indicator for that file within 2 seconds of the status change being observed by the Files_Tab.
5. IF git status cannot be retrieved (network error, timeout, or git integration unavailable), THEN THE File_List SHALL render no Change_Indicator on any row and SHALL NOT block the rendering of other File_List columns.
6. IF a file's git status is any value other than "modified", "added", or "deleted", THEN THE File_List SHALL NOT render a Change_Indicator on that file row.

### Requirement 13: Asset Preview

**User Story:** As a project viewer, I want images, videos, audio, PDFs, and markdown to preview inline, so that I can review assets without downloading them.

#### Acceptance Criteria

1. WHEN Current_Location is a file whose MIME type matches the pattern `image/*` or whose extension is one of `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico`, THE Single_File_View SHALL render the image using the existing image preview component.
2. WHEN Current_Location is a file whose MIME type matches the pattern `video/*` or whose extension is one of `.mp4`, `.webm`, `.mov`, `.ogg`, THE Single_File_View SHALL render the video using the existing video preview component.
3. WHEN Current_Location is a file whose MIME type matches the pattern `audio/*` or whose extension is one of `.mp3`, `.wav`, `.ogg`, `.m4a`, `.flac`, THE Single_File_View SHALL render the audio player using the existing audio preview component.
4. WHEN Current_Location is a file whose MIME type equals `application/pdf` or whose extension is `.pdf`, THE Single_File_View SHALL render the PDF using the existing PDF preview component.
5. WHEN Current_Location is a file whose extension is `.md` or `.markdown`, THE Single_File_View SHALL render the rendered markdown using the existing markdown preview component, and SHALL also expose the Raw action to view the unrendered source.
6. IF the asset preview component fails to load the file content (network error, unsupported codec, or corrupted data), THEN THE Single_File_View SHALL display an error indicator in place of the preview and SHALL keep the Metadata_Strip and Raw action visible.

### Requirement 14: Keyboard Accessibility

**User Story:** As a keyboard-first user, I want to navigate the tree with arrow keys, rename with F2, and delete with Delete, so that I do not need to reach for the mouse.

#### Acceptance Criteria

1. WHEN the Sidebar_Tree has focus and the user presses ArrowDown, THE Sidebar_Tree SHALL move focus to the next visible node within 200 milliseconds, and SHALL leave focus on the current node if it is the last visible node.
2. WHEN the Sidebar_Tree has focus and the user presses ArrowUp, THE Sidebar_Tree SHALL move focus to the previous visible node within 200 milliseconds, and SHALL leave focus on the current node if it is the first visible node.
3. WHEN the focused node in the Sidebar_Tree is a collapsed folder and the user presses ArrowRight, THE Sidebar_Tree SHALL expand the folder within 200 milliseconds and SHALL retain focus on that folder.
4. WHEN the focused node in the Sidebar_Tree is an expanded folder and the user presses ArrowLeft, THE Sidebar_Tree SHALL collapse the folder within 200 milliseconds and SHALL retain focus on that folder.
5. WHEN the focused node in the Sidebar_Tree is a file or a collapsed folder and the user presses ArrowLeft, THE Sidebar_Tree SHALL move focus to the parent folder within 200 milliseconds, and SHALL retain focus on the current node if the node is at the root level.
6. WHEN the focused node in the Sidebar_Tree is a file and the user presses Enter, THE Files_Tab SHALL set Current_Location to that file.
7. WHEN the focused node in the Sidebar_Tree is a folder and the user presses Enter, THE Sidebar_Tree SHALL toggle expansion of the folder within 200 milliseconds and SHALL retain focus on that folder.
8. WHILE the current user has role Role_Owner or Role_Member, WHEN the focused node in the Sidebar_Tree is a node and the user presses F2, THE Files_Tab SHALL initiate inline rename on that node.
9. WHILE the current user has role Role_Owner or Role_Member, WHEN the focused node in the Sidebar_Tree is a node and the user presses Delete, THE Files_Tab SHALL open the delete confirmation for that node.
10. WHEN the Sidebar_Tree first receives focus and no node was previously focused in the Sidebar_Tree, THE Sidebar_Tree SHALL place focus on the first visible node within 200 milliseconds.
11. WHILE the current user has role Role_Viewer, WHEN the user presses F2 with a Sidebar_Tree node focused, THE Files_Tab SHALL NOT initiate inline rename and SHALL retain focus on the current node.
12. WHILE the current user has role Role_Viewer, WHEN the user presses Delete with a Sidebar_Tree node focused, THE Files_Tab SHALL NOT open a delete confirmation and SHALL retain focus on the current node.

### Requirement 15: Explicit Removals

**User Story:** As a project owner, I want the heavy mini-IDE surfaces removed from the Files tab, so that the tab is lightweight and focused on browsing and viewing.

#### Acceptance Criteria

1. THE Files_Tab SHALL NOT render a bottom console panel.
2. THE Files_Tab SHALL NOT render a Run tab, an Output tab, or a Problems tab.
3. THE Files_Tab SHALL NOT import or mount any module under `src/lib/runner/`, including Pyodide runner, JavaScript runner, TypeScript runner, SQL runner, Java configuration, browser sandbox, backend router, `runFile.ts`, `prefs.ts`, `types.ts`, `contracts.ts`, and `local-analyzer.ts`.
4. THE Files_Tab SHALL NOT invoke `useLintOnEdit`.
5. THE Files_Tab SHALL NOT invoke `parseStderrToProblems`.
6. THE Files_Tab SHALL NOT render a "Fix" affordance on any diagnostic, and THE `Problem` type used by the Files_Tab SHALL NOT carry a `fix` field.
7. THE Files_Tab SHALL NOT read or write any of the following keys on the files workspace store: `stdinInputText`, `lastExecutionOutput`, `lastExecutionSettingsHref`, `bottomPanelTab`, `bottomPanelCollapsed`, `bottomPanelHeight`.
8. THE Files_Tab SHALL NOT render split editor panes.
9. THE Files_Tab SHALL NOT render draggable editor tabs, tab-pinning affordances, "close others", or "close to right" actions.
10. THE Files_Tab SHALL NOT expose Zen mode.
11. WHEN the user presses Cmd+K on macOS or Ctrl+K on non-macOS while the Files_Tab is active, THE Files_Tab SHALL NOT open a command palette or any dialog.
12. THE Files_Tab SHALL NOT render a keyboard-shortcut dialog.
13. THE Files_Tab SHALL NOT import or mount `useCursorPresence` or `cursorProtocol`.
14. THE Files_Tab SHALL NOT render a sidebar-resize drag handle, and THE Sidebar_Tree width SHALL remain fixed at 280 pixels whenever the Sidebar_Tree is visible.
15. THE Files_Tab SHALL NOT render an Outline panel.
16. THE Files_Tab SHALL NOT render a Source Control panel.
17. THE Files_Tab SHALL NOT render an Insights panel.
18. THE Files_Tab SHALL NOT render a Saved Views UI, and SHALL NOT invoke `applySavedView`, `saveCurrentView`, or `deleteSavedView` on the files workspace store.
19. IF the files workspace store contains legacy persisted state for any removed feature (including `stdinInputText`, `lastExecutionOutput`, `lastExecutionSettingsHref`, `bottomPanelTab`, `bottomPanelCollapsed`, `bottomPanelHeight`, or `savedViews`), THEN THE Files_Tab SHALL ignore that state and SHALL NOT mount any removed feature based on its presence.

### Requirement 16: Performance Budget on Initial Mount

**User Story:** As a project owner, I want the Files tab to open faster than today, so that I can start browsing immediately.

#### Acceptance Criteria

1. WHEN the Files_Tab mount lifecycle begins and until the Files_Tab reaches its first interactive state, THE Files_Tab SHALL NOT load any JavaScript module whose file path is under `src/lib/runner/`.
2. WHEN the Files_Tab mount lifecycle begins and until the Files_Tab is unmounted, THE Files_Tab SHALL NOT mount a `BottomPanel` component or any of its child components (`RunTab`, `OutputTab`, `ProblemsTab`, `RunnerStatusStrip`).
3. WHEN the Files_Tab mount lifecycle begins and until the user performs the first edit event in an editable Single_File_View, THE Files_Tab SHALL NOT start any lint-on-edit timer, scheduler, or subscription.
4. WHEN the Files_Tab mount lifecycle begins, THE Files_Tab SHALL transition `startupStage` through the states "explorer" → "main" → "diagnostics" in order, and the Sidebar_Tree and the Breadcrumb_Bar SHALL reach an interactive state at or before the "main" state transition while git status and diagnostics fetches SHALL begin at or after the "diagnostics" state transition.
5. WHEN the Files_Tab mount lifecycle begins for a project containing at most 1000 Project_Nodes, THE Sidebar_Tree SHALL reach an interactive state within 500 milliseconds of mount start and THE Breadcrumb_Bar SHALL reach an interactive state within 750 milliseconds of mount start.
6. IF the transition to any `startupStage` state does not complete within 5 seconds, THEN THE Files_Tab SHALL advance to the next `startupStage` state, surface a non-blocking error indication, and preserve any state already established in previous stages.

### Requirement 17: Bug Fix — Metadata Stale on Close

**User Story:** As a project member, I want the metadata area to reflect what I am actually looking at, so that I am never shown stale information for a file I already closed.

#### Acceptance Criteria

1. WHEN Current_Location changes from a file to a folder, THE Metadata_Strip SHALL not be present in the rendered output within 100 milliseconds of the change, such that no metadata field values are observable in the rendered view.
2. WHEN Current_Location changes from one file to a different file, THE Metadata_Strip SHALL display metadata whose `nodeId` equals the `id` of the new Current_Location file within 100 milliseconds of the change.
3. WHILE Current_Location references a file and the Metadata_Strip is rendered, THE Metadata_Strip SHALL display only metadata whose `nodeId` equals the `id` of Current_Location.
4. WHEN Current_Location changes from one file to a different file, THE Files_Tab SHALL ensure that no metadata field values from the previous file are observable in the Metadata_Strip after the change has been applied.

### Requirement 18: End-to-End Functional Verification Audit

**User Story:** As a project owner, I want every remaining Files-tab feature verified end-to-end and any discovered malfunction fixed, so that shipping the redesign does not regress working behavior.

#### Acceptance Criteria

1. BEFORE this spec is marked complete, THE implementation team SHALL execute an end-to-end functional verification of the Files_Tab covering each of the following discrete areas and SHALL record the verification result per area as one of `pass`, `fail`, or `not_applicable` with a timestamp and tester identity: single file upload; folder upload; drag-and-drop upload onto Sidebar_Tree folders; drag-and-drop upload onto File_List folder rows; inline rename; rename-via-dialog; soft delete; permanent delete; move; favorites toggle; Recents list correctness; version history display; git Change_Indicator correctness for "modified"; git Change_Indicator correctness for "added"; git Change_Indicator correctness for "deleted"; Breadcrumb_Bar navigation clicking root segment; Breadcrumb_Bar navigation clicking intermediate segments; Sidebar_Tree mouse expand; Sidebar_Tree mouse collapse; Sidebar_Tree keyboard expand (ArrowRight); Sidebar_Tree keyboard collapse (ArrowLeft); Sidebar_Tree inline search; Single_File_View Raw toggle; Single_File_View Edit toggle; Single_File_View save; Deep_Link_Path resolution via `?path=`; URL synchronization via `history.replaceState` when Current_Location changes.
2. WHEN a verification area produces a `fail` result, THE implementation team SHALL document the defect (summary, reproduction steps, severity) in the spec's task list and SHALL ship a fix as part of this spec.
3. IF a verification area is not applicable to the current build (for example, git Change_Indicator areas on a non-Git_Enabled_Project fixture), THEN THE implementation team SHALL record the area as `not_applicable` with a justification and SHALL exclude it from release-gate considerations.
4. THE Files_Tab SHALL NOT be considered ready for release while any verification area remains unverified (no `pass`, `fail`, or `not_applicable` result recorded) or while any documented defect from the verification audit remains unresolved.
5. THE implementation team SHALL retain the verification record such that it can be reproduced by a reviewer before the spec is marked complete.

### Requirement 19: Role-Based Access and Deep-Link Arrival

**User Story:** As a Role_Viewer or an unauthenticated visitor arriving via a deep link, I want to browse and view files but be blocked from mutations, so that I see exactly what I am allowed to see and nothing extra.

#### Acceptance Criteria

1. WHERE the current user has role Role_Owner, THE Files_Tab SHALL expose every browse, view, and mutation action defined in Requirements 2 through 14.
2. WHERE the current user has role Role_Member, THE Files_Tab SHALL expose every browse, view, and mutation action defined in Requirements 2 through 14.
3. WHERE the current user has role Role_Viewer, THE Files_Tab SHALL expose every browse and view action, and THE mutation controls (upload, create, rename, delete, move, Edit) SHALL NOT be visible, focusable, or activatable in the Files_Tab.
4. WHEN a user with role Role_Viewer arrives via a Deep_Link_Path, THE Files_Tab SHALL resolve the Deep_Link_Path within 2 seconds of page load, set Current_Location, render the Single_File_View or File_List in read-only mode, and SHALL NOT render any mutation controls.
5. IF a user arrives via a Deep_Link_Path and lacks access to the project, THEN THE Files_Tab SHALL render the project's standard access-denied state and SHALL NOT disclose the Deep_Link_Path target name, path, file content, or metadata, and SHALL set Current_Location to no Project_Node.
6. IF the current user with role Role_Viewer attempts a mutation action through any channel (keyboard shortcut, programmatic invocation, URL manipulation, or direct server-action call), THEN THE Files_Tab and its server actions SHALL reject the mutation and return an authorization error.
7. IF an unauthenticated visitor arrives via a Deep_Link_Path to a project that requires authentication, THEN THE Files_Tab SHALL redirect to the sign-in flow and SHALL NOT render the Deep_Link_Path target name, path, file content, or metadata prior to authentication.
8. IF the Deep_Link_Path is malformed (for example, contains invalid characters or exceeds 4096 characters after URL-decoding) or resolves to no Project_Node, THEN THE Files_Tab SHALL behave per Requirement 10.5.

### Requirement 20: Navigation State Consistency

**User Story:** As a user, I want my navigation history to be consistent, so that refreshing the page or following my own URL always lands me where I was.

#### Acceptance Criteria

1. WHEN Current_Location is set to a Project_Node, THE Files_Tab SHALL update the URL `?path=` query parameter within 500 milliseconds such that `findNodeByPathAny` applied to the updated `?path=` value returns a Project_Node whose id equals Current_Location's id.
2. WHEN the page is refreshed while the URL contains a `?path=` query parameter that resolves via `findNodeByPathAny` to a Project_Node, THE Files_Tab SHALL set Current_Location to that Project_Node within 2 seconds of page load completing.
3. WHEN the user navigates back or forward in browser history to an entry whose `?path=` query parameter resolves via `findNodeByPathAny` to a Project_Node, THE Files_Tab SHALL set Current_Location to that Project_Node within 500 milliseconds of the browser history navigation event.
4. IF the URL `?path=` query parameter on page load or browser history navigation does not resolve via `findNodeByPathAny` to any Project_Node, THEN THE Files_Tab SHALL set Current_Location to the project root Project_Node and display an error indication to the user that the requested path was not found.

### Requirement 21: Out-of-Scope Constraints

**User Story:** As a project owner, I want the spec scope locked to the Files tab, so that the redesign ships without creeping into unrelated surfaces.

#### Acceptance Criteria

1. THE Files_Tab SHALL NOT render any UI control that initiates code execution, including Run buttons, Run keyboard shortcuts, code-cell execute affordances, or scheduled runner entry points.
2. THE Files_Tab SHALL NOT render a terminal emulator, a shell prompt, or any command-input surface bound to a shell or subprocess.
3. THE Files_Tab SHALL NOT render a REPL, defined as an input/output panel that evaluates user-entered expressions against a live interpreter.
4. THE Files_Tab SHALL NOT render language-specific settings or configuration UI controls for Python, JavaScript, TypeScript, SQL, or Java, including linter configuration, formatter configuration, runtime selection, or interpreter selection.
5. THE Files_Tab SHALL NOT render remote-user cursors, remote-user selection highlights, or remote-user presence indicators.
6. THE Files_Tab SHALL NOT render AI-assisted editing surfaces, including inline AI completion suggestions, AI chat panels bound to the editor, AI refactor actions, or AI-generated diff proposals.
7. THE implementation of this spec SHALL NOT add, remove, or rename any UI surface, route, component, or persisted data field of the Tasks tab or of any other project tab outside the Files_Tab, and SHALL NOT alter the observable runtime behavior of those surfaces.
8. IF a change to a shared module (store, utility, schema, server action) is required to implement this spec, THEN THE change SHALL preserve the public API and observable runtime behavior of the module as consumed by the Tasks tab and any other project tab outside the Files_Tab.

## Correctness Properties (for property-based testing)

These properties are called out explicitly so they can be exercised via property-based tests during the design phase:

- **Tree ⇄ Breadcrumb Sync (Requirement 6.5)**: For any sequence of navigation actions, the Breadcrumb_Path segments equal the ancestor chain (root → ... → current) of the highlighted Sidebar_Tree node.
- **Metadata Matches Selection Invariant (Requirement 17.3)**: Whenever the Single_File_View is rendered, the `nodeId` backing the Metadata_Strip equals the `id` of Current_Location.
- **URL ⇄ State Round-Trip (Requirement 20.1)**: For any Current_Location, encoding it into `?path=` and decoding it back via `findNodeByPathAny` yields a Project_Node with the same id.
- **Navigation State Consistency on Refresh (Requirement 20.2)**: For any sequence of navigation actions, refreshing the page restores Current_Location to the value it held immediately before the refresh.
