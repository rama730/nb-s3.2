// Files Tab role context. Owns the single source of truth for the current
// user's role within the Files tab and the derived `canEdit` gate.
//
// Consumers: `FileActionsBar`, `FolderListRow`, `FilesTabSidebar` context-menu
// items (upload, create, rename, delete, move, Edit). For `Role_Viewer`,
// mutation controls MUST NOT be visible, focusable, or activatable
// (Req 19.3); F2 / Delete keys must be no-ops (Req 14.11–14.12).
//
// See requirements.md § Req 7.1–7.2, 14.11–14.12, 19.1–19.3 and
// design.md § FilesTabRoot / § FileActionsBar.
"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

export type Role = "Role_Owner" | "Role_Member" | "Role_Viewer";

export interface FilesTabRoleContextValue {
  role: Role;
  canEdit: boolean;
}

/**
 * React context carrying the current user's Files-tab role and derived
 * `canEdit` flag. `null` when no `FilesTabRoleProvider` is mounted — in that
 * case, `useFilesTabRole()` throws rather than silently returning a
 * permissive default (viewer-safe by construction).
 */
export const FilesTabRoleContext =
  createContext<FilesTabRoleContextValue | null>(null);

export interface FilesTabRoleProviderProps {
  role: Role;
  canEdit: boolean;
  children: ReactNode;
}

/**
 * Provides the Files-tab role context to descendants. Callers are expected
 * to derive `role` from the upstream `isOwnerOrMember` + authenticated-user
 * state (see `FilesTabRoot`), and to pass `canEdit = role !== "Role_Viewer"`.
 *
 * The provider does not enforce that relationship (both values are inputs),
 * so callers stay in control of the derivation — useful for tests that want
 * to pin a specific combination.
 */
export function FilesTabRoleProvider({
  role,
  canEdit,
  children,
}: FilesTabRoleProviderProps): React.JSX.Element {
  const value = useMemo<FilesTabRoleContextValue>(
    () => ({ role, canEdit }),
    [role, canEdit],
  );
  return (
    <FilesTabRoleContext.Provider value={value}>
      {children}
    </FilesTabRoleContext.Provider>
  );
}

/**
 * Hook returning the current Files-tab role and `canEdit` flag. Throws when
 * used outside a `FilesTabRoleProvider` so accidental omissions fail loudly
 * rather than degrading to an ambiguous permissive or restrictive default.
 */
export function useFilesTabRole(): FilesTabRoleContextValue {
  const value = useContext(FilesTabRoleContext);
  if (value === null) {
    throw new Error(
      "useFilesTabRole must be used within a FilesTabRoleProvider",
    );
  }
  return value;
}
