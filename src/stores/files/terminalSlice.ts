import type { StateCreator } from "zustand";
import type { FilesWorkspaceState, TerminalSession } from "./types";
import { defaultWorkspace } from "./types";

const MAX_TERMINAL_LINES = 5_000;

export interface TerminalSlice {
  addTerminalSession: (projectId: string, session: TerminalSession) => void;
  removeTerminalSession: (projectId: string, sessionId: string) => void;
  setActiveTerminalSession: (projectId: string, sessionId: string | null) => void;
  appendTerminalOutput: (projectId: string, sessionId: string, line: string) => void;
  clearTerminalOutput: (projectId: string, sessionId: string) => void;
  setTerminalRunning: (projectId: string, sessionId: string, running: boolean) => void;
}

export const createTerminalSlice: StateCreator<FilesWorkspaceState, [], [], TerminalSlice> = (set) => ({
  addTerminalSession: (projectId, session) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            terminal: {
              ...ws.terminal,
              sessions: [...ws.terminal.sessions, session],
              activeSessionId: session.id,
            },
          },
        },
      };
    }),

  removeTerminalSession: (projectId, sessionId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      const nextSessions = ws.terminal.sessions.filter((s) => s.id !== sessionId);
      const nextActive =
        ws.terminal.activeSessionId === sessionId
          ? nextSessions[nextSessions.length - 1]?.id ?? null
          : ws.terminal.activeSessionId;
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            terminal: {
              sessions: nextSessions,
              activeSessionId: nextActive,
            },
          },
        },
      };
    }),

  setActiveTerminalSession: (projectId, sessionId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            terminal: { ...ws.terminal, activeSessionId: sessionId },
          },
        },
      };
    }),

  appendTerminalOutput: (projectId, sessionId, line) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            terminal: {
              ...ws.terminal,
              sessions: ws.terminal.sessions.map((s) => {
                if (s.id !== sessionId) return s;
                const next = s.output.length >= MAX_TERMINAL_LINES
                  ? [...s.output.slice(-Math.floor(MAX_TERMINAL_LINES * 0.8)), line]
                  : [...s.output, line];
                return { ...s, output: next };
              }),
            },
          },
        },
      };
    }),

  clearTerminalOutput: (projectId, sessionId) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            terminal: {
              ...ws.terminal,
              sessions: ws.terminal.sessions.map((s) =>
                s.id === sessionId ? { ...s, output: [] } : s
              ),
            },
          },
        },
      };
    }),

  setTerminalRunning: (projectId, sessionId, running) =>
    set((state) => {
      const ws = state.byProjectId[projectId] ?? defaultWorkspace();
      return {
        byProjectId: {
          ...state.byProjectId,
          [projectId]: {
            ...ws,
            terminal: {
              ...ws.terminal,
              sessions: ws.terminal.sessions.map((s) =>
                s.id === sessionId ? { ...s, isRunning: running } : s
              ),
            },
          },
        },
      };
    }),
});
