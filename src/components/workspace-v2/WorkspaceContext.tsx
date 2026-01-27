"use client";

import { createContext, useContext, useState, ReactNode, useEffect } from "react";

type WorkspaceMode = "focus" | "triage" | "scratchpad" | "context";

interface WorkspaceState {
    isOpen: boolean;
    isExpanded: boolean;
    mode: WorkspaceMode;
    toggleOpen: () => void;
    toggleExpanded: () => void;
    setExpanded: (expanded: boolean) => void;
    setOpen: (open: boolean) => void;
    setMode: (mode: WorkspaceMode) => void;
    activeTaskId: string | null;
    setActiveTask: (id: string | null) => void;
}

const WorkspaceContext = createContext<WorkspaceState | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [mode, setMode] = useState<WorkspaceMode>("focus");
    const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Cmd + / to toggle panel
            if ((e.metaKey || e.ctrlKey) && e.key === "/") {
                e.preventDefault();
                setIsOpen((prev) => !prev);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    const toggleOpen = () => setIsOpen((prev) => !prev);
    const toggleExpanded = () => setIsExpanded((prev) => !prev);

    return (
        <WorkspaceContext.Provider
            value={{
                isOpen,
                isExpanded,
                mode,
                toggleOpen,
                toggleExpanded,
                setExpanded: setIsExpanded,
                setOpen: setIsOpen,
                setMode,
                activeTaskId,
                setActiveTask: setActiveTaskId,
            }}
        >
            {children}
        </WorkspaceContext.Provider>
    );
}

export function useWorkspace() {
    const context = useContext(WorkspaceContext);
    if (context === undefined) {
        throw new Error("useWorkspace must be used within a WorkspaceProvider");
    }
    return context;
}
