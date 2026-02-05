'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useFormContext } from 'react-hook-form';
import { CreateProjectInput } from '@/lib/validations/project';
import { Github, Upload, Code2, FolderUp, Check, Loader2, Link as LinkIcon, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

export default function Phase1SourceSelection() {
    const { setValue, watch, formState: { errors } } = useFormContext<CreateProjectInput>();
    const importSourceType = watch('import_source.type');
    const repoUrl = watch('import_source.repoUrl');
    
    // Default to 'scratch' if undefined
    const selectedSource = importSourceType || 'scratch';
    
    // File Input Ref for Upload
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
    
    // Repo Analysis State
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<{
        title: string;
        description: string;
        technologies: string[];
    } | null>(null);
    
    // Upload Progress State
    const [uploadProgress, setUploadProgress] = useState<{
        percent: number;
        currentFile: string;
        isUploading: boolean;
    } | null>(null);
    
    // GitHub Auth State
    const [isConnected, setIsConnected] = useState(false);
    const [isLoadingAuth, setIsLoadingAuth] = useState(true);
    const [ghUsername, setGhUsername] = useState<string | null>(null);
    const supabase = createClient();

    useEffect(() => {
        const checkConnection = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (user?.app_metadata?.providers?.includes('github')) {
                    setIsConnected(true);
                    // Try to get username from identities
                    const githubIdentity = user.identities?.find((id: any) => id.provider === 'github');
                    if (githubIdentity?.identity_data?.user_name) {
                        setGhUsername(githubIdentity.identity_data.user_name);
                    }
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
    };

    const handleBrowseClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        
        setSelectedFiles(files);
        
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

        // Debounce analysis to avoid spamming GitHub API
        const timeout = setTimeout(async () => {
            setIsAnalyzing(true);
            try {
                const { analyzeGitHubRepo } = await import('@/lib/github/analyze-repo');
                const token = (await supabase.auth.getSession()).data.session?.provider_token;
                
                const result = await analyzeGitHubRepo(repoUrl, token || undefined, controller?.signal);
                
                if (result.title || result.technologies.length > 0) {
                    setAnalysisResult(result);
                    
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
    }, [repoUrl, setValue, supabase, importSourceType]);

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
                             {!isConnected ? (
                                <div className="flex flex-col items-center p-6 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700">
                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 text-center mb-4">
                                        Connect your account to access private repositories.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={handleConnectGithub}
                                        className="relative z-10 flex items-center justify-center gap-2 px-6 py-2.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-zinc-900 rounded-lg text-sm font-bold transition-all shadow-md hover:shadow-xl active:scale-95 cursor-pointer"
                                    >
                                        <Github className="w-4 h-4" />
                                        <span>Connect GitHub</span>
                                    </button>
                                </div>
                             ) : (
                                <>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                            Repository URL
                                        </label>
                                        {ghUsername && (
                                            <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1 font-medium bg-green-50 dark:bg-green-950/30 px-2 py-0.5 rounded-full">
                                                <Check className="w-3 h-3" />
                                                {ghUsername}
                                            </span>
                                        )}
                                    </div>
                                    {/* Upgrade Scope Helper */}
                                    <button
                                        type="button"
                                        onClick={handleConnectGithub}
                                        className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 underline underline-offset-2 mb-2 block text-right w-full"
                                    >
                                        Grant Private Access
                                    </button>
                                     <div className="relative">
                                         <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                             <Github className="h-4 w-4 text-zinc-400" />
                                         </div>
                                         <input
                                             type="text"
                                             autoFocus
                                             className="block w-full pl-9 pr-3 py-2 border-zinc-200 dark:border-zinc-700 rounded-lg dark:bg-zinc-800 dark:text-white text-sm focus:ring-2 focus:ring-slate-500 dark:focus:ring-slate-400 shadow-sm"
                                             placeholder="username/repo"
                                             onChange={(e) => setValue('import_source.repoUrl', e.target.value)}
                                         />
                                     </div>
                                     
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
                                             Authenticated access enabled
                                         </p>
                                     )}
                                </>
                             )}
                        </div>
                    ) : (
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center">
                            Clone a public or private repository. We'll analyze your stack automatically.
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
                                 // @ts-ignore - webkitdirectory is a non-standard attribute
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
                                   ) : selectedFiles && selectedFiles.length > 0 ? (
                                       <>
                                           <Check className="w-6 h-6 text-green-500 mb-2" />
                                           <p className="text-sm font-medium text-green-700 dark:text-green-300">
                                               {selectedFiles.length} files selected
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
