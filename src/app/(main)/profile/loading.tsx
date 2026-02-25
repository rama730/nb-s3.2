import { Skeleton } from "@/components/ui/skeleton"

export default function ProfileLoading() {
    return (
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 space-y-6">
            <div className="relative">
                <Skeleton className="h-48 w-full rounded-xl" />
                <Skeleton className="h-24 w-24 rounded-full absolute -bottom-12 left-6 border-4 border-white dark:border-zinc-950" />
            </div>
            <div className="pt-14 space-y-3">
                <Skeleton className="h-7 w-48" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-4 w-96" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-4">
                    <Skeleton className="h-32 rounded-xl" />
                    <Skeleton className="h-48 rounded-xl" />
                </div>
                <div className="space-y-4">
                    <Skeleton className="h-40 rounded-xl" />
                    <Skeleton className="h-32 rounded-xl" />
                </div>
            </div>
        </div>
    )
}
