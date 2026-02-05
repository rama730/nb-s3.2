import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { memo, useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
    Users,
    Eye,
    Bookmark,
    BookmarkCheck,
    Briefcase,
    UserPlus,
    Sparkles,
    Maximize2,
    Check,
    Clock,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Project } from '@/types/hub';
import { useToggleProjectBookmark, useToggleProjectFollow } from '@/hooks/mutations/useProjectMutations';
import { ProjectCardViewModel } from '@/lib/view-models/project-card';


interface ProjectCardProps {
    project: Project;
    viewModel: ProjectCardViewModel; // New Prop
    fromTab?: string;
    onQuickView?: (project: Project) => void;
    viewMode?: string;
    selectionMode?: boolean;
    isSelected?: boolean;
    onToggleSelection?: () => void;
    previewMode?: boolean;
    isBookmarked?: boolean;
    isFollowing?: boolean;
    followersCount?: number;
}

export default memo(function ProjectCard({
    project,
    viewModel,
    fromTab = 'projects',
    onQuickView,
    viewMode = 'grid',
    selectionMode,
    isSelected,
    onToggleSelection,
    previewMode = false,
    isBookmarked: propIsBookmarked,
    isFollowing: propIsFollowing,
    followersCount: propFollowersCount = 0,
}: ProjectCardProps) {
    const supabase = createClient();
    const router = useRouter();
    // Removed prefetch hooks as part of architectural optimization
    const { mutate: toggleBookmarkMutation } = useToggleProjectBookmark();
    const { mutate: toggleFollowMutation } = useToggleProjectFollow();

    // OPTIMIZATION: Removed Debounce Ref (prefetching removed)
    // const prefetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const [bookmarked, setBookmarked] = useState(propIsBookmarked ?? false);
    const [followingProject, setFollowingProject] = useState(propIsFollowing ?? false);
    const [followersCount, setFollowersCount] = useState(propFollowersCount);

    useEffect(() => {
        if (propIsBookmarked !== undefined) setBookmarked(propIsBookmarked);
    }, [propIsBookmarked]);

    useEffect(() => {
        if (propIsFollowing !== undefined) setFollowingProject(propIsFollowing);
    }, [propIsFollowing]);

    useEffect(() => {
        if (propFollowersCount !== undefined) setFollowersCount(propFollowersCount);
    }, [propFollowersCount]);

    // VIEW MODEL USAGE: No useMemos or heavy logic here!
    const { 
        status, 
        techStack, 
        lastActive, 
        collaborators, 
        totalOpenRoles, 
        openRoles 
    } = viewModel;

    async function toggleBookmark(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        toggleBookmarkMutation({
            projectId: project.id,
            currentStatus: bookmarked,
            userId: user.id,
        });
        setBookmarked(!bookmarked);
    }

    async function toggleFollow(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        toggleFollowMutation({
            projectId: project.id,
            currentStatus: followingProject,
            userId: user.id,
        });
        setFollowingProject(!followingProject);
        setFollowersCount((prev) => (followingProject ? Math.max(0, prev - 1) : prev + 1));
    }

    // OPTIMIZATION: Removed prefetch logic
    // The previous implementation used router.prefetch and React Query prefetch on hover.
    // With the new "Instant Shell" architecture, the server response is O(1) and ultra-fast.
    // Client-side prefetching for Server Components often results in double-fetching or is ignored.
    // We rely on the speed of the optimized page.tsx and lazy hydrating tabs.

    if (viewMode === 'list') {
        return (
            <div
                className="group relative bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-lg dark:hover:shadow-black/40 transition-all duration-300 ease-out"
            >
                <Link
                    href={`/projects/${project.slug || project.id}?fromTab=${fromTab}`}
                    className="absolute inset-0 z-10"
                    aria-label={`View project ${project.title}`}
                />
                
                {/* Content Container (Row Layout) */}
                <div className="flex items-center gap-4 p-4 h-full relative z-0 pointer-events-none">
                    <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${status.gradient} shrink-0`} />
                    
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <h3 className="font-bold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                {project.title}
                            </h3>
                            {totalOpenRoles > 0 && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400">
                                    {totalOpenRoles} roles
                                </span>
                            )}
                        </div>
                        <p className="text-sm text-zinc-500 truncate">{project.shortDescription || project.description}</p>
                    </div>
                    
                    <div className="flex items-center gap-4 text-sm text-zinc-500 shrink-0">
                        <span className="flex items-center gap-1">
                            <Users className="w-4 h-4" /> {collaborators.length}
                        </span>
                        <span className="flex items-center gap-1">
                            <Eye className="w-4 h-4" /> {project.viewCount || 0}
                        </span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full transform transition-all duration-300 hover:-translate-y-1">
            <div className="group relative h-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm hover:shadow-xl hover:border-indigo-500/20 dark:hover:border-indigo-500/20 transition-all duration-300 overflow-hidden flex flex-col">
                {/* Selection Overlay */}
                {selectionMode && (
                    <div
                        onClick={(e) => {
                            e.preventDefault();
                            onToggleSelection?.();
                        }}
                        className="absolute inset-0 z-30 cursor-pointer bg-black/10 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    >
                        <div className="absolute top-4 left-4">
                            <div
                                className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-600'
                                    }`}
                            >
                                {isSelected && <Check className="w-4 h-4 text-white" />}
                            </div>
                        </div>
                    </div>
                )}

                <div className={previewMode ? 'flex flex-col h-full pointer-events-none' : 'flex flex-col h-full'}>
                    {!previewMode && <Link href={`/projects/${project.slug || project.id}?fromTab=${fromTab}`} className="absolute inset-0 z-0" />}

                    {/* Header */}
                    <div className="p-5 flex items-start justify-between relative z-20">
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200">
                                {viewModel.category}
                            </span>
                            {totalOpenRoles > 0 && (
                                <span className="opacity-100 group-hover:opacity-0 transition-opacity duration-500 ease-in-out flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                                    <Briefcase className="w-3 h-3" />
                                    {totalOpenRoles} Roles
                                </span>
                            )}
                        </div>

                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity transform translate-x-4 group-hover:translate-x-0 duration-200">
                            <button
                                onClick={(e) => {
                                    e.preventDefault();
                                    onQuickView?.(project);
                                }}
                                className="p-2 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-zinc-800 rounded-full transition-colors"
                                title="Quick View"
                            >
                                <Maximize2 className="w-4 h-4" />
                            </button>
                            <button
                                onClick={toggleBookmark}
                                className="p-2 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-zinc-800 rounded-full transition-colors"
                                title={bookmarked ? 'Remove Bookmark' : 'Bookmark'}
                            >
                                {bookmarked ? <BookmarkCheck className="w-4 h-4 text-indigo-600 fill-current" /> : <Bookmark className="w-4 h-4" />}
                            </button>
                            <button
                                onClick={toggleFollow}
                                className="p-2 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-zinc-800 rounded-full transition-colors"
                                title={followingProject ? 'Unfollow' : 'Follow'}
                            >
                                <UserPlus className={`w-4 h-4 ${followingProject ? 'text-emerald-600 fill-current' : ''}`} />
                            </button>
                        </div>
                    </div>

                    {/* Main Content */}
                    <div className="px-5 pb-20 flex-1">
                        <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 line-clamp-2 leading-snug group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors mb-2">
                            {project.title}
                        </h3>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 line-clamp-3 mb-6">
                            {project.shortDescription || project.description || 'No description provided.'}
                        </p>

                        {/* Tech Stack */}
                        <div className="flex flex-wrap gap-1.5 mb-6">
                            {techStack.slice(0, 3).map((tech: string) => (
                                <span key={tech} className="text-[10px] font-medium px-2 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                                    {tech}
                                </span>
                            ))}
                            {techStack.length > 3 && (
                                <span className="text-[10px] font-medium px-2 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                                    +{techStack.length - 3}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="absolute bottom-0 left-0 right-0 p-5 pt-0 flex items-center justify-between border-t border-transparent group-hover:border-zinc-100 dark:border-zinc-700 dark:group-hover:border-zinc-800 transition-colors">
                        <div className="flex items-center -space-x-2">
                            {collaborators.slice(0, 3).map((p, i) => (
                                <div key={i} className="w-8 h-8 rounded-full border-2 border-white dark:border-zinc-900 bg-zinc-100 dark:bg-zinc-800 overflow-hidden" title={p.full_name || undefined}>
                                    {p.avatar_url ? (
                                        <Image src={p.avatar_url} alt={p.full_name || 'Collaborator'} width={32} height={32} className="w-full h-full object-cover" sizes="32px" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-xs font-bold text-zinc-400">
                                            {p.full_name?.[0] || '?'}
                                        </div>
                                    )}
                                </div>
                            ))}
                            {collaborators.length === 0 && (
                                <div className="w-8 h-8 rounded-full border-2 border-white dark:border-zinc-900 bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-xs text-zinc-400">
                                    <Users className="w-3 h-3" />
                                </div>
                            )}
                        </div>

                        <div className="text-xs text-zinc-400 font-medium flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDistanceToNow(new Date(lastActive))} ago
                        </div>
                    </div>

                    {/* Hover Reveal Drawer - Shows Open Roles */}
                    {/* OPTIMIZATION: CSS-only transitions instead of framer-motion */}
                    <div className="absolute inset-x-0 bottom-0 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border-t border-indigo-100 dark:border-indigo-900/30 p-5 transform translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out z-20 flex flex-col justify-between shadow-lg">
                        {/* Quick Stats Row */}
                        <div className="flex items-center justify-between mb-4 text-xs font-medium text-zinc-500">
                            <div className="flex gap-4">
                                <span className="flex items-center gap-1.5">
                                    <Eye className="w-3 h-3" /> {project.viewCount || 0}
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <UserPlus className="w-3 h-3" /> {followersCount}
                                </span>
                            </div>
                            {totalOpenRoles > 0 ? (
                                <span className="text-indigo-600 dark:text-indigo-400 font-bold flex items-center gap-1">
                                    <Sparkles className="w-3 h-3" /> {totalOpenRoles} Open Roles
                                </span>
                            ) : (
                                <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                    <Check className="w-3 h-3" /> Team Full
                                </span>
                            )}
                        </div>

                        {/* Open Roles List (Animated by staggering via CSS delays if needed, or simple list) */}
                        <div className="space-y-2 mt-2 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar">
                            {totalOpenRoles > 0 ? (
                                <>
                                    {openRoles.map((role, i) => {
                                        // CSS Stagger effect (simple)
                                        const delayMs = i * 50; 
                                        return (
                                            <div
                                                key={role.id}
                                                className="flex items-center justify-between text-xs py-0.5 opacity-0 group-hover:opacity-100 translate-x-[-10px] group-hover:translate-x-0 transition-all duration-300"
                                                style={{ transitionDelay: `${delayMs}ms` }}
                                            >
                                                <span className="font-medium text-zinc-700 dark:text-zinc-300 truncate max-w-[75%]">
                                                    {role.title}
                                                </span>
                                                <span className="px-1.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-bold text-[9px]">
                                                    {role.available}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </>
                            ) : (
                                <div className="text-center py-2 text-xs text-zinc-400 italic">
                                    No open roles currently
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});
