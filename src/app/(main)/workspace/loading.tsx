import WorkspaceSkeleton from '@/components/workspace/WorkspaceSkeleton';

export default function WorkspaceLoading() {
    return (
        <div className="h-full min-h-0 overflow-hidden bg-zinc-50 dark:bg-zinc-950">
            <WorkspaceSkeleton />
        </div>
    );
}
