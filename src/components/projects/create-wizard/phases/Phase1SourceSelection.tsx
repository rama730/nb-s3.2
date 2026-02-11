'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useFormContext } from 'react-hook-form';
import { CreateProjectInput } from '@/lib/validations/project';
import { Github, Upload, Code2, FolderUp, Check, Loader2, Link as LinkIcon, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { analyzeGithubRepoAction } from '@/app/actions/github';

export default function Phase1SourceSelection({
    uploadFiles,
    setUploadFiles,
    uploadProgress,
    githubPreview,
    githubFolderEntries,
    loadGithubFolder,
    startGithubRootPreview,
}: {
    uploadFiles: FileList | null;
    setUploadFiles: (files: FileList | null) => void;
    uploadProgress: { percent: number; currentFile: string; isUploading: boolean } | null;
    githubPreview: {
        status: 'idle' | 'loading' | 'ready' | 'error';
        repoUrl: string;
        branch: string | null;
        rootEntries: Array<{
            name: string;
            path: string;
            type: 'file' | 'dir';
            size?: number | null;
            excludedReason?: 'ignored' | 'tooLarge';
        }>;
        errorMessage: string | null;
    };
    githubFolderEntries: Record<string, Array<{
        name: string;
        path: string;
        type: 'file' | 'dir';
        size?: number | null;
        excludedReason?: 'ignored' | 'tooLarge';
    }>>;
    loadGithubFolder: (folderPath: string) => Promise<void>;
    startGithubRootPreview: (repoUrl: string) => Promise<void>;
}) {
    const { setValue, watch, formState: { errors } } = useFormContext<CreateProjectInput>();
    const importSourceType = watch('import_source.type');
    const repoUrl = watch('import_source.repoUrl');
    
    // Default to 'scratch' if undefined
    const selectedSource = importSourceType || 'scratch';
    
    // File Input Ref for Upload
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    // Repo Analysis State
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<{
        title: string;
        description: string;
        technologies: string[];
    } | null>(null);

    // GitHub file preview UI state (lazy tree)
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
    const [loadingFolders, setLoadingFolders] = useState<Set<string>>(() => new Set());
    
    // GitHub Auth State
    const [isConnected, setIsConnected] = useState(false);
    const [isLoadingAuth, setIsLoadingAuth] = useState(true);
    const [ghUsername, setGhUsername] = useState<string | null>(null);
    const supabase = createClient();

    const normalizeGitHubRepoUrl = useCallback((raw: string) => {
        const v = (raw || '').trim();
        if (!v) return '';

        // Already a URL
        if (v.startsWith('http://') || v.startsWith('https://')) {
            // Normalize to https and strip trailing slash
            return v.replace(/^http:\/\//, 'https://').replace(/\/+$/, '');
        }

        // Paste like "github.com/owner/repo"
        if (v.startsWith('github.com/')) {
            return `https://${v}`.replace(/\/+$/, '');
        }

        // Shorthand "owner/repo"
        if (/^[^\/\s]+\/[^\/\s]+$/.test(v)) {
            return `https://github.com/${v}`.replace(/\/+$/, '');
        }

        return v;
    }, []);

    useEffect(() => {
        const checkConnection = async () => {
            try {
                // Check SESSION for the provider token. 
                // We need the token to be present in the verification session to fetching private repos.
                const { data: { session } } = await supabase.auth.getSession();
                
                if (session?.provider_token) {
                    setIsConnected(true);
                    
                    // Try to get username from user identities if available
                    const { data: { user } } = await supabase.auth.getUser();
                    if (user) {
                        const githubIdentity = user.identities?.find((id: any) => id.provider === 'github');
                        if (githubIdentity?.identity_data?.user_name) {
                            setGhUsername(githubIdentity.identity_data.user_name);
                        }
                    }
                } else {
                    // Even if linked in app_metadata, if we don't have a token in this session, 
                    // we consider it "not connected" for the purpose of the wizard 
                    // (so the Connect button shows up to refresh the token).
                    setIsConnected(false);
                }
            } catch (e) {
                console.error("Failed to check GitHub connection", e);
            } finally {
                setIsLoadingAuth(false);
            }
        };
        
        checkConnection();
    }, []);

    const handleConnectGithub = async () => {
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'github',
                options: {
                    redirectTo: window.location.href,
                    scopes: 'repo', // Request private repo access
                }
            });
            if (error) throw error;
        } catch (e: any) {
            toast.error('Failed to connect GitHub: ' + e.message);
        }
    };

    const handleSelect = (type: 'scratch' | 'github' | 'upload') => {
        // Explicitly set type for all options to ensure state updates
        setValue('import_source', { type }, { shouldValidate: true, shouldDirty: true });
        if (type !== 'upload') {
            setUploadFiles(null);
        }
        if (type !== 'github') {
            setExpandedFolders(new Set());
        }
    };

    const handleBrowseClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        
        setUploadFiles(files);
        
        // Store file count in metadata
        setValue('import_source.metadata', { 
            fileCount: files.length,
            folderName: files[0].webkitRelativePath?.split('/')[0] || 'Uploaded Files'
        });
        
        // Analyze folder for package.json / README.md
        setIsAnalyzing(true);
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        (window as any)._folderAnalysisController = controller;

        try {
            const { analyzeUploadedFolder } = await import('@/lib/upload/analyze-folder');
            const analysis = await analyzeUploadedFolder(files, controller?.signal);
            
            if (analysis.title || (analysis.technologies && analysis.technologies.length > 0)) {
                setAnalysisResult(analysis);
                
                // Pre-fill form fields
                if (analysis.title) {
                    setValue('title', analysis.title, { shouldDirty: true });
                }
                if (analysis.description) {
                    setValue('description', analysis.description, { shouldDirty: true });
                }
                if (analysis.technologies && analysis.technologies.length > 0) {
                    setValue('technologies_used', analysis.technologies, { shouldDirty: true });
                }
                
                toast.success(`Analyzed! Detected: ${analysis.technologies.slice(0, 3).join(', ') || analysis.title}`, {
                    icon: '✨',
                });
            } else {
                toast.success(`Selected ${files.length} files`);
            }
        } catch (err) {
            console.error('Folder analysis failed:', err);
            toast.success(`Selected ${files.length} files`);
        } finally {
            setIsAnalyzing(false);
        }
    };

    // Analyze Repo    // GitHub Repo Analysis: Pure Optimization with AbortController
    useEffect(() => {
        if (importSourceType !== 'github' || !repoUrl) {
            setAnalysisResult(null);
            return;
        }

        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null; // Safe check
        setAnalysisResult(null); // Clear previous result while typing new URL

        // Debounce analysis to avoid spamming GitHub API
        const timeout = setTimeout(async () => {
            setIsAnalyzing(true);
            try {
                const response = await analyzeGithubRepoAction(repoUrl);
                if (!response.success || !response.result) return;
                const result = response.result;

                if (result.title || result.technologies.length > 0) {
                    setAnalysisResult(result as any);
                    
                    // Pre-fill form fields (Pure enhancements)
                    if (result.title) setValue('title', result.title, { shouldDirty: true });
                    if (result.description) setValue('description', result.description, { shouldDirty: true });
                    if (result.technologies.length > 0) setValue('technologies_used', result.technologies, { shouldDirty: true });
                    
                    toast.success('Repository analyzed! Fields pre-filled.', { icon: '✨' });
                }
            } catch (e: any) {
                if (e.name !== 'AbortError') console.error('Failed to analyze repo', e);
            } finally {
                setIsAnalyzing(false);
            }
        }, 1000);

        return () => {
            clearTimeout(timeout);
            controller?.abort();
        };
    }, [repoUrl, setValue, importSourceType]);

    const rootEntries = githubFolderEntries[''] || githubPreview.rootEntries || [];

    const allLoadedEntries = Object.values(githubFolderEntries).flat();
    const loadedCounts = allLoadedEntries.reduce(
        (acc, e) => {
            if (e.excludedReason === 'ignored') acc.ignored += 1;
            else if (e.excludedReason === 'tooLarge') acc.tooLarge += 1;
            else if (e.type === 'dir') acc.folders += 1;
            else if (e.type === 'file') acc.files += 1;
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

        // Lazy-load on expand
        if (!expandedFolders.has(folderPath) && !githubFolderEntries[folderPath]) {
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

    const renderTree = useCallback((entries: typeof rootEntries, depth: number) => {
        if (!entries || entries.length === 0) {
            return (
                <div className="text-xs text-zinc-500 dark:text-zinc-400 py-2">
                    No files found at this level.
                </div>
            );
        }

        return (
            <div className="space-y-1">
                {entries.map((e) => {
                    const isFolder = e.type === 'dir';
                    const disabled = e.excludedReason === 'ignored' || e.excludedReason === 'tooLarge';
                    const isExpanded = isFolder && expandedFolders.has(e.path);
                    const isLoading = isFolder && loadingFolders.has(e.path);
                    const children = isFolder ? githubFolderEntries[e.path] : undefined;

                    return (
                        <div key={e.path}>
                            <div
                                className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs min-w-0 ${
                                    disabled
                                        ? 'opacity-60'
                                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                                }`}
                                style={{ paddingLeft: 8 + depth * 12 }}
                            >
                                {isFolder ? (
                                    <button
                                        type="button"
                                        onClick={() => toggleFolder(e.path, disabled)}
                                        className="flex items-center gap-2 text-left w-full min-w-0"
                                        disabled={disabled}
                                    >
                                        <span className="w-3 text-zinc-400">{isLoading ? '…' : isExpanded ? '▾' : '▸'}</span>
                                        <span className="font-medium text-zinc-800 dark:text-zinc-100 min-w-0 truncate">📁 {e.name}</span>
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-2 w-full min-w-0">
                                        <span className="w-3" />
                                        <span className="text-zinc-700 dark:text-zinc-200 min-w-0 truncate">📄 {e.name}</span>
                                    </div>
                                )}

                                {e.excludedReason === 'ignored' && (
                                    <span className="ml-auto shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-600 dark:text-zinc-300">
                                        Ignored
                                    </span>
                                )}
                                {e.excludedReason === 'tooLarge' && (
                                    <span className="ml-auto shrink-0 rounded-full bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                                        Too large
                                    </span>
                                )}
                            </div>

                            {isFolder && isExpanded && !disabled && (
                                <div className="mt-1">
                                    {isLoading ? (
                                        <div className="text-xs text-zinc-500 dark:text-zinc-400 py-2" style={{ paddingLeft: 20 + depth * 12 }}>
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

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center space-y-2">
                <h3 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                    How would you like to start?
                </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
                {/* Scratch Card */}
                <div
                    onClick={() => handleSelect('scratch')}
                    className={`group relative flex flex-col items-center p-8 rounded-2xl border-2 transition-all duration-200 cursor-pointer hover:shadow-lg ${
                        selectedSource === 'scratch'
                            ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/30 dark:border-indigo-500'
                            : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700'
                    }`}
                >
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-6 transition-colors ${
                        selectedSource === 'scratch' ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-400' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 group-hover:bg-zinc-200 dark:group-hover:bg-zinc-700'
                    }`}>
                        <Code2 className="w-8 h-8" />
                    </div>
                    <h4 className={`text-lg font-semibold mb-2 ${selectedSource === 'scratch' ? 'text-indigo-900 dark:text-indigo-200' : 'text-zinc-900 dark:text-zinc-100'}`}>
                        Start from Scratch
                    </h4>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center">
                        Create a blank canvas. Best for new ideas and fresh starts.
                    </p>
                    
                    {selectedSource === 'scratch' && (
                        <div className="absolute top-4 right-4 w-3 h-3 bg-indigo-600 rounded-full animate-pulse" />
                    )}
                </div>

                {/* GitHub Card */}
                <div
                    onClick={() => handleSelect('github')}
                    className={`group relative flex flex-col items-center p-8 rounded-2xl border-2 transition-all duration-200 cursor-pointer hover:shadow-lg ${
                        selectedSource === 'github'
                            ? 'border-slate-800 bg-slate-50 dark:bg-slate-900/50 dark:border-slate-600'
                            : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700'
                    }`}
                >
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-6 transition-colors ${
                         selectedSource === 'github' ? 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-white' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 group-hover:bg-zinc-200 dark:group-hover:bg-zinc-700'
                    }`}>
                        <Github className="w-8 h-8" />
                    </div>
                    <h4 className={`text-lg font-semibold mb-2 ${selectedSource === 'github' ? 'text-slate-900 dark:text-white' : 'text-zinc-900 dark:text-zinc-100'}`}>
                        Import from GitHub
                    </h4>
                    
                    {selectedSource === 'github' ? (
                        <div 
                            className="w-full mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                        Repository URL
                                    </label>
                                    {isConnected ? (
                                        <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1 font-medium bg-green-50 dark:bg-green-950/30 px-2 py-0.5 rounded-full">
                                            <Check className="w-3 h-3" />
                                            {ghUsername || 'Connected'}
                                        </span>
                                    ) : (repoUrl && repoUrl.trim().length > 0) ? (
                                        <button
                                            type="button"
                                            onClick={handleConnectGithub}
                                            className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 underline underline-offset-2"
                                        >
                                            Connect for private repos
                                        </button>
                                    ) : (
                                        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                                            Paste a repo link to continue
                                        </span>
                                    )}
                                </div>

                                {/* Upgrade Scope Helper */}
                                {repoUrl && repoUrl.trim().length > 0 && (
                                    <button
                                        type="button"
                                        onClick={handleConnectGithub}
                                        className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 underline underline-offset-2 mb-2 block text-right w-full"
                                    >
                                        Grant Private Access
                                    </button>
                                )}

                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Github className="h-4 w-4 text-zinc-400" />
                                    </div>
                                    <input
                                        type="text"
                                        autoFocus
                                        value={repoUrl || ''}
                                        className="block w-full pl-9 pr-3 py-2 border-zinc-200 dark:border-zinc-700 rounded-lg dark:bg-zinc-800 dark:text-white text-sm focus:ring-2 focus:ring-slate-500 dark:focus:ring-slate-400 shadow-sm"
                                        placeholder="username/repo or https://github.com/owner/repo"
                                        onChange={(e) => setValue('import_source.repoUrl', normalizeGitHubRepoUrl(e.target.value))}
                                    />
                                </div>

                                {(repoUrl && repoUrl.trim().length > 0) ? (
                                    <button
                                        type="button"
                                        disabled={githubPreview.status === 'loading'}
                                        onClick={async () => {
                                            const url = normalizeGitHubRepoUrl(repoUrl || '');
                                            setValue('import_source.repoUrl', url);
                                            await startGithubRootPreview(url);
                                        }}
                                        className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 dark:bg-white dark:hover:bg-zinc-200 dark:disabled:bg-zinc-400 text-white dark:text-zinc-900 rounded-lg text-sm font-bold transition-colors"
                                    >
                                        {githubPreview.status === 'loading' ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Loading preview...
                                            </>
                                        ) : (
                                            <>
                                                Preview Repository
                                                <Sparkles className="w-4 h-4" />
                                            </>
                                        )}
                                    </button>
                                ) : (
                                    <div className="mt-3 text-[10px] text-zinc-500 dark:text-zinc-400 text-center">
                                        Paste a repo link to enable Continue.
                                    </div>
                                )}
                                
                                {/* Analysis Feedback */}
                                {isAnalyzing ? (
                                    <div className="flex items-center justify-center gap-2 mt-3 text-xs text-indigo-600 dark:text-indigo-400">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        <span>Analyzing repository...</span>
                                    </div>
                                ) : analysisResult && analysisResult.technologies.length > 0 ? (
                                    <div className="mt-3 animate-in fade-in slide-in-from-bottom-2">
                                        <div className="flex items-center gap-1.5 mb-2">
                                            <Sparkles className="w-3 h-3 text-amber-500" />
                                            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Detected Stack</span>
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {analysisResult.technologies.map((tech) => (
                                                <span 
                                                    key={tech}
                                                    className="px-2 py-0.5 text-[10px] font-medium bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded-full"
                                                >
                                                    {tech}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-xs text-zinc-500 mt-2 text-center flex items-center justify-center gap-1">
                                        <Check className="w-3 h-3 text-green-500" />
                                        {isConnected ? 'Authenticated access enabled' : 'Public repos supported'}
                                    </p>
                                )}

                                    {/* Repo file preview (loaded on Preview) */}
                                    {(githubPreview.status !== 'idle') && (
                                        <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-zinc-900/40 p-4 animate-in fade-in slide-in-from-top-2">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                                        Repository files preview
                                                    </div>
                                                </div>
                                                {githubPreview.branch && (
                                                    <span className="shrink-0 text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-2 py-0.5 rounded-full">
                                                        {githubPreview.branch}
                                                    </span>
                                                )}
                                            </div>

                                            
                                            {githubPreview.status === 'error' && (
                                                <div className="mt-3 space-y-3">
                                                    <div className="text-xs text-red-600 dark:text-red-400 font-medium">
                                                        Preview failed: {githubPreview.errorMessage || 'Repository not found.'}
                                                    </div>
                                                    <div className="flex items-center justify-end gap-2">
                                                        {!isConnected && (
                                                            <button
                                                                type="button"
                                                                onClick={handleConnectGithub}
                                                                className="px-3 py-1.5 text-xs font-semibold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-lg"
                                                            >
                                                                Connect GitHub
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {githubPreview.status === 'ready' && (
                                                <div className="mt-3 space-y-3">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                                                            Loaded: {loadedCounts.folders} folders, {loadedCounts.files} files
                                                            {loadedCounts.ignored > 0 ? ` · ${loadedCounts.ignored} ignored` : ''}
                                                            {loadedCounts.tooLarge > 0 ? ` · ${loadedCounts.tooLarge} too large` : ''}
                                                        </div>
                                                    </div>

                                                    <div className="max-h-56 overflow-auto overflow-x-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2">
                                                        {renderTree(rootEntries, 0)}
                                                    </div>

                                                    <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                                                        Preview applies import rules; ignored/oversized paths will not be imported.
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                            </>
                        </div>
                    ) : (
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center">
                            Clone a public or private repository. We will analyze your stack automatically.
                        </p>
                    )}
                    
                     {selectedSource === 'github' && (
                         <div className="absolute top-4 right-4 w-3 h-3 bg-slate-800 dark:bg-white rounded-full animate-pulse" />
                     )}
                </div>

                {/* Upload Card */}
                <div
                    onClick={() => handleSelect('upload')}
                    className={`group relative flex flex-col items-center p-8 rounded-2xl border-2 transition-all duration-200 cursor-pointer hover:shadow-lg ${
                         selectedSource === 'upload'
                             ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400'
                             : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700'
                     }`}
                >
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-6 transition-colors ${
                         selectedSource === 'upload' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 group-hover:bg-zinc-200 dark:group-hover:bg-zinc-700'
                    }`}>
                        <FolderUp className="w-8 h-8" />
                    </div>
                    <h4 className={`text-lg font-semibold mb-2 ${selectedSource === 'upload' ? 'text-blue-900 dark:text-blue-200' : 'text-zinc-900 dark:text-zinc-100'}`}>
                        Upload Folder
                    </h4>
                    
                    {selectedSource === 'upload' ? (
                        <div 
                            className="w-full mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
                            onClick={(e) => e.stopPropagation()}
                        >
                             {/* Hidden File Input for Folder Selection */}
                             <input
                                 ref={fileInputRef}
                                 type="file"
                                 className="hidden"
                                 // @ts-expect-error - webkitdirectory is a non-standard attribute
                                 webkitdirectory=""
                                 multiple
                                 onChange={handleFileSelect}
                             />
                             
                             <div className="border-2 border-dashed border-blue-200 dark:border-blue-800 bg-white/50 dark:bg-zinc-900/50 rounded-xl p-4 flex flex-col items-center justify-center text-center">
                                   {uploadProgress?.isUploading ? (
                                       <>
                                           <Loader2 className="w-6 h-6 text-blue-500 mb-2 animate-spin" />
                                           <p className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-2">
                                               Uploading... {uploadProgress.percent}%
                                           </p>
                                           <div className="w-full h-2 bg-blue-100 dark:bg-blue-900 rounded-full overflow-hidden">
                                               <div 
                                                   className="h-full bg-blue-500 transition-all duration-300 ease-out"
                                                   style={{ width: `${uploadProgress.percent}%` }}
                                               />
                                           </div>
                                           <p className="text-[10px] text-blue-600 dark:text-blue-400 mt-1 truncate max-w-full">
                                               {uploadProgress.currentFile}
                                           </p>
                                       </>
                                   ) : uploadFiles && uploadFiles.length > 0 ? (
                                       <>
                                           <Check className="w-6 h-6 text-green-500 mb-2" />
                                           <p className="text-sm font-medium text-green-700 dark:text-green-300">
                                               {uploadFiles.length} files selected
                                           </p>
                                           {/* Show detected stack if available */}
                                           {analysisResult && analysisResult.technologies.length > 0 && (
                                               <div className="flex flex-wrap gap-1 mt-2 justify-center">
                                                   {analysisResult.technologies.slice(0, 4).map((tech) => (
                                                       <span 
                                                           key={tech}
                                                           className="px-1.5 py-0.5 text-[9px] font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded"
                                                       >
                                                           {tech}
                                                       </span>
                                                   ))}
                                               </div>
                                           )}
                                           <button 
                                              type="button"
                                              onClick={handleBrowseClick}
                                              className="mt-2 px-3 py-1 text-xs text-blue-600 hover:text-blue-700 underline"
                                           >
                                              Change Selection
                                           </button>
                                       </>
                                   ) : (
                                       <>
                                           <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                                               Drag folder here
                                           </p>
                                           <button 
                                              type="button"
                                              onClick={handleBrowseClick}
                                              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors shadow-md active:scale-95"
                                           >
                                              Browse Folder
                                           </button>
                                       </>
                                   )}
                             </div>
                             <p className="text-xs text-blue-700 dark:text-blue-300 mt-2 text-center">
                                 Supports folders up to 5GB
                             </p>
                        </div>
                    ) : (
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center">
                             Drag & drop your local project folder. Fast, secure, and resume-capable.
                        </p>
                    )}
                    
                     {selectedSource === 'upload' && (
                         <div className="absolute top-4 right-4 w-3 h-3 bg-blue-600 rounded-full animate-pulse" />
                     )}
                </div>
            </div>
        </div>
    );
}
