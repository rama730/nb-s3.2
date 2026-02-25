import { Skeleton } from "@/components/ui/skeleton"

export default function MessagesLoading() {
    return (
        <div className="flex h-full min-h-0">
            <div className="w-80 border-r border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
                <Skeleton className="h-10 w-full rounded-lg" />
                {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
                        <div className="flex-1 space-y-1.5">
                            <Skeleton className="h-4 w-3/4" />
                            <Skeleton className="h-3 w-1/2" />
                        </div>
                    </div>
                ))}
            </div>
            <div className="flex-1 p-6 space-y-4">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-64" />
            </div>
        </div>
    )
}
