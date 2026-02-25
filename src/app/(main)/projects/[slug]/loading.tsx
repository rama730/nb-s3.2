import { Skeleton } from "@/components/ui/skeleton"

export default function ProjectLoading() {
    return (
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-6">
            <div className="flex items-center gap-4">
                <Skeleton className="h-12 w-12 rounded-lg" />
                <div className="space-y-2">
                    <Skeleton className="h-7 w-64" />
                    <Skeleton className="h-4 w-96" />
                </div>
            </div>
            <div className="flex gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-9 w-20 rounded-lg" />
                ))}
            </div>
            <Skeleton className="h-[400px] w-full rounded-xl" />
        </div>
    )
}
