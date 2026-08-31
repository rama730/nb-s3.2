"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { acceptApplicationAction, getIncomingApplicationsAction, rejectApplicationAction } from "@/app/actions/applications";
import { resolveMessageWorkflowActionV2 } from "@/app/actions/messaging";
import { queryKeys } from "@/lib/query-keys";
import { useUIStore } from "@/lib/stores/ui-store";
import { Loader2, Inbox } from "lucide-react";
import {
    IncomingProjectApplicationRow,
    type IncomingProjectApplication,
} from "@/components/people/IncomingProjectApplicationRow";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RequestProfileRow } from "@/components/people/RequestProfileRow";
import { useConnectionMutations, usePendingRequests } from "@/hooks/useConnections";

interface WorkspaceRequestsTabProps {
    isActive?: boolean;
}

type WorkspaceRequest = IncomingProjectApplication & { status: string };

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Failed";
}

export default function WorkspaceRequestsTab({ isActive = true }: WorkspaceRequestsTabProps) {
    const isWorkspaceOpen = useUIStore((s) => s.isWorkspaceOpen);
    const setWorkspaceOpen = useUIStore((s) => s.setWorkspaceOpen);
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: queryKeys.workspace.joinRequests(),
        // This is a compact launcher surface. Connections owns the full,
        // paginated request queue rather than hiding an unbounded list here.
        queryFn: () => getIncomingApplicationsAction({ limit: 20 }),
        enabled: isWorkspaceOpen && isActive,
        staleTime: 30_000,
    });
    const { data, isLoading, error } = query;
    // ponytail: Workspace only presents decisions the viewer can take. It
    // never fetches the sent queue that is only useful in the full Requests
    // page, eliminating one request and unrelated loading/error state.
    const connectionsQuery = usePendingRequests(20, isWorkspaceOpen && isActive, { includeSent: false });
    const { acceptRequest, rejectRequest } = useConnectionMutations();

    const incomingApplications = useMemo<WorkspaceRequest[]>(
        () => (data?.applications ?? []) as WorkspaceRequest[],
        [data?.applications],
    );

    // Pending applications to your projects
    const pendingIncoming = useMemo(
        () => incomingApplications.filter((app) => app.status === "pending" && !app.isWorkflowItem),
        [incomingApplications],
    );
    const pendingInvites = useMemo(
        () => incomingApplications.filter((app) => app.status === "pending" && app.isWorkflowItem),
        [incomingApplications],
    );
    const pendingConnections = connectionsQuery.data?.incoming ?? [];

    const removeOptimistically = (id: string) => {
        queryClient.setQueryData(queryKeys.workspace.joinRequests(), (previous: typeof data) => {
            if (!previous?.success) return previous;
            return {
                ...previous,
                applications: previous.applications.filter((application) => application.id !== id),
            };
        });
    };

    const invalidate = () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.workspace.root() });
        void queryClient.invalidateQueries({ queryKey: ["connections", "pending-requests"] });
        void queryClient.invalidateQueries({ queryKey: ["people", "project-applications"] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.root() });
    };

    const acceptApp = useMutation({
        mutationFn: async (id: string) => acceptApplicationAction(id, "Welcome!"),
        onMutate: removeOptimistically,
        onSuccess: () => { toast.success("Accepted"); invalidate(); },
        onError: (error: unknown) => { invalidate(); toast.error(errorMessage(error)); },
    });

    const rejectApp = useMutation({
        mutationFn: async (id: string) => rejectApplicationAction(id, undefined, "other"),
        onMutate: removeOptimistically,
        onSuccess: () => { toast.success("Rejected"); invalidate(); },
        onError: (error: unknown) => { invalidate(); toast.error(errorMessage(error)); },
    });

    const acceptInvite = useMutation({
        mutationFn: async (id: string) => resolveMessageWorkflowActionV2({ workflowItemId: id, action: "accept" }),
        onMutate: removeOptimistically,
        onSuccess: () => { toast.success("Invite accepted"); invalidate(); },
        onError: (error: unknown) => { invalidate(); toast.error(errorMessage(error)); },
    });

    const rejectInvite = useMutation({
        mutationFn: async (id: string) => resolveMessageWorkflowActionV2({ workflowItemId: id, action: "decline" }),
        onMutate: removeOptimistically,
        onSuccess: () => { toast.success("Invite rejected"); invalidate(); },
        onError: (error: unknown) => { invalidate(); toast.error(errorMessage(error)); },
    });

    const resolveConnection = async (requestId: string, action: "accept" | "reject") => {
        try {
            if (action === "accept") {
                await acceptRequest.mutateAsync(requestId);
                toast.success("Connection request accepted");
            } else {
                await rejectRequest.mutateAsync({ id: requestId });
                toast.success("Connection request rejected");
            }
            invalidate();
        } catch (connectionError) {
            toast.error(errorMessage(connectionError));
        }
    };

    if (isLoading || connectionsQuery.isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-12 space-y-3" aria-live="polite">
                <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Loading requests...</span>
            </div>
        );
    }

    if (error || connectionsQuery.error || (data && !data.success)) {
        return (
            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 text-center dark:border-rose-900/30 dark:bg-rose-950/20">
                <p className="text-xs font-medium text-rose-800 dark:text-rose-400">
                    Failed to load requests. Please try again later.
                </p>
                <button type="button" onClick={() => void query.refetch()} className="mt-2 text-xs font-semibold text-rose-700 underline underline-offset-2 dark:text-rose-300">Try again</button>
            </div>
        );
    }

    const hasAnyRequests = pendingConnections.length > 0 || pendingInvites.length > 0 || pendingIncoming.length > 0;

    if (!hasAnyRequests) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/10 px-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400">
                    <Inbox className="w-5 h-5" />
                </div>
                <h4 className="mt-3 text-xs font-semibold text-zinc-900 dark:text-zinc-100">No Pending Requests</h4>
                <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400 max-w-xs">
                    You have no new requests at this time.
                </p>
            </div>
        );
    }

    return (
        <div id="workspace-requests-panel" role="tabpanel" aria-labelledby="workspace-requests-tab" className="w-full px-1 pb-10">
            <p className="mb-4 px-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                Connection and project decisions that need your attention, in one place.
            </p>
            {pendingConnections.length > 0 && (
                <div className="mb-6">
                    <h4 className="mb-3 pl-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Connection requests ({pendingConnections.length})</h4>
                    <div className="space-y-2">
                        {pendingConnections.map((request) => {
                            const isAccepting = acceptRequest.isPending && acceptRequest.variables === request.id;
                            const isRejecting = rejectRequest.isPending && rejectRequest.variables?.id === request.id;
                            const busy = isAccepting || isRejecting;
                            return (
                                <RequestProfileRow
                                    key={request.id}
                                    profile={{
                                        id: request.requesterId,
                                        username: request.requesterUsername,
                                        fullName: request.requesterFullName,
                                        avatarUrl: request.requesterAvatarUrl,
                                        headline: request.requesterHeadline,
                                        location: request.requesterLocation ?? null,
                                    }}
                                    requestedAt={request.createdAt}
                                    actions={(
                                        <>
                                            <Button size="sm" disabled={busy} onClick={() => void resolveConnection(request.id, "accept")}>Accept</Button>
                                            <Button size="sm" variant="outline" disabled={busy} onClick={() => void resolveConnection(request.id, "reject")}>Reject</Button>
                                        </>
                                    )}
                                />
                            );
                        })}
                    </div>
                </div>
            )}
            {pendingInvites.length > 0 && (
                <div className="mb-6">
                    <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 pl-1">Project Invitations ({pendingInvites.length})</h4>
                    <div className="space-y-2">
                        {pendingInvites.map((invite) => {
                            const isAccepting = acceptInvite.isPending && acceptInvite.variables === invite.id;
                            const isRejecting = rejectInvite.isPending && rejectInvite.variables === invite.id;
                            const isProcessing = isAccepting || isRejecting;
                            
                            return <IncomingProjectApplicationRow key={invite.id} app={invite} busy={isProcessing} onAccept={() => acceptInvite.mutate(invite.id)} onReject={() => rejectInvite.mutate(invite.id)} />;
                        })}
                    </div>
                </div>
            )}

            {pendingIncoming.length > 0 && (
                <div>
                    <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 pl-1">Applications to your projects ({pendingIncoming.length})</h4>
                    <div className="space-y-2">
                        {pendingIncoming.map((app) => {
                            const isAccepting = acceptApp.isPending && acceptApp.variables === app.id;
                            const isRejecting = rejectApp.isPending && rejectApp.variables === app.id;
                            const isProcessing = isAccepting || isRejecting;
                            
                            return <IncomingProjectApplicationRow key={app.id} app={app} busy={isProcessing} onAccept={() => acceptApp.mutate(app.id)} onReject={() => rejectApp.mutate(app.id)} />;
                        })}
                    </div>
                </div>
            )}
            {hasAnyRequests ? (
                <Link
                    href="/people?tab=requests"
                    onClick={() => setWorkspaceOpen(false)}
                    className="mt-5 inline-flex text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                    View all requests
                </Link>
            ) : null}
        </div>
    );
}
