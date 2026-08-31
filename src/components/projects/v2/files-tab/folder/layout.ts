// Shared grid layout constants for `FolderListHeader` / `FolderListRow` /
// `FolderListStates`. Keeping them in one module prevents the template
// strings from drifting between the header and the body rows.
//
// Columns (left → right): Name, Last updated, Size, By.
// Widths per design.md § FolderListView / tasks.md § 5.1:
//   - Name         : flexible, min-width 320px
//   - Last updated : fixed 140px
//   - Size         : fixed 96px (right-aligned in the cell itself)
//   - By           : fixed 120px
//
// Row height: 40px (tasks.md § 5.1).

export const FOLDER_LIST_NAME_MIN_WIDTH_PX = 320;
export const FOLDER_LIST_UPDATED_WIDTH_PX = 140;
export const FOLDER_LIST_SIZE_WIDTH_PX = 96;
export const FOLDER_LIST_BY_WIDTH_PX = 120;
export const FOLDER_LIST_ROW_HEIGHT_PX = 48;

/**
 * CSS grid template used by both the header and each row. The Name column
 * uses `minmax(Npx, 1fr)` so it grows to fill remaining space while still
 * guaranteeing the 320px floor. The three trailing columns are fixed.
 */
export const FOLDER_LIST_GRID_TEMPLATE = `var(--files-columns, minmax(0, 1fr) ${FOLDER_LIST_UPDATED_WIDTH_PX}px ${FOLDER_LIST_SIZE_WIDTH_PX}px ${FOLDER_LIST_BY_WIDTH_PX}px 40px)`;
