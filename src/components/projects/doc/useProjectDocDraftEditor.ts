"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { normalizeProjectDocContent, normalizeProjectDocSlug, type ProjectDocQualityReport } from "@/lib/projects/doc";

export type ProjectDocEditorSaveResult = {
    qualityReport: ProjectDocQualityReport;
    draftUpdatedAt: string | null;
    conflict?: boolean;
    serverDraftContent?: string;
};

export type ProjectDocEditorConflict = {
    serverDraftContent: string;
    serverDraftUpdatedAt: string | null;
};

export type ProjectDocDraftSaveState = "saved" | "dirty" | "saving" | "conflict";

type UseProjectDocDraftEditorInput = {
    projectId: string;
    docSlug?: string;
    initialContent: string;
    initialDraftUpdatedAt: string | null;
    initialQualityReport: ProjectDocQualityReport;
    onSave: (content: string, expectedDraftUpdatedAt: string | null) => Promise<ProjectDocEditorSaveResult | null>;
    autosaveDelayMs?: number;
};

function fallbackQualityReport(content: string): ProjectDocQualityReport {
    return {
        score: 0,
        issues: [],
        sectionPresence: {},
        contentBytes: new Blob([content]).size,
    };
}

export function useProjectDocDraftEditor({
    projectId,
    docSlug = "readme",
    initialContent,
    initialDraftUpdatedAt,
    initialQualityReport,
    onSave,
    autosaveDelayMs = 1500,
}: UseProjectDocDraftEditorInput) {
    const normalizedDocSlug = useMemo(() => normalizeProjectDocSlug(docSlug), [docSlug]);
    const localDraftKey = useMemo(() => `project-doc-draft:${projectId}:${normalizedDocSlug}`, [projectId, normalizedDocSlug]);
    const initialNormalizedContent = useMemo(() => normalizeProjectDocContent(initialContent), [initialContent]);
    const [content, setContentState] = useState(initialNormalizedContent);
    const [expectedDraftUpdatedAt, setExpectedDraftUpdatedAt] = useState<string | null>(initialDraftUpdatedAt);
    const [qualityReport, setQualityReport] = useState<ProjectDocQualityReport>(initialQualityReport);
    const [localNotice, setLocalNotice] = useState<string | null>(null);
    const [conflict, setConflict] = useState<ProjectDocEditorConflict | null>(null);
    const [saveState, setSaveState] = useState<ProjectDocDraftSaveState>("saved");
    const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
    const [isPending, startTransition] = useTransition();
    const contentRef = useRef(initialNormalizedContent);
    const expectedDraftUpdatedAtRef = useRef<string | null>(initialDraftUpdatedAt);
    const lastSavedContentRef = useRef(initialNormalizedContent);
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
    const applySuccessfulSave = useCallback((saved: ProjectDocEditorSaveResult, savedContent: string, notice: string) => {
        const committedContent = saved.serverDraftContent ?? savedContent;
        if (saved.serverDraftContent && saved.serverDraftContent !== savedContent && contentRef.current === savedContent) {
            contentRef.current = saved.serverDraftContent;
            setContentState(saved.serverDraftContent);
        }
        setExpectedDraftUpdatedAt(saved.draftUpdatedAt);
        expectedDraftUpdatedAtRef.current = saved.draftUpdatedAt;
        setQualityReport(saved.qualityReport);
        lastSavedContentRef.current = committedContent;
        setLastSavedAt(Date.now());
        setConflict(null);
        setLocalNotice(notice);

        if (contentRef.current === committedContent) {
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

    const applyDraftResult = useCallback((result: ProjectDocEditorSaveResult | null, notice: string) => {
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
            if (emergencyDraft && !initialNormalizedContent.trim()) {
                const normalizedEmergencyDraft = normalizeProjectDocContent(emergencyDraft);
                contentRef.current = normalizedEmergencyDraft;
                setContentState(normalizedEmergencyDraft);
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
    }, [clearAutosaveTimer, initialNormalizedContent, localDraftKey]);

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
