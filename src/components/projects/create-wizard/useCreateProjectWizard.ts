'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createProjectSchema, type CreateProjectInput, type OpenRoleInput } from '@/lib/validations/project';
import { generateSlug, generateProjectId } from '@/lib/utils/project-ids';
import { toast } from 'sonner';
import { TOTAL_PHASES, WizardPhaseId } from '@/constants/project-wizard';
import { createProjectAction } from '@/app/actions/project';
import { fetchContents, fetchRepoMeta, parseGithubRepo, type GitHubContentEntry } from '@/lib/github/repo-preview';
import { isTooLarge, shouldIgnorePath } from '@/lib/import/import-filters';
import { getLifecycleStagesForProjectType } from '@/lib/projects/lifecycle-templates';

export interface WizardContextType {
    openRoles: OpenRoleInput[];
    setOpenRoles: (roles: OpenRoleInput[]) => void;
    addRole: () => void;
    updateRole: (index: number, updates: Partial<OpenRoleInput>) => void;
    removeRole: (index: number) => void;
}

interface UseCreateProjectWizardProps {
    onClose: () => void;
    onSuccess?: (projectId: string) => void;
    draftId?: string;
}

/**
 * useCreateProjectWizard - The master hook for project creation.
 * Pure Optimization: Unified constants, reactive draft management, and scalable logic.
 */
export function useCreateProjectWizard({ onClose, onSuccess, draftId }: UseCreateProjectWizardProps) {
    const supabase = createClient();
    const [phase, setPhase] = useState<WizardPhaseId>(1);
    const [openRoles, setOpenRoles] = useState<OpenRoleInput[]>([]);
    const [uploadFiles, setUploadFiles] = useState<FileList | null>(null);
    const [uploadProgress, setUploadProgress] = useState<{
        percent: number;
        currentFile: string;
        isUploading: boolean;
    } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSavingDraft, setIsSavingDraft] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [showExitConfirm, setShowExitConfirm] = useState(false);
    const [draftInfo, setDraftInfo] = useState<{
        exists: boolean;
        phase: number;
        savedAt: Date | null;
    } | null>(null);

    // Form Setup
    const methods = useForm<CreateProjectInput>({
        resolver: zodResolver(createProjectSchema) as any,
        mode: 'onChange',
        defaultValues: {
            title: '',
            description: '',
            short_description: '',
            project_type: '',
            custom_project_type: '',
            status: 'open',
            visibility: 'public',
            tags: [],
            technologies_used: [],
            lifecycle_stages: [],
            current_stage_index: 0,
            goals: [],
            application_settings: {
                allow_applications: true,
                require_portfolio: false,
                custom_questions: [],
                auto_decline_days: 30,
            },
            terms: {
                ip_agreement: 'discuss',
                license: '',
                nda_required: 'none',
                portfolio_showcase_allowed: true,
                additional_terms: '',
            },
            import_source: { type: 'scratch' },
            metadata: {},
        },
    });

    const { getValues, setValue, trigger, formState: { isDirty }, watch, reset } = methods;

    // --- Lifecycle Autofill (Phase 3) ---
    const watchedProjectType = watch('project_type');
    const watchedLifecycleStages = watch('lifecycle_stages') || [];
    const lastAutofilledStagesRef = useRef<string[] | null>(null);

    const arraysEqual = useCallback((a: string[] | null | undefined, b: string[] | null | undefined) => {
        if (!a || !b) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }, []);

    useEffect(() => {
        const type = (watchedProjectType || '').trim();
        if (!type) return;

        // If empty, always autofill from template.
        if (!watchedLifecycleStages || watchedLifecycleStages.length === 0) {
            const next = getLifecycleStagesForProjectType(type);
            setValue('lifecycle_stages', next, { shouldDirty: true });
            lastAutofilledStagesRef.current = next;
            return;
        }

        // If the user hasn't edited (still equals last autofill), update when type changes.
        if (lastAutofilledStagesRef.current && arraysEqual(watchedLifecycleStages, lastAutofilledStagesRef.current)) {
            const next = getLifecycleStagesForProjectType(type);
            if (!arraysEqual(next, watchedLifecycleStages)) {
                setValue('lifecycle_stages', next, { shouldDirty: true });
                lastAutofilledStagesRef.current = next;
            }
            return;
        }

        // If stages equal the server generic default (legacy), consider it “un-edited” and upgrade to template once.
        const legacyDefault = ["Concept", "Team Formation", "MVP", "Beta", "Launch"];
        if (arraysEqual(watchedLifecycleStages, legacyDefault)) {
            const next = getLifecycleStagesForProjectType(type);
            setValue('lifecycle_stages', next, { shouldDirty: true });
            lastAutofilledStagesRef.current = next;
        }
    }, [arraysEqual, setValue, watchedLifecycleStages, watchedProjectType]);

    // --- GitHub Preview (Phase 1) ---
    type GithubPreviewStatus = 'idle' | 'loading' | 'ready' | 'error';
    type GithubExcludedReason = 'ignored' | 'tooLarge';
    type GithubPreviewEntry = GitHubContentEntry & { excludedReason?: GithubExcludedReason };

    const [githubPreview, setGithubPreview] = useState<{
        status: GithubPreviewStatus;
        repoUrl: string;
        branch: string | null;
        rootEntries: GithubPreviewEntry[];
        errorMessage: string | null;
    }>({
        status: 'idle',
        repoUrl: '',
        branch: null,
        rootEntries: [],
        errorMessage: null,
    });

    const [githubFolderEntries, setGithubFolderEntries] = useState<Record<string, GithubPreviewEntry[]>>({});

    const importSourceType = watch('import_source.type');
    const watchedRepoUrl = watch('import_source.repoUrl');
    const watchedBranch = watch('import_source.branch');

    const resetGithubPreview = useCallback(() => {
        setGithubPreview({
            status: 'idle',
            repoUrl: '',
            branch: null,
            rootEntries: [],
            errorMessage: null,
        });
        setGithubFolderEntries({});
    }, []);

    // Reset preview when source or repo changes.
    useEffect(() => {
        if (importSourceType !== 'github') {
            if (githubPreview.status !== 'idle') resetGithubPreview();
            return;
        }

        const nextUrl = (watchedRepoUrl || '').trim();
        if (!nextUrl) {
            if (githubPreview.status !== 'idle') resetGithubPreview();
            return;
        }

        if (githubPreview.repoUrl && githubPreview.repoUrl !== nextUrl) {
            resetGithubPreview();
        }
    }, [importSourceType, watchedRepoUrl, githubPreview.status, githubPreview.repoUrl, resetGithubPreview]);

    const decorateEntry = useCallback((e: GitHubContentEntry): GithubPreviewEntry => {
        const ignored = shouldIgnorePath(e.path);
        if (ignored) return { ...e, excludedReason: 'ignored' };
        if (e.type === 'file' && isTooLarge(e.size)) return { ...e, excludedReason: 'tooLarge' };
        return e;
    }, []);

    const startGithubRootPreview = useCallback(async (repoUrl: string) => {
        const url = (repoUrl || '').trim();
        if (!url) return;

        // Avoid duplicating work.
        setGithubPreview((prev) => {
            if (prev.status === 'loading' && prev.repoUrl === url) return prev;
            return { ...prev, status: 'loading', repoUrl: url, errorMessage: null };
        });

        try {
            const parsed = parseGithubRepo(url);
            if (!parsed) {
                setGithubPreview((prev) => ({ ...prev, status: 'error', errorMessage: 'Invalid GitHub repo URL.' }));
                return;
            }

            const token = (await supabase.auth.getSession()).data.session?.provider_token || undefined;
            const meta = await fetchRepoMeta({ ...parsed, token });
            const branch = watchedBranch || meta.defaultBranch || 'main';

            // Store branch in form so the import worker uses the same ref.
            if (!watchedBranch && branch) {
                setValue('import_source.branch', branch, { shouldDirty: true });
            }

            const root = await fetchContents({ ...parsed, token, ref: branch, path: '' });
            const rootEntries = root.map(decorateEntry);

            setGithubFolderEntries({ '': rootEntries });
            setGithubPreview({
                status: 'ready',
                repoUrl: url,
                branch,
                rootEntries,
                errorMessage: null,
            });
        } catch (e: any) {
            const message = typeof e?.message === 'string' ? e.message : 'Failed to preview repository.';
            setGithubPreview((prev) => ({
                ...prev,
                status: 'error',
                repoUrl: url,
                errorMessage: message,
                rootEntries: [],
            }));
        }
    }, [decorateEntry, setValue, supabase, watchedBranch]);

    const loadGithubFolder = useCallback(async (folderPath: string) => {
        const baseUrl = (githubPreview.repoUrl || '').trim();
        const branch = githubPreview.branch || watchedBranch || null;
        if (!baseUrl || !branch) return;

        const key = (folderPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
        if (githubFolderEntries[key]) return;

        // Don’t fetch ignored folders.
        if (shouldIgnorePath(key)) {
            setGithubFolderEntries((prev) => ({ ...prev, [key]: [] }));
            return;
        }

        const parsed = parseGithubRepo(baseUrl);
        if (!parsed) return;

        try {
            const token = (await supabase.auth.getSession()).data.session?.provider_token || undefined;
            const contents = await fetchContents({ ...parsed, token, ref: branch, path: key });
            const entries = contents.map(decorateEntry);
            setGithubFolderEntries((prev) => ({ ...prev, [key]: entries }));
        } catch {
            // Non-blocking: folder expansion can fail silently; keep UX smooth.
            setGithubFolderEntries((prev) => ({ ...prev, [key]: [] }));
        }
    }, [decorateEntry, githubFolderEntries, githubPreview.branch, githubPreview.repoUrl, supabase, watchedBranch]);

    // --- Draft Management ---

    // Check for existing draft on mount
    useEffect(() => {
        const checkDraft = async () => {
            const { draftStore } = await import('@/lib/storage/draft-store');
            const info = await draftStore.getInfo();
            if (info.exists) {
                setDraftInfo({
                    exists: true,
                    phase: info.phase,
                    savedAt: info.savedAt,
                });
            }
        };
        checkDraft();
    }, []);

    const restoreDraft = useCallback(async () => {
        const { draftStore } = await import('@/lib/storage/draft-store');
        const draft = await draftStore.load();
        if (draft) {
            reset(draft);
            if (draft._timestamp) setLastSaved(new Date(draft._timestamp));
            if (draft._phase) setPhase(draft._phase as WizardPhaseId);
            setDraftInfo(null);
            toast.success("Draft restored");
        }
    }, [reset]);

    const deleteDraft = useCallback(async () => {
        const { draftStore } = await import('@/lib/storage/draft-store');

        // 1. Server-side deep wipe (if draftId exists)
        if (draftId) {
            try {
                const { deleteProjectDraftAction } = await import('@/app/actions/project');
                await deleteProjectDraftAction(draftId);
            } catch (err) {
                console.error("Server draft wipe failed", err);
            }
        }

        // 2. Client-side total wipe
        await draftStore.clear();
        setDraftInfo(null);
        reset();
        setPhase(1);
        toast.success("Draft erased completely");
    }, [draftId, reset]);

    const saveDraft = useCallback(async (silent = false) => {
        const { draftStore } = await import('@/lib/storage/draft-store');
        await draftStore.save(getValues(), phase);
        setLastSaved(new Date());

        if (silent) return;

        setIsSavingDraft(true);
        setSaveStatus('saving');
        // Pure Optimization: Minimal visual delay for confidence
        await new Promise(r => setTimeout(r, 400));
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
        setIsSavingDraft(false);
    }, [getValues, phase]);

    // Auto-Save Optimization (Debounced subscription)
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    useEffect(() => {
        const subscription = watch((_, { type }) => {
            if (!isDirty || type === undefined) return;

            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = setTimeout(() => saveDraft(true), 5000);
        });
        return () => {
            subscription.unsubscribe();
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        };
    }, [isDirty, watch, saveDraft]);

    // --- Role Management ---
    const addRole = useCallback(() => {
        setOpenRoles(prev => [{
            role: '',
            count: 1,
            description: '',
            skills: [],
            experience_level: 'any',
            compensation_type: 'unpaid',
            compensation_details: '',
        }, ...prev]);
    }, []);

    const updateRole = useCallback((index: number, updates: Partial<OpenRoleInput>) => {
        setOpenRoles(prev => prev.map((r, i) => i === index ? { ...r, ...updates } : r));
    }, []);

    const removeRole = useCallback((index: number) => {
        setOpenRoles(prev => prev.filter((_, i) => i !== index));
    }, []);

    const wizardContext: WizardContextType = useMemo(() => ({
        openRoles, setOpenRoles, addRole, updateRole, removeRole
    }), [openRoles, addRole, updateRole, removeRole]);

    // --- Navigation ---
    const handleNext = useCallback(async () => {
        let isValid = false;
        if (phase === 1) {
            const importType = getValues('import_source.type') || 'scratch';
            if (importType === 'github') {
                const repoUrl = (getValues('import_source.repoUrl') || '').trim();
                if (!repoUrl) {
                    toast.error('Please paste a GitHub repository link.');
                    return;
                }

                // STRICT PREVIEW CHECK: We removed the "skip" option.
                const previewReady = githubPreview.status === 'ready' && githubPreview.repoUrl === repoUrl;
                if (!previewReady) {
                    toast.info('You must preview the repository files to continue.');
                    return;
                }
            }
            if (importType === 'upload') {
                if (!uploadFiles || uploadFiles.length === 0) {
                    toast.error('Please select a folder first.');
                    return;
                }
            }

            isValid = true;
        }
        else if (phase === 2) isValid = await trigger('project_type');
        else if (phase === 3) isValid = await trigger(['title', 'description']);
        else if (phase === 4) isValid = true;
        else if (phase === 5) isValid = true;

        if (isValid && phase < TOTAL_PHASES) {
            setPhase(prev => (prev + 1) as WizardPhaseId);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, [phase, trigger, getValues, githubPreview.repoUrl, githubPreview.status, uploadFiles]);

    const handleBack = useCallback(() => {
        if (phase > 1) {
            setPhase(prev => (prev - 1) as WizardPhaseId);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, [phase]);

    const goToPhase = useCallback((target: WizardPhaseId) => {
        setPhase(target);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const handleCloseAttempt = useCallback(() => {
        if (isDirty || phase > 1) setShowExitConfirm(true);
        else onClose();
    }, [isDirty, phase, onClose]);

    // --- Submission ---
    const onSubmit = useCallback(async (data: CreateProjectInput) => {
        if (phase !== TOTAL_PHASES) return;

        setIsSubmitting(true);
        const importType = data.import_source?.type || 'scratch';
        let createdProjectId: string | null = null;
        try {
            const result = await createProjectAction({
                ...data,
                roles: openRoles.filter(r => (r.role || '').trim().length > 0),
                slug: generateSlug(data.title.trim()),
                project_id: generateProjectId(data.title.trim()),
            });

            if (!result.success || !result.project) throw new Error(result.error || 'Creation failed');
            createdProjectId = result.project.id;

            // Upload flow (Folder Upload import)
            if (importType === 'upload') {
                if (!uploadFiles || uploadFiles.length === 0) {
                    throw new Error('Please select a folder to upload.');
                }

                setUploadProgress({ percent: 0, currentFile: '', isUploading: true });
                toast.info('Uploading your folder in the background…');

                const [{ uploadFolder }, uploadActions, importActions] = await Promise.all([
                    import('@/lib/upload/chunked-upload'),
                    import('@/app/actions/upload'),
                    import('@/app/actions/upload-import'),
                ]);

                const { getBatchUploadUrls, getUploadPresignedUrl } = uploadActions;
                const { registerUploadedFolderAction } = importActions;

                const filesArr = Array.from(uploadFiles);
                const meta = filesArr.map((f) => {
                    const relativePath = f.webkitRelativePath || f.name;
                    const key = `${createdProjectId}/${relativePath}`;
                    return {
                        key,
                        relativePath,
                        size: f.size,
                        mimeType: f.type || 'application/octet-stream',
                    };
                });

                // Pre-generate URLs (batch) for performance
                const batchRes = await getBatchUploadUrls(meta.map(m => ({ key: m.key, contentType: m.mimeType })));
                if ('error' in batchRes) throw new Error(batchRes.error);
                const urlMap = batchRes.urls || {};

                const getPresignedUrl = async (key: string, contentType: string) => {
                    const cached = urlMap[key];
                    if (cached) return cached;
                    const single = await getUploadPresignedUrl(key, contentType);
                    if ('error' in single) throw new Error(single.error);
                    return single.url;
                };

                const uploadRes = await uploadFolder(
                    uploadFiles,
                    createdProjectId,
                    (p) => {
                        setUploadProgress({
                            percent: p.percent,
                            currentFile: p.currentFile,
                            isUploading: p.percent < 100,
                        });
                    },
                    getPresignedUrl
                );

                // Register ONLY successfully uploaded files so Files tab never references missing keys
                const uploadedSet = new Set(uploadRes.uploadedKeys);
                const manifest = meta
                    .filter((m) => uploadedSet.has(m.key))
                    .map((m) => ({
                        relativePath: m.relativePath,
                        size: m.size,
                        mimeType: m.mimeType,
                    }));

                await registerUploadedFolderAction(createdProjectId, manifest);

                setUploadProgress({ percent: 100, currentFile: '', isUploading: false });

                if (!uploadRes.success) {
                    toast.warning(`Project created. ${uploadRes.failedFiles.length} file(s) failed to upload.`);
                } else {
                    toast.success('Project created and folder imported!');
                }
            } else {
                toast.success('Project created successfully!');
            }

            const { draftStore } = await import('@/lib/storage/draft-store');
            await draftStore.clear();
            onSuccess?.(createdProjectId);
            onClose();
        } catch (error: any) {
            // If upload import failed after project creation, mark syncStatus=failed so Files tab can show retry UI.
            try {
                if (createdProjectId && importType === 'upload') {
                    const { markProjectSyncFailedAction } = await import('@/app/actions/upload-import');
                    await markProjectSyncFailedAction(createdProjectId);
                }
            } catch { }
            toast.error(error.message || 'Failed to create project');
        } finally {
            setIsSubmitting(false);
        }
    }, [onSuccess, onClose, phase, openRoles, uploadFiles]);

    return {
        phase, methods, wizardContext, isSubmitting, isSavingDraft,
        uploadFiles, setUploadFiles, uploadProgress, setUploadProgress,
        saveStatus, lastSaved, showExitConfirm, setShowExitConfirm,
        handleNext, handleBack, goToPhase, saveDraft, handleCloseAttempt,
        githubPreview,
        githubFolderEntries,
        loadGithubFolder,
        startGithubRootPreview,
        onSubmit, draftInfo, restoreDraft, deleteDraft
    };
}
