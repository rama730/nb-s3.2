import type { StateCreator } from "zustand";
import type { FilesWorkspaceState, GitState } from "./types";
import { defaultWorkspace, DEFAULT_GIT_STATE } from "./types";

export interface GitSlice {
  setGitRepo: (projectId: string, repoUrl: string, branch: string) => void;
  setGitSyncStatus: (projectId: string, inProgress: boolean) => void;
  setGitBranch: (projectId: string, branch: string) => void;
  setGitChangedFiles: (projectId: string, files: GitState["changedFiles"]) => void;
  setGitCommitMessage: (projectId: string, message: string) => void;
  setGitBranches: (projectId: string, branches: string[]) => void;
  setGitLastSync: (projectId: string, syncAt: string, commitSha: string) => void;
  setGitStatusLoaded: (projectId: string, loaded: boolean) => void;
  clearGitState: (projectId: string) => void;
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

  setGitSyncStatus: (projectId, inProgress) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            git: { ...ws.git, syncInProgress: inProgress },
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

  setGitCommitMessage: (projectId, message) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            git: { ...ws.git, commitMessage: message },
          },
        },
      };
    }),

  setGitBranches: (projectId, branches) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            git: { ...ws.git, branches },
          },
        },
      };
    }),

  setGitLastSync: (projectId, syncAt, commitSha) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            git: { ...ws.git, lastSyncAt: syncAt, lastCommitSha: commitSha },
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

  clearGitState: (projectId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            git: { ...DEFAULT_GIT_STATE, gitStatusLoaded: true },
          },
        },
      };
    }),
});
