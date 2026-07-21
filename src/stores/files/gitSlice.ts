import type { StateCreator } from "zustand";
import type { FilesWorkspaceState, GitState } from "./types";
import { defaultWorkspace } from "./types";

export interface GitSlice {
  setGitRepo: (projectId: string, repoUrl: string, branch: string) => void;
  setGitBranch: (projectId: string, branch: string) => void;
  setGitChangedFiles: (projectId: string, files: GitState["changedFiles"]) => void;
  setGitStatusLoaded: (projectId: string, loaded: boolean) => void;
}

export const createGitSlice: StateCreator<FilesWorkspaceState, [], [], GitSlice> = (set) => ({
  setGitRepo: (projectId, repoUrl, branch) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            git: { ...ws.git, repoUrl, branch },
          },
        },
      };
    }),

  setGitBranch: (projectId, branch) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            git: { ...ws.git, branch },
          },
        },
      };
    }),

  setGitChangedFiles: (projectId, files) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            git: { ...ws.git, changedFiles: files },
          },
        },
      };
    }),
  setGitStatusLoaded: (projectId, loaded) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            git: { ...ws.git, gitStatusLoaded: loaded },
          },
        },
      };
    }),
});
