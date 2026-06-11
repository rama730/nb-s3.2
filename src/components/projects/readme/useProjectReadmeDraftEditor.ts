"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import type { ProjectReadmeQualityReport } from "@/lib/projects/readme";

export type ProjectReadmeEditorSaveResult = {
    qualityReport: ProjectReadmeQualityReport;
    draftUpdatedAt: string | null;
    conflict?: boolean;
    serverDraftContent?: string;
};

export type ProjectReadmeEditorConflict = {
    serverDraftContent: string;
    serverDraftUpdatedAt: string | null;
};

export type ProjectReadmeDraftSaveState = "saved" | "dirty" | "saving" | "conflict";

type UseProjectReadmeDraftEditorInput = {
    projectId: string;
    initialContent: string;
    initialDraftUpdatedAt: string | null;
    initialQualityReport: ProjectReadmeQualityReport;
    onSave: (content: string, expectedDraftUpdatedAt: string | null) => Promise<ProjectReadmeEditorSaveResult | null>;
    autosaveDelayMs?: number;
};

function fallbackQualityReport(content: string): ProjectReadmeQualityReport {
    return {
        score: 0,
        issues: [],
        sectionPresence: {},
        contentBytes: new Blob([content]).size,
    };
}

export function useProjectReadmeDraftEditor({
    projectId,
    initialContent,
    initialDraftUpdatedAt,
    initialQualityReport,
    onSave,
    autosaveDelayMs = 1500,
}: UseProjectReadmeDraftEditorInput) {
    const localDraftKey = useMemo(() => `project-readme-draft:${projectId}`, [projectId]);
    const [content, setContentState] = useState(initialContent);
    const [expectedDraftUpdatedAt, setExpectedDraftUpdatedAt] = useState<string | null>(initialDraftUpdatedAt);
    const [qualityReport, setQualityReport] = useState<ProjectReadmeQualityReport>(initialQualityReport);
    const [localNotice, setLocalNotice] = useState<string | null>(null);
    const [conflict, setConflict] = useState<ProjectReadmeEditorConflict | null>(null);
    const [saveState, setSaveState] = useState<ProjectReadmeDraftSaveState>("saved");
    const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
    const [isPending, startTransition] = useTransition();
    const contentRef = useRef(initialContent);
    const expectedDraftUpdatedAtRef = useRef<string | null>(initialDraftUpdatedAt);
    const lastSavedContentRef = useRef(initialContent);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const saveSequenceRef = useRef(0);
    const mountedRef = useRef(true);

    const clearAutosaveTimer = useCallback(() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
    }, []);

    const clearLocalBackup = useCallback(() => {
        try {
            window.localStorage.removeItem(localDraftKey);
        } catch {
            // Local storage is best-effort only.
        }
    }, [localDraftKey]);

    const writeLocalBackup = useCallback((value: string) => {
        try {
            if (value === lastSavedContentRef.current) {
                window.localStorage.removeItem(localDraftKey);
            } else {
                window.localStorage.setItem(localDraftKey, value);
            }
        } catch {
            // Local storage may be unavailable or full; autosave still owns persistence.
        }
    }, [localDraftKey]);

    const setContentStateDebounced = useCallback((value: string) => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
            setContentState(value);
            debounceTimerRef.current = null;
        }, 300);
    }, []);

    const setContent = useCallback((value: string, options?: { isKeystroke?: boolean; isRemote?: boolean }) => {
        contentRef.current = value;

        if (options?.isRemote) {
            // Remote change is already saved on server; sync it directly without dirtying or autosaving
            lastSavedContentRef.current = value;
            setSaveState("saved");
            clearAutosaveTimer();
            clearLocalBackup();
            setContentStateDebounced(value);
        } else {
            if (options?.isKeystroke) {
                setContentStateDebounced(value);
            } else {
                if (debounceTimerRef.current) {
                    clearTimeout(debounceTimerRef.current);
                    debounceTimerRef.current = null;
                }
                setContentState(value);
            }

            if (value === lastSavedContentRef.current) {
                setSaveState("saved");
            } else {
                setSaveState("dirty");
            }
            writeLocalBackup(value);
        }
    }, [writeLocalBackup, setContentStateDebounced, clearAutosaveTimer, clearLocalBackup]);
    const applySuccessfulSave = useCallback((saved: ProjectReadmeEditorSaveResult, savedContent: string, notice: string) => {
        setExpectedDraftUpdatedAt(saved.draftUpdatedAt);
        expectedDraftUpdatedAtRef.current = saved.draftUpdatedAt;
        setQualityReport(saved.qualityReport);
        lastSavedContentRef.current = savedContent;
        setLastSavedAt(Date.now());
        setConflict(null);
        setLocalNotice(notice);

        if (contentRef.current === savedContent) {
            setSaveState("saved");
            clearLocalBackup();
        } else {
            setSaveState("dirty");
            writeLocalBackup(contentRef.current);
        }
    }, [clearLocalBackup, writeLocalBackup]);

    const saveNow = useCallback(async (notice = "Draft saved", expectedOverride?: string | null) => {
        clearAutosaveTimer();
        const saveContent = contentRef.current;
        if (saveContent === lastSavedContentRef.current && expectedOverride === undefined) {
            setSaveState("saved");
            setLocalNotice(notice);
            setLastSavedAt(Date.now());
            return {
                qualityReport,
                draftUpdatedAt: expectedDraftUpdatedAtRef.current,
                serverDraftContent: saveContent,
            };
        }
        const sequence = saveSequenceRef.current + 1;
        saveSequenceRef.current = sequence;
        setSaveState("saving");
        const expectedDraftUpdatedAt = expectedOverride === undefined
            ? expectedDraftUpdatedAtRef.current
            : expectedOverride;
        const saved = await onSave(saveContent, expectedDraftUpdatedAt);
        if (!mountedRef.current || sequence !== saveSequenceRef.current) return null;
        if (!saved) {
            setSaveState(saveContent === lastSavedContentRef.current ? "saved" : "dirty");
            setLocalNotice(saveContent === lastSavedContentRef.current ? null : "Save failed; retrying");
            return null;
        }
        applySuccessfulSave(saved, saveContent, notice);
        return saved;
    }, [applySuccessfulSave, clearAutosaveTimer, conflict, onSave, qualityReport]);

    const scheduleAutosave = useCallback(() => {
        clearAutosaveTimer();
        saveTimerRef.current = setTimeout(() => {
            startTransition(() => {
                void saveNow("Autosaved");
            });
        }, autosaveDelayMs);
    }, [autosaveDelayMs, clearAutosaveTimer, saveNow, startTransition]);

    const applyDraftResult = useCallback((result: ProjectReadmeEditorSaveResult | null, notice: string) => {
        if (!result) return;
        const nextContent = result.serverDraftContent ?? contentRef.current;
        contentRef.current = nextContent;
        setContentState(nextContent);
        setExpectedDraftUpdatedAt(result.draftUpdatedAt);
        expectedDraftUpdatedAtRef.current = result.draftUpdatedAt;
        setQualityReport(result.qualityReport);
        lastSavedContentRef.current = nextContent;
        setLastSavedAt(Date.now());
        setConflict(null);
        setSaveState("saved");
        setLocalNotice(notice);
        clearLocalBackup();
        clearAutosaveTimer();
    }, [clearAutosaveTimer, clearLocalBackup]);

    const useLatestDraft = useCallback(() => {
        if (!conflict) return;
        contentRef.current = conflict.serverDraftContent;
        setContentState(conflict.serverDraftContent);
        setExpectedDraftUpdatedAt(conflict.serverDraftUpdatedAt);
        expectedDraftUpdatedAtRef.current = conflict.serverDraftUpdatedAt;
        lastSavedContentRef.current = conflict.serverDraftContent;
        setLastSavedAt(Date.now());
        setConflict(null);
        setSaveState("saved");
        setLocalNotice("Loaded latest draft");
        clearLocalBackup();
    }, [clearLocalBackup, conflict]);

    const keepLocalDraft = useCallback(async () => {
        const saved = await saveNow("Local draft kept", null);
        if (!saved || saved.conflict) return;
        setConflict(null);
    }, [saveNow]);

    const applyMergedContent = useCallback((value: string) => {
        const nextContent = value.trimEnd();
        contentRef.current = nextContent;
        setContentState(nextContent);
        setConflict(null);
        setSaveState(nextContent === lastSavedContentRef.current ? "saved" : "dirty");
        setLocalNotice("Merged draft ready");
        writeLocalBackup(nextContent);
    }, [writeLocalBackup]);

    const acknowledgePublished = useCallback(() => {
        lastSavedContentRef.current = contentRef.current;
        setLastSavedAt(Date.now());
        setSaveState("saved");
        clearLocalBackup();
        clearAutosaveTimer();
    }, [clearAutosaveTimer, clearLocalBackup]);

    useEffect(() => {
        mountedRef.current = true;
        try {
            const emergencyDraft = window.localStorage.getItem(localDraftKey);
            if (emergencyDraft && !initialContent.trim()) {
                contentRef.current = emergencyDraft;
                setContentState(emergencyDraft);
                setSaveState("dirty");
                setLocalNotice("Recovered local draft");
            }
        } catch {
            // Local recovery is best-effort.
        }
        return () => {
            mountedRef.current = false;
            clearAutosaveTimer();
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        };
    }, [localDraftKey]);

    useEffect(() => {
        expectedDraftUpdatedAtRef.current = expectedDraftUpdatedAt;
    }, [expectedDraftUpdatedAt]);

    useEffect(() => {
        if (content === lastSavedContentRef.current) {
            clearAutosaveTimer();
            setSaveState("saved");
            clearLocalBackup();
            return;
        }
        setSaveState("dirty");
        writeLocalBackup(content);
        scheduleAutosave();
        return clearAutosaveTimer;
    }, [clearAutosaveTimer, clearLocalBackup, content, scheduleAutosave, writeLocalBackup]);

    return {
        content,
        setContent,
        contentRef,
        expectedDraftUpdatedAt,
        setExpectedDraftUpdatedAt,
        qualityReport,
        localNotice,
        setLocalNotice,
        conflict,
        saveState,
        lastSavedAt,
        isPending,
        localDraftKey,
        saveNow,
        applyDraftResult,
        useLatestDraft,
        keepLocalDraft,
        applyMergedContent,
        acknowledgePublished,
        clearLocalBackup,
        dirty: saveState === "dirty" || saveState === "saving",
    };
}
