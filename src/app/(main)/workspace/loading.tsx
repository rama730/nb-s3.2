import WorkspaceSkeleton from '@/components/workspace/WorkspaceSkeleton';

export default function WorkspaceLoading() {
    return (
        <div className="h-[calc(100vh-var(--header-height,56px)-40px)] min-h-0 overflow-hidden bg-zinc-50 dark:bg-zinc-950">
            <WorkspaceSkeleton />
        </div>
    );
}
