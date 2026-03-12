"use client";

import { useState, useEffect } from "react";
import { Loader2, FileText, Clock, CheckCircle, XCircle } from "lucide-react";
import Link from "next/link";
import { getMyApplicationsAction } from "@/app/actions/applications";

interface ApplicationsTabProps {
    initialUser: { id?: string | null } | null;
}

type MyApplicationsResponse = Awaited<ReturnType<typeof getMyApplicationsAction>>;
type MyApplication = MyApplicationsResponse extends { applications: infer T }
    ? T extends Array<infer U>
        ? U
        : never
    : never;

export default function ApplicationsTab({ initialUser }: ApplicationsTabProps) {
    const [applications, setApplications] = useState<MyApplication[]>([]);
    const [loading, setLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [nextCursor, setNextCursor] = useState<string | null>(null);

    useEffect(() => {
        async function fetchApplications() {
            if (!initialUser?.id) {
                setLoading(false);
                return;
            }

            try {
                const res = await getMyApplicationsAction({ limit: 20 });
                if (res?.success) {
                    setApplications(res.applications || []);
                    setHasMore(!!res.hasMore);
                    setNextCursor(res.nextCursor || null);
                } else {
                    setApplications([]);
                    setHasMore(false);
                    setNextCursor(null);
                }
            } catch (error) {
                console.error("Error fetching applications:", error);
            } finally {
                setLoading(false);
            }
        }
        fetchApplications();
    }, [initialUser?.id]);

    const handleLoadMore = async () => {
        if (isLoadingMore || !hasMore || !nextCursor) return;
        setIsLoadingMore(true);
        try {
            const res = await getMyApplicationsAction({ limit: 20, cursor: nextCursor });
            if (res?.success) {
                setApplications((prev) => [...prev, ...(res.applications || [])]);
                setHasMore(!!res.hasMore);
                setNextCursor(res.nextCursor || null);
            }
        } catch (error) {
            console.error("Error loading more applications:", error);
        } finally {
            setIsLoadingMore(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
            </div>
        );
    }

    if (applications.length === 0) {
        return (
            <div className="text-center py-12 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
                <FileText className="w-12 h-12 text-zinc-400 mx-auto mb-4" />
                <p className="text-zinc-600 dark:text-zinc-400">No project applications yet.</p>
                <Link href="/hub" className="text-indigo-600 hover:underline mt-2 inline-block">
                    Browse projects
                </Link>
            </div>
        );
    }

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'pending':
                return <Clock className="w-4 h-4 text-yellow-500" />;
            case 'accepted':
                return <CheckCircle className="w-4 h-4 text-green-500" />;
            case 'rejected':
                return <XCircle className="w-4 h-4 text-red-500" />;
            default:
                return <Clock className="w-4 h-4 text-zinc-400" />;
        }
    };

    return (
        <div className="space-y-4">
            {applications.map((app) => (
                <div
                    key={app.id}
                    className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex items-center gap-4"
                >
                    <div className="flex-1">
                        <Link
                            href={`/projects/${app.projectSlug || app.projectId}`}
                            className="font-medium text-zinc-900 dark:text-zinc-100 hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                            {app.projectTitle || "Unknown Project"}
                        </Link>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                            Applied {new Date(app.createdAt).toLocaleDateString()}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {getStatusIcon(app.status)}
                        <span className="text-sm capitalize text-zinc-600 dark:text-zinc-400">{app.status}</span>
                    </div>
                </div>
            ))}
            {hasMore && (
                <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-60"
                >
                    {isLoadingMore ? "Loading..." : "Load More"}
                </button>
            )}
        </div>
    );
}
