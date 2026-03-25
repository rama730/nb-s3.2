'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import { ArrowLeft, Check, ChevronDown, Code2, FolderUp, Github, Loader2, RefreshCcw, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

import type { CreateProjectInput } from '@/lib/validations/project';
import { logger } from '@/lib/logger';
import { getAuthHardeningPhase } from '@/lib/auth/hardening';
import { buildOAuthRedirectTo, resolveAuthBaseUrl } from '@/lib/auth/redirects';
import { continueBrowserOAuthRedirect } from '@/lib/auth/oauth';
import {
    fetchGithubImportAccessState,
    fetchGithubImportAnalysis,
    fetchGithubImportBranches,
    fetchGithubImportPreflight,
    fetchGithubImportRepositories,
} from '@/lib/github/import-client';
import type { GithubImportRepoItem } from '@/lib/github/import-types';
import { areSealedImportTokensEqual, getSealedImportTokenFingerprint } from '@/lib/github/import-token-state';

type SourceType = 'scratch' | 'github' | 'upload';

type GithubPreviewEntry = {
    name: string;
    path: string;
    type: 'file' | 'dir';
    size?: number | null;
    excludedReason?: 'ignored' | 'tooLarge';
};

type ImportSourceMetadata = Record<string, unknown> & {
    githubInstallationId?: number | null;
    githubPreflightStatus?: 'idle' | 'ok' | 'error';
    githubPreflightError?: string | null;
    githubPreflightWarnings?: string[];
    importAuth?: unknown;
    fileCount?: number;
};

const sourceCards: Array<{
    type: SourceType;
    title: string;
    description: string;
    icon: typeof Code2;
}> = [
    {
        type: 'scratch',
        title: 'Start from Scratch',
        description: 'Create a blank canvas. Best for new ideas and fresh starts.',
        icon: Code2,
    },
    {
        type: 'github',
        title: 'Import from GitHub',
        description: 'Import an existing repository and review it before project creation.',
        icon: Github,
    },
    {
        type: 'upload',
        title: 'Upload Folder',
        description: 'Use a local project folder and inspect the files before creating the project.',
        icon: FolderUp,
    },
];

function isGithubAccessRefreshError(message: string | null | undefined) {
    const normalized = (message || '').toLowerCase();
    if (!normalized) return false;
    return (
        normalized.includes('repository access is not available') ||
        normalized.includes('unauthorized') ||
        normalized.includes('connect github') ||
        normalized.includes('log in to github') ||
        normalized.includes('private. connect github')
    );
}

const GITHUB_OAUTH_PENDING_STORAGE_KEY = 'create-project:github-oauth-pending';
const GITHUB_OAUTH_PENDING_MAX_AGE_MS = 2 * 60 * 1000;
const GITHUB_OAUTH_RETRY_DELAYS_MS = [250, 500, 1000, 1500];

function markGithubOAuthPending() {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.setItem(GITHUB_OAUTH_PENDING_STORAGE_KEY, String(Date.now()));
    } catch {
        // Ignore sessionStorage failures in private browsing or locked-down contexts.
    }
}

function clearGithubOAuthPending() {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.removeItem(GITHUB_OAUTH_PENDING_STORAGE_KEY);
    } catch {
        // Ignore sessionStorage failures in private browsing or locked-down contexts.
    }
}

function hasRecentGithubOAuthPending() {
    if (typeof window === 'undefined') return false;
    try {
        const raw = window.sessionStorage.getItem(GITHUB_OAUTH_PENDING_STORAGE_KEY)?.trim();
        if (!raw) return false;
        const startedAt = Number(raw);
        if (!Number.isFinite(startedAt)) {
            clearGithubOAuthPending();
            return false;
        }
        const isFresh = Date.now() - startedAt <= GITHUB_OAUTH_PENDING_MAX_AGE_MS;
        if (!isFresh) {
            clearGithubOAuthPending();
        }
        return isFresh;
    } catch {
        return false;
    }
}

export default function Phase1SourceSelection({
    uploadFiles,
    setUploadFiles,
    uploadProgress,
    githubPreview,
    githubFolderEntries,
    loadGithubFolder,
    startGithubRootPreview,
    initialSource = null,
    onSourceChange,
}: {
    uploadFiles: FileList | null;
    setUploadFiles: (files: FileList | null) => void;
    uploadProgress: { percent: number; currentFile: string; isUploading: boolean } | null;
    githubPreview: {
        status: 'idle' | 'loading' | 'ready' | 'error';
        repoUrl: string;
        branch: string | null;
        rootEntries: GithubPreviewEntry[];
        errorMessage: string | null;
    };
    githubFolderEntries: Record<string, GithubPreviewEntry[]>;
    loadGithubFolder: (folderPath: string) => Promise<void>;
    startGithubRootPreview: (repoUrl: string) => Promise<void>;
    initialSource?: SourceType | null;
    onSourceChange?: (source: SourceType | null) => void;
}) {
    const { getValues, setValue, watch } = useFormContext<CreateProjectInput>();
    const importSourceType = watch('import_source.type') as SourceType | undefined;
    const repoUrl = watch('import_source.repoUrl');
    const branch = watch('import_source.branch');

    const supabase = useMemo(() => createClient(), []);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const latestBranchRequestKeyRef = useRef('');
    const latestPreflightRequestKeyRef = useRef('');

    const [activeSourceView, setActiveSourceView] = useState<SourceType | null>(() => {
        if (initialSource) {
            return initialSource;
        }
        const currentImportSource = getValues('import_source');
        const metadata = (currentImportSource?.metadata || {}) as ImportSourceMetadata;
        if (currentImportSource?.type === 'github' && ((currentImportSource.repoUrl || '').trim() || metadata.importAuth)) {
            return 'github';
        }
        if (currentImportSource?.type === 'upload' && ((currentImportSource.s3Key || '').trim() || metadata.fileCount)) {
            return 'upload';
        }
        return null;
    });

    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<{
        title: string;
        description: string;
        technologies: string[];
    } | null>(null);

    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
    const [loadingFolders, setLoadingFolders] = useState<Set<string>>(() => new Set());

    const [hasGithubIdentity, setHasGithubIdentity] = useState(false);
    const [hasGithubRepoAccess, setHasGithubRepoAccess] = useState(false);
    const [isLoadingAuth, setIsLoadingAuth] = useState(true);
    const [ghUsername, setGhUsername] = useState<string | null>(null);

    const [repoPickerOpen, setRepoPickerOpen] = useState(false);
    const [repoQuery, setRepoQuery] = useState('');
    const [repoItems, setRepoItems] = useState<GithubImportRepoItem[]>([]);
    const [repoCursor, setRepoCursor] = useState<string | null>(null);
    const [isLoadingRepos, setIsLoadingRepos] = useState(false);
    const [repoLoadError, setRepoLoadError] = useState<string | null>(null);
    const [repoLoadedOnce, setRepoLoadedOnce] = useState(false);
    const [githubEntryMode, setGithubEntryMode] = useState<'paste' | 'browse'>('paste');
    const [showManualGithubEntry, setShowManualGithubEntry] = useState(false);
    const [isEditingResolvedRepo, setIsEditingResolvedRepo] = useState(false);
    const [branchOptions, setBranchOptions] = useState<string[]>([]);
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);
    const [isDragOverUpload, setIsDragOverUpload] = useState(false);
    const [isConnectingGithub, setIsConnectingGithub] = useState(false);
    const [repoRefreshRequired, setRepoRefreshRequired] = useState(false);
    const [preflightState, setPreflightState] = useState<{
        status: 'idle' | 'loading' | 'ok' | 'error';
        warnings: string[];
        error: string | null;
        authSource: string | null;
    }>({
        status: 'idle',
        warnings: [],
        error: null,
        authSource: null,
    });

    const selectedSource = activeSourceView ?? importSourceType ?? null;

    useEffect(() => {
        onSourceChange?.(activeSourceView);
    }, [activeSourceView, onSourceChange]);

    useEffect(() => {
        if (githubEntryMode === 'browse' && !hasGithubRepoAccess) {
            setGithubEntryMode('paste');
        }
    }, [githubEntryMode, hasGithubRepoAccess]);

    const normalizeGitHubRepoUrl = useCallback((raw: string) => {
        const value = (raw || '').trim();
        if (!value) return '';
        if (value.startsWith('http://') || value.startsWith('https://')) {
            return value.replace(/^http:\/\//, 'https://').replace(/\/+$/, '');
        }
        if (value.startsWith('github.com/')) {
            return `https://${value}`.replace(/\/+$/, '');
        }
        if (/^[^/\s]+\/[^/\s]+$/.test(value)) {
            return `https://github.com/${value}`.replace(/\/+$/, '');
        }
        return value;
    }, []);

    const importSourceMetadata = (watch('import_source.metadata') || {}) as ImportSourceMetadata;

    const mergeImportSourceMetadata = useCallback((updates: Record<string, unknown>, shouldDirty: boolean = true) => {
        const current = ((getValues('import_source.metadata') || {}) as ImportSourceMetadata);
        let hasChanges = false;
        for (const [key, value] of Object.entries(updates)) {
            const currentValue = current[key as keyof ImportSourceMetadata];
            const isEqual =
                key === 'importAuth'
                    ? areSealedImportTokensEqual(currentValue, value)
                    : currentValue === value;
            if (!isEqual) {
                hasChanges = true;
                break;
            }
        }
        if (!hasChanges) {
            return;
        }
        setValue(
            'import_source.metadata',
            {
                ...current,
                ...updates,
            },
            { shouldDirty }
        );
    }, [getValues, setValue]);

    const sealedImportToken = importSourceMetadata.importAuth ?? null;
    const sealedImportTokenFingerprint = getSealedImportTokenFingerprint(sealedImportToken);

    useEffect(() => {
        if (!initialSource) return;
        const currentImportSource = getValues('import_source');
        const currentMetadata = (currentImportSource?.metadata || {}) as ImportSourceMetadata;
        setValue(
            'import_source',
            {
                ...(currentImportSource || {}),
                type: initialSource,
                metadata: currentMetadata,
            },
            { shouldDirty: false, shouldValidate: true }
        );
        setActiveSourceView(initialSource);
    }, [getValues, initialSource, setValue]);

    useEffect(() => {
        if (activeSourceView !== null) return;

        const currentImportSource = getValues('import_source');
        const metadata = (currentImportSource?.metadata || {}) as ImportSourceMetadata;
        if (currentImportSource?.type === 'github' && (currentImportSource.repoUrl || metadata.importAuth)) {
            setActiveSourceView('github');
            return;
        }
        if (currentImportSource?.type === 'upload' && (uploadFiles?.length || metadata.fileCount)) {
            setActiveSourceView('upload');
            return;
        }

        if (
            currentImportSource?.type === 'scratch' &&
            !currentImportSource.repoUrl &&
            !currentImportSource.branch &&
            !currentImportSource.s3Key &&
            !metadata.fileCount &&
            !metadata.importAuth
        ) {
            setValue('import_source', { type: 'scratch' }, { shouldDirty: false });
        }
    }, [activeSourceView, getValues, setValue, uploadFiles]);

    useEffect(() => {
        if (activeSourceView !== 'github') {
            setIsLoadingAuth(false);
            return;
        }
        let cancelled = false;

        const scheduleRetry = (nextAttempt: number) => {
            const delayMs = GITHUB_OAUTH_RETRY_DELAYS_MS[nextAttempt - 1];
            if (!delayMs) return false;
            window.setTimeout(() => {
                if (!cancelled) {
                    void checkConnection(nextAttempt);
                }
            }, delayMs);
            return true;
        };

        const checkConnection = async (attempt: number = 0) => {
            let willRetry = false;
            try {
                const result = await fetchGithubImportAccessState();
                if (cancelled) return;
                const oauthPending = hasRecentGithubOAuthPending();
                const shouldRetryPendingOAuth =
                    oauthPending
                    && attempt < GITHUB_OAUTH_RETRY_DELAYS_MS.length
                    && (!result.success || (result.linked && !result.repoAccess));
                if (shouldRetryPendingOAuth) {
                    willRetry = scheduleRetry(attempt + 1);
                    if (willRetry) return;
                }
                if (!result.success) {
                    setHasGithubIdentity(false);
                    setHasGithubRepoAccess(Boolean(sealedImportTokenFingerprint));
                    setGhUsername(null);
                    setRepoRefreshRequired(false);
                    clearGithubOAuthPending();
                    return;
                }
                setHasGithubIdentity(result.linked);
                setHasGithubRepoAccess(result.repoAccess);
                setRepoRefreshRequired(result.refreshRequired);
                setGhUsername(result.username);
                if (result.repoAccess || !oauthPending) {
                    clearGithubOAuthPending();
                }
                if (result.sealedImportToken && !areSealedImportTokensEqual(result.sealedImportToken, sealedImportToken)) {
                    mergeImportSourceMetadata({ importAuth: result.sealedImportToken }, false);
                }
            } catch (error) {
                if (cancelled) return;
                if (hasRecentGithubOAuthPending() && attempt < GITHUB_OAUTH_RETRY_DELAYS_MS.length) {
                    willRetry = scheduleRetry(attempt + 1);
                    if (willRetry) return;
                }
                console.error('Failed to check GitHub connection', error);
                setHasGithubIdentity(false);
                setHasGithubRepoAccess(Boolean(sealedImportTokenFingerprint));
                setGhUsername(null);
                setRepoRefreshRequired(false);
                clearGithubOAuthPending();
            } finally {
                if (!cancelled && !willRetry) {
                    setIsLoadingAuth(false);
                }
            }
        };

        setIsLoadingAuth(true);
        void checkConnection();

        return () => {
            cancelled = true;
        };
    }, [activeSourceView, mergeImportSourceMetadata, sealedImportTokenFingerprint]);

    const handleConnectGithub = async () => {
        try {
            setIsConnectingGithub(true);
            markGithubOAuthPending();
            const returnUrl = new URL(window.location.href);
            returnUrl.searchParams.set('createProject', '1');
            returnUrl.searchParams.set('createProjectSource', 'github');
            const currentPath = `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`;
            const oauthRequestId =
                typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                    ? crypto.randomUUID()
                    : `wizard-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            const redirectTo = buildOAuthRedirectTo(resolveAuthBaseUrl(), currentPath, oauthRequestId, 'github');
            logger.metric('auth.oauth.start', {
                requestId: oauthRequestId,
                provider: 'github',
                flow: 'create_wizard',
                nextPath: currentPath,
                phase: getAuthHardeningPhase(),
            });

            const result = await supabase.auth.signInWithOAuth({
                provider: 'github',
                options: {
                    redirectTo,
                    scopes: 'repo',
                },
            });
            if (result.error) throw result.error;
            if (!result.data?.url) {
                throw new Error('GitHub login redirect could not be started.');
            }
            continueBrowserOAuthRedirect(result);
        } catch (error: any) {
            setIsConnectingGithub(false);
            clearGithubOAuthPending();
            toast.error(`Failed to connect GitHub: ${error?.message || 'Unknown error'}`);
        }
    };

    const handleSelectSource = (type: SourceType) => {
        const currentImportSource = getValues('import_source');
        const currentMetadata = (currentImportSource?.metadata || {}) as ImportSourceMetadata;
        setValue(
            'import_source',
            {
                ...(currentImportSource || {}),
                type,
                metadata: currentMetadata,
            },
            { shouldValidate: true, shouldDirty: true }
        );
        setActiveSourceView(type);
        if (type !== 'github') {
            setRepoPickerOpen(false);
        }
    };

    const loadRepositories = useCallback(async (reset: boolean, cursorOverride?: string | null) => {
        if (!hasGithubRepoAccess) return;
        setIsLoadingRepos(true);
        setRepoLoadError(null);
        try {
            const result = await fetchGithubImportRepositories({
                cursor: reset ? null : (cursorOverride ?? null),
                q: repoQuery || null,
                perPage: 15,
            });
            setRepoItems((prev) => (reset ? result.items : [...prev, ...result.items]));
            setRepoCursor(result.cursor || null);
            setRepoLoadedOnce(true);
            setRepoLoadError(null);
            setRepoRefreshRequired(false);
            setHasGithubRepoAccess(true);
        } catch (error: any) {
            const message = error?.message || 'Failed to load repositories';
            setRepoLoadError(message);
            const needsRefresh = hasGithubIdentity && isGithubAccessRefreshError(message);
            setRepoRefreshRequired(needsRefresh);
            if (needsRefresh) {
                setHasGithubRepoAccess(false);
            }
            toast.error(message);
        } finally {
            setIsLoadingRepos(false);
        }
    }, [hasGithubIdentity, hasGithubRepoAccess, repoQuery]);

    const loadBranchesForRepo = useCallback(async (url: string) => {
        const normalizedUrl = normalizeGitHubRepoUrl(url || '');
        if (!normalizedUrl) return;

        latestBranchRequestKeyRef.current = normalizedUrl;
        setIsLoadingBranches(true);
        try {
            const installationId = importSourceMetadata.githubInstallationId ?? null;
            const result = await fetchGithubImportBranches({
                repoUrl: normalizedUrl,
                installationId,
            });
            if (latestBranchRequestKeyRef.current !== normalizedUrl) return;
            const options = Array.isArray(result.branches) ? result.branches : [];
            setBranchOptions(options);
            if (result.installationId) {
                mergeImportSourceMetadata({ githubInstallationId: result.installationId });
            }
            const currentBranch = (getValues('import_source.branch') || '').trim();
            if (options.length > 0 && (!currentBranch || !options.includes(currentBranch))) {
                setValue('import_source.branch', options[0], { shouldDirty: true });
            }
            setRepoRefreshRequired(false);
            setHasGithubRepoAccess(true);
        } catch (error: any) {
            if (latestBranchRequestKeyRef.current !== normalizedUrl) return;
            setBranchOptions([]);
            const needsRefresh = hasGithubIdentity && isGithubAccessRefreshError(error?.message);
            setRepoRefreshRequired(needsRefresh);
            if (needsRefresh) {
                setHasGithubRepoAccess(false);
            }
        } finally {
            if (latestBranchRequestKeyRef.current === normalizedUrl) {
                setIsLoadingBranches(false);
            }
        }
    }, [getValues, hasGithubIdentity, importSourceMetadata.githubInstallationId, mergeImportSourceMetadata, normalizeGitHubRepoUrl, setValue]);

    const runRepoAnalysis = useCallback(async (nextRepoUrl: string, installationId?: number | null) => {
        const normalizedUrl = normalizeGitHubRepoUrl(nextRepoUrl || '');
        if (!normalizedUrl) {
            setAnalysisResult(null);
            return;
        }

        setIsAnalyzing(true);
        try {
            const response = await fetchGithubImportAnalysis({
                repoUrl: normalizedUrl,
                installationId: installationId ?? importSourceMetadata.githubInstallationId ?? null,
            });
            const result = response.result;
            if (!result) {
                setAnalysisResult(null);
                return;
            }
            setAnalysisResult(result);
            if (result.title) setValue('title', result.title, { shouldDirty: true });
            if (result.description) setValue('description', result.description, { shouldDirty: true });
            if (result.technologies.length > 0) {
                setValue('technologies_used', result.technologies, { shouldDirty: true });
            }
        } catch (error: any) {
            if (error?.name !== 'AbortError') {
                console.error('Failed to analyze repository', error);
            }
        } finally {
            setIsAnalyzing(false);
        }
    }, [importSourceMetadata.githubInstallationId, normalizeGitHubRepoUrl, setValue]);

    const runPreflightChecks = useCallback(async (nextRepoUrl?: string, nextBranch?: string | null) => {
        const normalizedUrl = normalizeGitHubRepoUrl(nextRepoUrl || repoUrl || '');
        latestPreflightRequestKeyRef.current = normalizedUrl;

        if (!normalizedUrl) {
            setPreflightState({
                status: 'error',
                warnings: [],
                error: 'Enter a valid GitHub repository URL.',
                authSource: null,
            });
            mergeImportSourceMetadata({
                githubPreflightStatus: 'error',
                githubPreflightError: 'Enter a valid GitHub repository URL.',
                githubPreflightCheckedAt: new Date().toISOString(),
            });
            return false;
        }

        setPreflightState({ status: 'loading', warnings: [], error: null, authSource: null });
        try {
            const installationId = importSourceMetadata.githubInstallationId ?? null;
            const result = await fetchGithubImportPreflight({
                repoUrl: normalizedUrl,
                branch: nextBranch ?? branch ?? null,
                installationId,
            });
            if (latestPreflightRequestKeyRef.current !== normalizedUrl) return false;
            const [repoOwner = null, repoName = null] = result.repo.fullName.split('/');

            setValue('import_source.repoUrl', result.normalizedRepoUrl, { shouldDirty: true });
            if (result.branch) {
                setValue('import_source.branch', result.branch, { shouldDirty: true });
            }
            mergeImportSourceMetadata({
                ...result.metadata,
                githubRepoId: result.repo.id,
                githubOwner: repoOwner,
                githubName: repoName,
                githubVisibility: result.repo.visibility,
                githubInstallationId: result.auth.installationId,
                githubPreflightStatus: 'ok',
                githubPreflightWarnings: result.warnings,
                githubPreflightError: null,
                githubPreflightCheckedAt: result.checkedAt,
            });
            setPreflightState({
                status: 'ok',
                warnings: result.warnings,
                error: null,
                authSource: result.auth.source,
            });
            await loadBranchesForRepo(result.normalizedRepoUrl);
            await runRepoAnalysis(result.normalizedRepoUrl, result.auth.installationId);
            return true;
        } catch (error: any) {
            if (latestPreflightRequestKeyRef.current !== normalizedUrl) return false;
            const message = error?.message || 'Preflight failed.';
            setPreflightState({ status: 'error', warnings: [], error: message, authSource: null });
            mergeImportSourceMetadata({
                githubPreflightStatus: 'error',
                githubPreflightError: message,
                githubPreflightCheckedAt: new Date().toISOString(),
            });
            setRepoRefreshRequired(hasGithubIdentity && isGithubAccessRefreshError(message));
            return false;
        }
    }, [branch, hasGithubIdentity, importSourceMetadata.githubInstallationId, loadBranchesForRepo, mergeImportSourceMetadata, normalizeGitHubRepoUrl, repoUrl, runRepoAnalysis, setValue]);

    const loadGithubPreview = useCallback(async (nextRepoUrl?: string, nextBranch?: string | null) => {
        const normalizedUrl = normalizeGitHubRepoUrl(nextRepoUrl || repoUrl || '');
        if (!normalizedUrl) {
            setShowManualGithubEntry(true);
            setIsEditingResolvedRepo(true);
            setPreflightState({
                status: 'error',
                warnings: [],
                error: 'Enter a valid GitHub repository URL.',
                authSource: null,
            });
            return;
        }

        const preflightOk = await runPreflightChecks(normalizedUrl, nextBranch ?? branch ?? null);
        if (!preflightOk) {
            setShowManualGithubEntry(true);
            setIsEditingResolvedRepo(true);
            return;
        }

        setShowManualGithubEntry(true);
        setIsEditingResolvedRepo(false);
        await startGithubRootPreview(normalizedUrl);
    }, [branch, normalizeGitHubRepoUrl, repoUrl, runPreflightChecks, startGithubRootPreview]);

    const handlePickRepository = useCallback(async (item: GithubImportRepoItem) => {
        setGithubEntryMode('browse');
        setValue('import_source.repoUrl', item.htmlUrl, { shouldDirty: true });
        if (item.defaultBranch) {
            setValue('import_source.branch', item.defaultBranch, { shouldDirty: true });
        }
        mergeImportSourceMetadata({
            githubRepoId: item.id,
            githubOwner: item.owner,
            githubName: item.name,
            githubVisibility: item.visibility,
            githubInstallationId: null,
            githubPreflightStatus: 'idle',
            githubPreflightError: null,
            githubPreflightWarnings: [],
        });
        setRepoPickerOpen(false);
        await loadGithubPreview(item.htmlUrl, item.defaultBranch);
    }, [loadGithubPreview, mergeImportSourceMetadata, setValue]);

    useEffect(() => {
        if (activeSourceView !== 'github' || !repoPickerOpen || !hasGithubRepoAccess) return;
        const timer = setTimeout(() => {
            void loadRepositories(true, null);
        }, 250);
        return () => clearTimeout(timer);
    }, [activeSourceView, hasGithubRepoAccess, loadRepositories, repoPickerOpen, repoQuery]);

    useEffect(() => {
        if (activeSourceView !== 'github' || !repoUrl) {
            setBranchOptions([]);
            setPreflightState({ status: 'idle', warnings: [], error: null, authSource: null });
            setAnalysisResult(null);
            return;
        }
    }, [activeSourceView, repoUrl]);

    useEffect(() => {
        if (activeSourceView !== 'github') return;
        if (repoUrl || branch || preflightState.status !== 'idle') {
            setShowManualGithubEntry(true);
        }
        if (preflightState.status === 'ok') {
            setIsEditingResolvedRepo(false);
        }
    }, [activeSourceView, branch, preflightState.status, repoUrl]);

    const handleBrowseClick = () => {
        fileInputRef.current?.click();
    };

    const processUploadFiles = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return;

        setUploadFiles(files);
        const currentMetadata = ((getValues('import_source.metadata') || {}) as ImportSourceMetadata);
        setValue(
            'import_source',
            {
                ...(getValues('import_source') || {}),
                type: 'upload',
                metadata: {
                    ...currentMetadata,
                    fileCount: files.length,
                    folderName: files[0].webkitRelativePath?.split('/')[0] || 'Uploaded Files',
                },
            },
            { shouldDirty: true, shouldValidate: true }
        );

        setIsAnalyzing(true);
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        (window as any)._folderAnalysisController = controller;

        try {
            const { analyzeUploadedFolder } = await import('@/lib/upload/analyze-folder');
            const analysis = await analyzeUploadedFolder(files, controller?.signal);
            if (analysis.title || (analysis.technologies && analysis.technologies.length > 0)) {
                setAnalysisResult(analysis);
                if (analysis.title) setValue('title', analysis.title, { shouldDirty: true });
                if (analysis.description) setValue('description', analysis.description, { shouldDirty: true });
                if (analysis.technologies.length > 0) {
                    setValue('technologies_used', analysis.technologies, { shouldDirty: true });
                }
            }
        } catch (error) {
            console.error('Folder analysis failed:', error);
        } finally {
            setIsAnalyzing(false);
        }
    }, [getValues, setUploadFiles, setValue]);

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        await processUploadFiles(event.target.files);
    };

    const handleUploadDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!isDragOverUpload) {
            setIsDragOverUpload(true);
        }
    }, [isDragOverUpload]);

    const handleUploadDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && event.currentTarget.contains(nextTarget)) {
            return;
        }
        setIsDragOverUpload(false);
    }, []);

    const handleUploadDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDragOverUpload(false);
        const files = event.dataTransfer?.files ?? null;
        await processUploadFiles(files);
    }, [processUploadFiles]);

    const rootEntries = githubFolderEntries[''] || githubPreview.rootEntries || [];
    const allLoadedEntries = Object.values(githubFolderEntries).flat();
    const loadedCounts = allLoadedEntries.reduce(
        (acc, entry) => {
            if (entry.excludedReason === 'ignored') acc.ignored += 1;
            else if (entry.excludedReason === 'tooLarge') acc.tooLarge += 1;
            else if (entry.type === 'dir') acc.folders += 1;
            else if (entry.type === 'file') acc.files += 1;
            return acc;
        },
        { files: 0, folders: 0, ignored: 0, tooLarge: 0 }
    );

    const toggleFolder = useCallback(async (folderPath: string, isDisabled: boolean) => {
        if (isDisabled) return;

        setExpandedFolders((prev) => {
            const next = new Set(prev);
            if (next.has(folderPath)) next.delete(folderPath);
            else next.add(folderPath);
            return next;
        });

        if (!expandedFolders.has(folderPath) && !githubFolderEntries[folderPath] && !loadingFolders.has(folderPath)) {
            setLoadingFolders((prev) => new Set(prev).add(folderPath));
            try {
                await loadGithubFolder(folderPath);
            } finally {
                setLoadingFolders((prev) => {
                    const next = new Set(prev);
                    next.delete(folderPath);
                    return next;
                });
            }
        }
    }, [expandedFolders, githubFolderEntries, loadGithubFolder]);

    const renderTree = useCallback((entries: GithubPreviewEntry[], depth: number) => {
        if (!entries || entries.length === 0) {
            return (
                <div className="py-2 text-xs text-zinc-500 dark:text-zinc-400">
                    No files found at this level.
                </div>
            );
        }

        return (
            <div className="space-y-1">
                {entries.map((entry) => {
                    const isFolder = entry.type === 'dir';
                    const disabled = entry.excludedReason === 'ignored' || entry.excludedReason === 'tooLarge';
                    const isExpanded = isFolder && expandedFolders.has(entry.path);
                    const isLoading = isFolder && loadingFolders.has(entry.path);
                    const children = isFolder ? githubFolderEntries[entry.path] : undefined;

                    return (
                        <div key={entry.path}>
                            <div
                                className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-xs ${
                                    disabled ? 'opacity-60' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                                }`}
                                style={{ paddingLeft: 8 + depth * 12 }}
                            >
                                {isFolder ? (
                                    <button
                                        type="button"
                                        onClick={() => toggleFolder(entry.path, disabled)}
                                        className="flex w-full min-w-0 items-center gap-2 text-left"
                                        disabled={disabled}
                                    >
                                        <span className="w-3 text-zinc-400">{isLoading ? '…' : isExpanded ? '▾' : '▸'}</span>
                                        <span className="min-w-0 truncate font-medium text-zinc-800 dark:text-zinc-100">
                                            <span aria-hidden="true">📁 </span>
                                            <span className="sr-only">Folder: </span>
                                            {entry.name}
                                        </span>
                                    </button>
                                ) : (
                                    <div className="flex w-full min-w-0 items-center gap-2">
                                        <span className="w-3" />
                                        <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-200">
                                            <span aria-hidden="true">📄 </span>
                                            <span className="sr-only">File: </span>
                                            {entry.name}
                                        </span>
                                    </div>
                                )}

                                {entry.excludedReason === 'ignored' && (
                                    <span className="ml-auto shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-600 dark:text-zinc-300">
                                        Ignored
                                    </span>
                                )}
                                {entry.excludedReason === 'tooLarge' && (
                                    <span className="ml-auto shrink-0 rounded-full bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                                        Too large
                                    </span>
                                )}
                            </div>

                            {isFolder && isExpanded && !disabled && (
                                <div className="mt-1">
                                    {isLoading ? (
                                        <div className="py-2 text-xs text-zinc-500 dark:text-zinc-400" style={{ paddingLeft: 20 + depth * 12 }}>
                                            Loading…
                                        </div>
                                    ) : (
                                        renderTree(children || [], depth + 1)
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    }, [expandedFolders, githubFolderEntries, loadingFolders, toggleFolder]);

    const renderSourceCards = () => (
        <div className="mx-auto max-w-5xl space-y-8" data-testid="create-project-phase1-source-grid">
            <div className="space-y-2 text-center">
                <h3 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                    How would you like to start?
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Pick one starting point. The detailed workflow opens after you choose it.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                {sourceCards.map((card) => {
                    const Icon = card.icon;
                    return (
                        <button
                            key={card.type}
                            type="button"
                            onClick={() => handleSelectSource(card.type)}
                            data-testid={`create-project-source-card-${card.type}`}
                            className="group rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-left transition-all hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-lg"
                        >
                            <div className="flex flex-col items-center text-center">
                                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                                    <Icon className="h-8 w-8" />
                                </div>
                                <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                    {card.title}
                                </div>
                                <p className="mt-3 text-sm leading-7 text-zinc-500 dark:text-zinc-400">
                                    {card.description}
                                </p>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );

    const renderBackToStart = () => (
        <button
            type="button"
            onClick={() => setActiveSourceView(null)}
            data-testid="create-project-back-to-source-grid"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
            <ArrowLeft className="h-4 w-4" />
            Back to start options
        </button>
    );

    const renderScratchView = () => (
        <div className="mx-auto max-w-5xl space-y-6" data-testid="create-project-source-view-scratch">
            {renderBackToStart()}
            <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8">
                <div className="flex items-start gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <Code2 className="h-7 w-7" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                            Start from Scratch
                        </h3>
                        <p className="mt-2 text-sm leading-7 text-zinc-500 dark:text-zinc-400">
                            No import is required here. Continue when you want to configure the project manually in the next steps.
                        </p>
                    </div>
                </div>

                <div className="mt-8 grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 p-5">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                            No import overhead
                        </div>
                        <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
                            You move directly into project type, core details, team setup, settings, and review.
                        </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 p-5">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                            Best fit
                        </div>
                        <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
                            Use this when the codebase does not exist yet or when you want a clean project shell before importing files later.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderGithubView = () => {
        const normalizedRepoUrl = normalizeGitHubRepoUrl(repoUrl || '');
        const manualUrlLooksIncomplete =
            normalizedRepoUrl && !normalizedRepoUrl.includes('/') && !normalizedRepoUrl.includes('github.com/');
        const selectedRepoName =
            (importSourceMetadata.githubOwner && importSourceMetadata.githubName)
                ? `${String(importSourceMetadata.githubOwner)}/${String(importSourceMetadata.githubName)}`
                : '';
        const fallbackRepoName = normalizedRepoUrl.startsWith('https://github.com/')
            ? normalizedRepoUrl.replace('https://github.com/', '')
            : normalizedRepoUrl;
        const repoDisplayName = selectedRepoName || fallbackRepoName;
        const repoVisibility =
            typeof importSourceMetadata.githubVisibility === 'string'
                ? String(importSourceMetadata.githubVisibility)
                : null;
        const resolvedBranch = branch || githubPreview.branch || null;
        const hasResolvedGithubRepo = preflightState.status === 'ok' && Boolean(normalizedRepoUrl);
        const showResolvedSummary = hasResolvedGithubRepo && !isEditingResolvedRepo;
        const showDisconnectedCompactState =
            !isLoadingAuth
            && !hasGithubIdentity
            && !showManualGithubEntry
            && !showResolvedSummary;
        const showMethodTabs = hasGithubRepoAccess && !showResolvedSummary;
        const showBrowsePanel = !showResolvedSummary && hasGithubRepoAccess && githubEntryMode === 'browse';
        const showPastePanel =
            !showResolvedSummary
            && (
                githubEntryMode === 'paste'
                || !hasGithubRepoAccess
                || showManualGithubEntry
            );
        const showBranchEditor = isEditingResolvedRepo && hasResolvedGithubRepo;
        const showGithubDetails =
            showResolvedSummary
            || isAnalyzing
            || githubPreview.status !== 'idle'
            || Boolean(analysisResult);

        return (
            <div className="mx-auto max-w-5xl space-y-6" data-testid="create-project-source-view-github">
                {renderBackToStart()}

                <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8">
                    <div className="flex flex-col gap-3">
                        <div className="flex items-start gap-4">
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                                <Github className="h-7 w-7" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                                        Import from GitHub
                                    </h3>
                                    {isLoadingAuth ? (
                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            Checking access
                                        </span>
                                    ) : hasGithubIdentity ? (
                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                                            <Check className="h-3.5 w-3.5" />
                                            Connected{ghUsername ? ` as @${ghUsername}` : ''}
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                                            GitHub not connected
                                        </span>
                                    )}
                                </div>
                                <p className="mt-2 text-sm leading-7 text-zinc-500 dark:text-zinc-400">
                                    Connect GitHub to browse repositories, or paste a repository link manually. The interface only expands when there is real repo information to show.
                                </p>
                            </div>
                        </div>

                        {showDisconnectedCompactState ? (
                            <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 p-6">
                                <div className="max-w-2xl space-y-4">
                                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                        Connect GitHub if you want a repository picker. If not, you can still paste a repository link and continue with a manual import flow.
                                    </p>
                                    <div className="flex flex-wrap items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={handleConnectGithub}
                                            data-testid="create-project-connect-github"
                                            disabled={isConnectingGithub}
                                            className="rounded-full app-accent-solid px-4 py-2 text-sm font-semibold"
                                        >
                                            {isConnectingGithub ? (
                                                <span className="inline-flex items-center gap-2">
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    Redirecting to GitHub
                                                </span>
                                            ) : 'Connect GitHub'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowManualGithubEntry(true);
                                                setGithubEntryMode('paste');
                                                setIsEditingResolvedRepo(true);
                                            }}
                                            className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-300"
                                        >
                                            Paste link manually
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="mt-6 space-y-5">
                                {showMethodTabs && (
                                    <div className="inline-flex rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 p-1">
                                        <button
                                            type="button"
                                            onClick={() => setGithubEntryMode('paste')}
                                            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                                                githubEntryMode === 'paste'
                                                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                                                    : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                                            }`}
                                        >
                                            Paste link
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setGithubEntryMode('browse')}
                                            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                                                githubEntryMode === 'browse'
                                                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                                                    : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                                            }`}
                                        >
                                            Browse repos
                                        </button>
                                    </div>
                                )}

                                {repoRefreshRequired && hasGithubIdentity && !showResolvedSummary && (
                                    <div className="rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-900/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <span>
                                                GitHub access needs a quick refresh before repository browsing can resume.
                                            </span>
                                            <button
                                                type="button"
                                                onClick={handleConnectGithub}
                                                disabled={isConnectingGithub}
                                                className="inline-flex items-center gap-2 rounded-full border border-amber-300 dark:border-amber-700 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:text-amber-200"
                                            >
                                                {isConnectingGithub ? (
                                                    <>
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                        Refreshing access
                                                    </>
                                                ) : (
                                                    <>
                                                        <RefreshCcw className="h-3.5 w-3.5" />
                                                        Refresh access
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {showResolvedSummary && (
                                    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 p-5">
                                        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                                            <div className="min-w-0">
                                                <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                                    {repoDisplayName}
                                                </div>
                                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                                                    {repoVisibility && (
                                                        <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 font-medium text-zinc-700 dark:text-zinc-200">
                                                            {repoVisibility}
                                                        </span>
                                                    )}
                                                    {resolvedBranch && (
                                                        <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 font-medium text-zinc-700 dark:text-zinc-200">
                                                            Branch: {resolvedBranch}
                                                        </span>
                                                    )}
                                                    {preflightState.authSource && (
                                                        <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 font-medium text-zinc-700 dark:text-zinc-200">
                                                            Auth: {preflightState.authSource}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setIsEditingResolvedRepo(true);
                                                    setShowManualGithubEntry(true);
                                                    setGithubEntryMode(hasGithubRepoAccess ? 'browse' : 'paste');
                                                }}
                                                className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                            >
                                                Change
                                            </button>
                                        </div>
                                        {preflightState.warnings.length > 0 && (
                                            <div className="mt-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-900/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                                                {preflightState.warnings.join(' ')}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {showBrowsePanel && (
                                    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 p-5">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <div>
                                                <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                                                    Browse repositories
                                                </div>
                                                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                                                    Pick a repository directly from your connected GitHub account.
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                disabled={!hasGithubRepoAccess}
                                                onClick={() => setRepoPickerOpen((prev) => !prev)}
                                                data-testid="create-project-github-repo-picker-trigger"
                                                className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                                            >
                                                {selectedRepoName || 'Choose repository'}
                                                <ChevronDown className="h-4 w-4" />
                                            </button>
                                        </div>

                                        {repoPickerOpen && hasGithubRepoAccess && (
                                            <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950/70 p-4">
                                                <input
                                                    type="text"
                                                    value={repoQuery}
                                                    onChange={(e) => setRepoQuery(e.target.value)}
                                                    placeholder="Search your repositories"
                                                    data-testid="create-project-github-repo-search"
                                                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                                                />
                                                {repoLoadError && (
                                                    <div className="mt-3 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/70 dark:bg-red-900/10 px-3 py-3 text-sm text-red-700 dark:text-red-300">
                                                        {repoLoadError}
                                                    </div>
                                                )}
                                                <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
                                                    {repoItems.length === 0 && !isLoadingRepos && !repoLoadError && (
                                                        <div className="px-3 py-4 text-sm text-zinc-500 dark:text-zinc-400">
                                                            {repoLoadedOnce
                                                                ? (repoQuery
                                                                    ? 'No repositories matched this search.'
                                                                    : 'No connected repositories were returned for this account.')
                                                                : 'Open the picker to load repositories from your connected GitHub account.'}
                                                        </div>
                                                    )}
                                                    {repoItems.map((item) => {
                                                        const isSelected = normalizeGitHubRepoUrl(repoUrl || '') === item.htmlUrl;
                                                        return (
                                                            <button
                                                                key={`${item.id}-${item.fullName}`}
                                                                type="button"
                                                                onClick={() => void handlePickRepository(item)}
                                                                className={`w-full border-b border-zinc-100 dark:border-zinc-800 px-3 py-3 text-left last:border-b-0 ${
                                                                    isSelected
                                                                        ? 'bg-primary/5 dark:bg-primary/10'
                                                                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60'
                                                                }`}
                                                            >
                                                                <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                                    {item.fullName}
                                                                </div>
                                                                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                                                    {item.visibility}
                                                                    {item.defaultBranch ? ` · ${item.defaultBranch}` : ''}
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                    {isLoadingRepos && (
                                                        <div className="flex items-center gap-2 px-3 py-3 text-sm text-zinc-500 dark:text-zinc-400">
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                            Loading repositories...
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="mt-3 flex gap-3">
                                                    {repoCursor && (
                                                        <button
                                                            type="button"
                                                            onClick={() => void loadRepositories(false, repoCursor)}
                                                            disabled={isLoadingRepos}
                                                            className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                                                        >
                                                            Load more repositories
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => void loadRepositories(true, null)}
                                                        disabled={isLoadingRepos}
                                                        className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                                                    >
                                                        Refresh
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {showPastePanel && (
                                    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 p-5">
                                        <div>
                                            <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                                                Paste a repository link
                                            </div>
                                            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                                                Use <span className="font-medium text-zinc-800 dark:text-zinc-200">owner/repo</span> or a full GitHub repository URL.
                                            </p>
                                        </div>

                                        <div className="mt-4 relative">
                                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                                <Github className="h-4 w-4 text-zinc-400" />
                                            </div>
                                            <input
                                                type="text"
                                                autoFocus={activeSourceView === 'github'}
                                                value={repoUrl || ''}
                                                data-testid="create-project-github-manual-url"
                                                className="block w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 pl-9 pr-3 py-3 text-sm"
                                                placeholder="owner/repo or https://github.com/owner/repo"
                                                onChange={(e) => {
                                                    const normalized = normalizeGitHubRepoUrl(e.target.value);
                                                    setValue('import_source.repoUrl', normalized, { shouldDirty: true });
                                                    mergeImportSourceMetadata({
                                                        githubPreflightStatus: 'idle',
                                                        githubPreflightError: null,
                                                        githubPreflightWarnings: [],
                                                    });
                                                    setPreflightState({ status: 'idle', warnings: [], error: null, authSource: null });
                                                    setShowManualGithubEntry(true);
                                                    setIsEditingResolvedRepo(true);
                                                    setGithubEntryMode('paste');
                                                }}
                                            />
                                        </div>
                                        {manualUrlLooksIncomplete && (
                                            <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                                                Enter both owner and repository name. A GitHub username alone is not enough for import.
                                            </div>
                                        )}

                                        {showBranchEditor && (
                                            <div className="mt-4 space-y-2">
                                                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                                    Branch
                                                </label>
                                                {branchOptions.length > 0 ? (
                                                    <select
                                                        value={branch || ''}
                                                        data-testid="create-project-github-branch-select"
                                                        onChange={(e) => {
                                                            setValue('import_source.branch', e.target.value, { shouldDirty: true });
                                                            mergeImportSourceMetadata({
                                                                githubPreflightStatus: 'idle',
                                                                githubPreflightError: null,
                                                            });
                                                            setPreflightState({ status: 'idle', warnings: [], error: null, authSource: null });
                                                        }}
                                                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 px-3 py-3 text-sm dark:bg-zinc-800 dark:text-white"
                                                    >
                                                        {branchOptions.map((option) => (
                                                            <option key={option} value={option}>
                                                                {option}
                                                            </option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    <input
                                                        type="text"
                                                        value={branch || ''}
                                                        data-testid="create-project-github-branch-input"
                                                        onChange={(e) => {
                                                            setValue('import_source.branch', e.target.value, { shouldDirty: true });
                                                            mergeImportSourceMetadata({
                                                                githubPreflightStatus: 'idle',
                                                                githubPreflightError: null,
                                                            });
                                                            setPreflightState({ status: 'idle', warnings: [], error: null, authSource: null });
                                                        }}
                                                        placeholder="main"
                                                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 px-3 py-3 text-sm dark:bg-zinc-800 dark:text-white"
                                                    />
                                                )}
                                                {isLoadingBranches && (
                                                    <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                        Loading branches...
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div className="mt-5 flex flex-wrap items-center gap-3">
                                            <button
                                                type="button"
                                                disabled={!repoUrl || preflightState.status === 'loading' || githubPreview.status === 'loading'}
                                                onClick={() => void loadGithubPreview(repoUrl, branch || null)}
                                                data-testid="create-project-github-preview"
                                                className="flex items-center justify-center gap-2 rounded-xl app-accent-solid px-4 py-3 text-sm font-semibold disabled:opacity-50"
                                            >
                                                {preflightState.status === 'loading' || githubPreview.status === 'loading' ? (
                                                    <>
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                        Loading repository preview...
                                                    </>
                                                ) : (
                                                    <>
                                                        Load repository preview
                                                        <Sparkles className="h-4 w-4" />
                                                    </>
                                                )}
                                            </button>
                                            {!hasGithubRepoAccess && !hasGithubIdentity && (
                                                <button
                                                    type="button"
                                                    onClick={handleConnectGithub}
                                                    disabled={isConnectingGithub}
                                                    className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-3 text-sm font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                                >
                                                    {isConnectingGithub ? (
                                                        <span className="inline-flex items-center gap-2">
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                            Redirecting to GitHub
                                                        </span>
                                                    ) : 'Connect GitHub instead'}
                                                </button>
                                            )}
                                        </div>

                                        {preflightState.status === 'error' && preflightState.error && (
                                            <div className="mt-4 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/70 dark:bg-red-900/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                                                {preflightState.error}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {showGithubDetails && (
                                    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                                        {(isAnalyzing || analysisResult) && (
                                            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                                                <div className="flex items-center gap-2">
                                                    <Sparkles className="h-4 w-4 text-amber-500" />
                                                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                                        Detected stack
                                                    </span>
                                                </div>

                                                {isAnalyzing ? (
                                                    <div className="mt-4 flex items-center gap-2 text-sm text-primary">
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                        Analyzing repository...
                                                    </div>
                                                ) : analysisResult && analysisResult.technologies.length > 0 ? (
                                                    <div className="mt-4 flex flex-wrap gap-2">
                                                        {analysisResult.technologies.map((tech) => (
                                                            <span
                                                                key={tech}
                                                                className="rounded-full bg-primary/10 dark:bg-primary/20 px-3 py-1 text-xs font-medium text-primary"
                                                            >
                                                                {tech}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
                                                        No stack details detected yet for this repository.
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {(githubPreview.status !== 'idle' || showResolvedSummary) && (
                                            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                                            Repository files
                                                        </div>
                                                        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                                            Preview uses the same import rules that will apply during project creation.
                                                        </div>
                                                    </div>
                                                    {resolvedBranch && (
                                                        <span className="shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-200">
                                                            {resolvedBranch}
                                                        </span>
                                                    )}
                                                </div>

                                                {githubPreview.status === 'loading' && (
                                                    <div className="mt-4 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                        Loading repository preview...
                                                    </div>
                                                )}

                                                {githubPreview.status === 'error' && (
                                                    <div className="mt-4 space-y-3">
                                                        <div className="text-sm text-red-600 dark:text-red-400">
                                                            Preview failed: {githubPreview.errorMessage || 'Repository not found.'}
                                                        </div>
                                                        {repoRefreshRequired && hasGithubIdentity && (
                                                            <button
                                                                type="button"
                                                                onClick={handleConnectGithub}
                                                                disabled={isConnectingGithub}
                                                                className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                                            >
                                                                {isConnectingGithub ? (
                                                                    <span className="inline-flex items-center gap-2">
                                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                                        Refreshing GitHub access
                                                                    </span>
                                                                ) : (
                                                                    'Refresh GitHub access'
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>
                                                )}

                                                {githubPreview.status === 'ready' && (
                                                    <div className="mt-4 space-y-3">
                                                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                                            Loaded: {loadedCounts.folders} folders, {loadedCounts.files} files
                                                            {loadedCounts.ignored > 0 ? ` · ${loadedCounts.ignored} ignored` : ''}
                                                            {loadedCounts.tooLarge > 0 ? ` · ${loadedCounts.tooLarge} too large` : ''}
                                                        </div>
                                                        <div className="max-h-80 overflow-auto overflow-x-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/70 dark:bg-zinc-900/40 p-3">
                                                            {renderTree(rootEntries, 0)}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const renderUploadView = () => (
        <div className="mx-auto max-w-5xl space-y-6" data-testid="create-project-source-view-upload">
            {renderBackToStart()}

            <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8">
                <div className="flex items-start gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <FolderUp className="h-7 w-7" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                            Upload Folder
                        </h3>
                        <p className="mt-2 text-sm leading-7 text-zinc-500 dark:text-zinc-400">
                            Choose a local project folder and review the detected structure before continuing.
                        </p>
                    </div>
                </div>

                <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    // @ts-expect-error - webkitdirectory is a non-standard attribute
                    webkitdirectory=""
                    multiple
                    onChange={handleFileSelect}
                />

                <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                    <div
                        data-testid="create-project-upload-dropzone"
                        onDragOver={handleUploadDragOver}
                        onDragEnter={handleUploadDragOver}
                        onDragLeave={handleUploadDragLeave}
                        onDrop={(event) => void handleUploadDrop(event)}
                        className={`rounded-2xl border p-6 transition-colors ${
                            isDragOverUpload
                                ? 'border-primary bg-primary/5 dark:border-primary/60 dark:bg-primary/10'
                                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40'
                        }`}
                    >
                        {uploadProgress?.isUploading ? (
                            <div className="space-y-4 text-center">
                                <div className="flex items-center justify-center">
                                    <Loader2 className="h-7 w-7 animate-spin text-primary" />
                                </div>
                                <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                                    Uploading... {uploadProgress.percent}%
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-primary/10">
                                    <div
                                        className="h-full bg-primary transition-all duration-300"
                                        style={{ width: `${uploadProgress.percent}%` }}
                                    />
                                </div>
                                <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                                    {uploadProgress.currentFile}
                                </div>
                            </div>
                        ) : uploadFiles && uploadFiles.length > 0 ? (
                            <div className="space-y-4 text-center">
                                <div className="flex items-center justify-center">
                                    <Check className="h-7 w-7 text-green-500" />
                                </div>
                                <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                                    {uploadFiles.length} files selected
                                </div>
                                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                                    {analysisResult?.title ? `Detected project: ${analysisResult.title}` : 'The selected folder is attached to this import flow.'}
                                </div>
                                <button
                                    type="button"
                                    onClick={handleBrowseClick}
                                    className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                >
                                    Change folder
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-4 text-center">
                                <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                                    {isDragOverUpload ? 'Drop folder to attach it' : 'Select a project folder'}
                                </div>
                                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                                    Drag and drop a folder here, or browse directly from your machine.
                                </div>
                                <button
                                    type="button"
                                    onClick={handleBrowseClick}
                                    data-testid="create-project-upload-browse"
                                    className="rounded-xl app-accent-solid px-4 py-2 text-sm font-semibold"
                                >
                                    Browse folder
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="space-y-5">
                        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                                Upload notes
                            </div>
                            <div className="mt-4 space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
                                <p>Folder imports stay attached while you move through the wizard.</p>
                                <p>Once files are selected, Continue becomes available.</p>
                                <p>The import analysis pre-fills project details when the uploaded files contain enough structure.</p>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                            <div className="flex items-center gap-2">
                                <Sparkles className="h-4 w-4 text-amber-500" />
                                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                    Upload preview
                                </span>
                            </div>
                            {isAnalyzing ? (
                                <div className="mt-4 flex items-center gap-2 text-sm text-primary">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Inspecting uploaded files...
                                </div>
                            ) : analysisResult ? (
                                <div className="mt-4 space-y-3">
                                    {analysisResult.title && (
                                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                            {analysisResult.title}
                                        </div>
                                    )}
                                    {analysisResult.description && (
                                        <div className="text-sm text-zinc-600 dark:text-zinc-400">
                                            {analysisResult.description}
                                        </div>
                                    )}
                                    {analysisResult.technologies.length > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {analysisResult.technologies.map((tech) => (
                                                <span
                                                    key={tech}
                                                    className="rounded-full bg-primary/10 dark:bg-primary/20 px-3 py-1 text-xs font-medium text-primary"
                                                >
                                                    {tech}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
                                    Choose a folder to inspect the stack and prefill project details when possible.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    if (activeSourceView === 'scratch') {
        return renderScratchView();
    }
    if (activeSourceView === 'github') {
        return renderGithubView();
    }
    if (activeSourceView === 'upload') {
        return renderUploadView();
    }

    return renderSourceCards();
}
