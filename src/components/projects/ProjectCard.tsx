import Link from 'next/link';
import Image from 'next/image';
import { memo, useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
    Users,
    Eye,
    Briefcase,
    UserPlus,
    Sparkles,
    Maximize2,
    Clock,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Project } from '@/types/hub';
import { useToggleProjectFollow } from '@/hooks/mutations/useProjectMutations';
import { ProjectCardViewModel } from '@/lib/view-models/project-card';
import { useRouteWarmPrefetch } from '@/hooks/useRouteWarmPrefetch';


interface ProjectCardProps {
    project: Project;
    viewModel: ProjectCardViewModel; // New Prop
    fromTab?: string;
    onQuickView?: (project: Project) => void;
    viewMode?: string;
    previewMode?: boolean;
    isFollowing?: boolean;
    followersCount?: number;
    onOpenProject?: (projectId: string) => void;
    disableHoverEffects?: boolean;
}

export default memo(function ProjectCard({
    project,
    viewModel,
    fromTab = 'projects',
    onQuickView,
    viewMode = 'grid',
    previewMode = false,
    isFollowing: propIsFollowing,
    followersCount: propFollowersCount = 0,
    onOpenProject,
    disableHoverEffects = false,
}: ProjectCardProps) {
    const supabase = createClient();
    // Removed prefetch hooks as part of architectural optimization
    const { mutateAsync: toggleFollowMutation } = useToggleProjectFollow();
    const warmPrefetchRoute = useRouteWarmPrefetch();
    const projectHref = `/projects/${project.slug || project.id}?fromTab=${fromTab}`;

    // OPTIMIZATION: Removed Debounce Ref (prefetching removed)
    // const prefetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const [followingProject, setFollowingProject] = useState(propIsFollowing ?? false);
    const [followersCount, setFollowersCount] = useState(propFollowersCount);

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
    const rankingReasons = project.rankingReasons || [];

    async function toggleFollow(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const nextFollowing = !followingProject;
        setFollowingProject(nextFollowing);
        setFollowersCount((prev) => (nextFollowing ? prev + 1 : Math.max(0, prev - 1)));

        try {
            const result = await toggleFollowMutation({
                projectId: project.id,
                currentStatus: followingProject,
                userId: user.id,
            });
            if (result?.followersCount !== undefined) {
                setFollowersCount(result.followersCount);
            }
        } catch {
            setFollowingProject(!nextFollowing);
            setFollowersCount((prev) => (!nextFollowing ? prev + 1 : Math.max(0, prev - 1)));
        }
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
                data-project-id={project.id}
                data-testid={`project-card-${project.id}`}
            >
                <Link
                    href={projectHref}
                    className="absolute inset-0 z-10"
                    aria-label={`View project ${project.title}`}
                    onClick={() => onOpenProject?.(project.id)}
                    onPointerEnter={() => warmPrefetchRoute(projectHref)}
                />
                
                {/* Content Container (Row Layout) */}
                <div className="flex items-center gap-4 h-full relative z-0 pointer-events-none app-density-panel">
                    <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${status.gradient} shrink-0`} />
                    
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <h3 className="font-bold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-primary transition-colors">
                                {project.title}
                            </h3>
                            {totalOpenRoles > 0 && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/10">
                                    {totalOpenRoles} roles
                                </span>
                            )}
                        </div>
                        <p className="text-sm text-zinc-500 truncate">{project.shortDescription || project.description}</p>
                        {rankingReasons.length > 0 && (
                            <div className="mt-1 flex items-center gap-1.5">
                                {rankingReasons.slice(0, 1).map((reason) => (
                                    <span
                                        key={reason}
                                        className="inline-flex items-center rounded-full border border-primary/15 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                                    >
                                        {reason}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                    
                    <div className="flex items-center gap-4 text-sm text-zinc-500 shrink-0">
                        <span className="flex items-center gap-1">
                            <Users className="w-4 h-4" /> {collaborators.length}
                        </span>
                        <span className="flex items-center gap-1" data-testid={`project-card-views-${project.id}`}>
                            <Eye className="w-4 h-4" /> {project.viewCount || 0}
                        </span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            className={`h-full ${disableHoverEffects ? '' : 'transform transition-all duration-300 hover:-translate-y-1'}`}
            data-project-id={project.id}
            data-testid={`project-card-${project.id}`}
            onMouseEnter={() => warmPrefetchRoute(projectHref)}
        >
            <div className={`group relative h-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden flex flex-col ${disableHoverEffects ? '' : 'transition-all duration-300 hover:-translate-y-1 hover:border-primary/20'}`}>

                <div className={previewMode ? 'flex flex-col h-full pointer-events-none' : 'flex flex-col h-full'}>
                    {!previewMode && (
                        <Link
                            href={projectHref}
                            className="absolute inset-0 z-0"
                            onClick={() => onOpenProject?.(project.id)}
                            onPointerEnter={() => warmPrefetchRoute(projectHref)}
                        />
                    )}

                    {/* Header */}
                    <div className="flex items-center justify-between relative z-20 app-density-panel">
                        <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                            {viewModel.category}
                        </span>
                        
                        {totalOpenRoles > 0 && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/15 text-[10px] font-bold text-primary">
                                <Sparkles className="w-3 h-3" />
                                {totalOpenRoles} Open Roles
                            </span>
                        )}
                    </div>

                    {/* Main Content */}
                    <div className="px-[var(--ui-panel-padding)] pb-[var(--ui-panel-padding)] flex-1 flex flex-col">
                        {/* Title & Tagline */}
                        <div className="mb-2.5">
                            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 truncate leading-snug group-hover:text-primary transition-colors">
                                {project.title}
                            </h3>
                            {project.shortDescription && (
                                <p className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400 line-clamp-1 mt-0.5">
                                    {project.shortDescription}
                                </p>
                            )}
                        </div>

                        {/* Description (2-line clamp) */}
                        <div className="mb-3 flex-1 min-h-[40px]">
                            <p className="text-[13px] text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                                {project.description || project.shortDescription || 'No description provided.'}
                            </p>
                        </div>

                        {/* Ranking Reasons */}
                        {rankingReasons.length > 0 && (
                            <div className="mb-3 flex flex-wrap gap-1.5">
                                {rankingReasons.map((reason) => (
                                    <span
                                        key={reason}
                                        className="inline-flex items-center rounded-full border border-primary/15 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary"
                                    >
                                        {reason}
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Micro Tech Stack */}
                        {techStack.length > 0 && (
                            <div className="mt-auto">
                                <p className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 truncate" title={techStack.join(', ')}>
                                    {techStack.slice(0, 4).join(' • ')}
                                    {techStack.length > 4 && ` • +${techStack.length - 4}`}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Footer - Z-index elevated to ensure buttons are clickable over the absolute Link */}
                    <div className="relative z-20 mt-auto border-t border-zinc-100 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col gap-3 px-[var(--ui-panel-padding)] py-[calc(var(--ui-panel-padding)*0.75)]">
                        {/* Upper row: Metrics & Actions */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 text-xs font-semibold text-zinc-500">
                                <span className="flex items-center gap-1" data-testid={`project-card-views-${project.id}`} title="Views">
                                    <Eye className="w-3.5 h-3.5" /> {project.viewCount || 0}
                                </span>
                                <span className="flex items-center gap-1" data-testid={`project-card-followers-${project.id}`} title="Followers">
                                    <UserPlus className="w-3.5 h-3.5" /> {followersCount}
                                </span>
                            </div>
                            
                            <div className="flex items-center gap-1.5 text-zinc-400">
                                <button
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onQuickView?.(project);
                                    }}
                                    className="p-1.5 hover:text-primary hover:bg-white dark:hover:bg-zinc-800 rounded-md transition-colors border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700 shadow-sm"
                                    title="Quick View"
                                >
                                    <Maximize2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={toggleFollow}
                                    className="p-1.5 hover:text-emerald-600 hover:bg-white dark:hover:bg-zinc-800 rounded-md transition-colors border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700 shadow-sm"
                                    title={followingProject ? 'Unfollow' : 'Follow'}
                                    data-testid={`project-card-follow-${project.id}`}
                                >
                                    <UserPlus className={`w-3.5 h-3.5 ${followingProject ? 'text-emerald-600 fill-current' : ''}`} />
                                </button>
                            </div>
                        </div>

                        {/* Lower row: Avatars */}
                        <div className="flex items-center -space-x-1.5">
                            {collaborators.slice(0, 3).map((p, i) => (
                                <div key={i} className="w-6 h-6 rounded-full border-2 border-white dark:border-zinc-900 bg-zinc-100 dark:bg-zinc-800 overflow-hidden" title={p.full_name || undefined}>
                                    {p.avatar_url ? (
                                        <Image src={p.avatar_url} alt={p.full_name || 'Collaborator'} width={24} height={24} className="w-full h-full object-cover" sizes="24px" />
                                    ) : (
                                        <div className="w-full h-full app-accent-gradient flex items-center justify-center text-[10px] font-bold text-white">
                                            {p.full_name?.[0] || '?'}
                                        </div>
                                    )}
                                </div>
                            ))}
                            {collaborators.length > 3 && (
                                <div className="w-6 h-6 rounded-full border-2 border-white dark:border-zinc-900 bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-[9px] font-bold text-zinc-500">
                                    +{collaborators.length - 3}
                                </div>
                            )}
                            {collaborators.length === 0 && (
                                <div className="w-6 h-6 rounded-full border-2 border-white dark:border-zinc-900 bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-400">
                                    <Users className="w-3 h-3" />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});
