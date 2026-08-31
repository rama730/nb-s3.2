"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Ban, Briefcase, ExternalLink, FolderOpen, Loader2, MessageSquare, Pencil } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { acceptApplicationAction, editPendingApplicationAction, rejectApplicationAction } from "@/app/actions/applications";
import { getPeopleApplications } from "@/app/actions/people-applications";
import { resolveMessageWorkflowActionV2 } from "@/app/actions/messaging";
import ApplicationReviewModal from "@/components/people/ApplicationReviewModal";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  IncomingProjectApplicationRow,
  type IncomingProjectApplication,
} from "@/components/people/IncomingProjectApplicationRow";
import { PROJECT_MEMBERS_QUERY_KEY } from "@/hooks/hub/useProjectMembers";
import { getLifecycleStatusStyle } from "@/lib/ui/status-config";
import { queryKeys } from "@/lib/query-keys";

export interface MyApplication {
  id: string;
  isWorkflowItem?: boolean;
  projectId: string | null;
  projectTitle: string;
  projectSlug?: string | null;
  projectCover?: string | null;
  roleTitle: string;
  message?: string | null;
  status: string;
  lifecycleStatus?: "pending" | "accepted" | "rejected" | "withdrawn" | "role_filled" | "proposed";
  decisionReason?: string | null;
  decisionAt?: string | null;
  conversationId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  canEdit?: boolean;
  canEditUntil?: string | null;
  canApply?: boolean;
  waitTime?: string;
}

export interface IncomingApplication extends IncomingProjectApplication {
  status: string;
  createdAt: Date;
}

type ApplicationsData = { my: MyApplication[]; incoming: IncomingApplication[] };
type ApplicationRowProps =
  | { kind: "incoming"; app: IncomingApplication; busy: boolean; onAccept: () => void; onReject: () => void }
  | { kind: "mine"; app: MyApplication; busy: boolean; onEdit: () => void; onCancelInvite: () => void };

const APPLICATIONS_QUERY_KEY = ["people", "project-applications"] as const;

function ProjectAvatar({ app }: { app: MyApplication }) {
  return app.projectCover
    ? <Image src={app.projectCover} alt="" width={40} height={40} className="h-10 w-10 rounded-lg object-cover" />
    : <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800"><Briefcase className="h-4 w-4 text-zinc-500" /></span>;
}

function ApplicationRow(props: ApplicationRowProps) {
  if (props.kind === "incoming") {
    return (
      <IncomingProjectApplicationRow
        app={props.app}
        busy={props.busy}
        onAccept={props.onAccept}
        onReject={props.onReject}
      />
    );
  }

  const app = props.app;
  const projectHref = `/projects/${app.projectSlug || app.projectId}`;
  const view = (() => {
    const lifecycle = props.app.lifecycleStatus || props.app.status;
    const status = getLifecycleStatusStyle(lifecycle);
    return {
      avatar: <ProjectAvatar app={props.app} />,
      title: props.app.projectTitle,
      titleHref: projectHref,
      relation: "for",
      status: <span className={`text-xs font-medium ${status.textColor}`}>{status.label}</span>,
      actions: <>
        {lifecycle === "pending" && !props.app.isWorkflowItem ? <Button size="icon" variant="ghost" onClick={props.onEdit} disabled={!props.app.canEdit || props.busy} aria-label="Edit application"><Pencil className="h-4 w-4" /></Button> : null}
        {lifecycle === "pending" && props.app.isWorkflowItem ? <Button size="icon" variant="ghost" onClick={props.onCancelInvite} disabled={props.busy} aria-label="Cancel invitation"><Ban className="h-4 w-4 text-red-500" /></Button> : null}
        {props.app.conversationId ? <Button size="icon" variant="ghost" asChild><Link href={`/messages?conversationId=${props.app.conversationId}`} aria-label="Open application chat"><MessageSquare className="h-4 w-4" /></Link></Button> : null}
        <Button size="icon" variant="ghost" asChild><Link href={projectHref} aria-label="View project"><ExternalLink className="h-4 w-4" /></Link></Button>
      </>,
    };
  })();

  return <div className="flex items-start gap-3 rounded-2xl border border-zinc-200/60 bg-white/80 p-4 backdrop-blur-xl dark:border-white/5 dark:bg-zinc-900/80">
    {view.avatar}
    <div className="min-w-0 flex-1 pt-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Link href={view.titleHref} className="truncate text-sm font-semibold text-zinc-900 transition-colors hover:text-primary dark:text-zinc-100">{view.title}</Link>
        <span className="text-xs text-zinc-400">{view.relation}</span>
        <span className="truncate text-xs font-medium text-primary">{app.roleTitle}</span>
        {view.status}
      </div>
      <Link href={projectHref} className="mt-1 block truncate text-xs text-zinc-400 hover:text-primary">{app.projectTitle}</Link>
    </div>
    <div className="flex shrink-0 items-center gap-2">{view.actions}</div>
  </div>;
}

type ReviewState = { open: boolean; applicationId: string | null; projectId: string | null; mode: "accept" | "reject"; applicantName: string; roleTitle: string; workflow: boolean };
type EditState = { open: boolean; applicationId: string | null; projectId: string | null; draft: string };

export default function ProjectApplicationsSection({ initialUser, initialApplications }: { initialUser: { id?: string | null } | null; initialApplications?: ApplicationsData }) {
  const queryClient = useQueryClient();
  const { data = { my: [], incoming: [] }, isLoading } = useQuery({
    queryKey: APPLICATIONS_QUERY_KEY,
    enabled: Boolean(initialUser?.id),
    initialData: initialApplications,
    staleTime: 60_000,
    queryFn: async (): Promise<ApplicationsData> => {
      const result = await getPeopleApplications();
      if (!result.success) throw new Error(result.error);
      return { my: result.my as MyApplication[], incoming: result.incoming as IncomingApplication[] };
    },
  });
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [review, setReview] = useState<ReviewState>({ open: false, applicationId: null, projectId: null, mode: "accept", applicantName: "", roleTitle: "", workflow: false });
  const [edit, setEdit] = useState<EditState>({ open: false, applicationId: null, projectId: null, draft: "" });

  const updateData = (updater: (current: ApplicationsData) => ApplicationsData) => queryClient.setQueryData<ApplicationsData>(APPLICATIONS_QUERY_KEY, (current) => updater(current ?? { my: [], incoming: [] }));
  const openReview = (app: IncomingApplication, mode: "accept" | "reject") => setReview({ open: true, applicationId: app.id, projectId: app.projectId, mode, applicantName: app.applicant.fullName || app.applicant.username || "User", roleTitle: app.roleTitle, workflow: Boolean(app.isWorkflowItem) });

  const confirmReview = async (message: string, reason?: string) => {
    if (!review.applicationId) return;
    setProcessingId(review.applicationId);
    try {
      const result = review.workflow
        ? await resolveMessageWorkflowActionV2({ workflowItemId: review.applicationId, action: review.mode === "accept" ? "accept" : "decline" })
        : review.mode === "accept" ? await acceptApplicationAction(review.applicationId, message) : await rejectApplicationAction(review.applicationId, message, reason);
      if (!result.success) throw new Error(result.error || `Failed to ${review.mode}`);
      updateData((current) => ({ ...current, incoming: current.incoming.filter((app) => app.id !== review.applicationId) }));
      if (review.projectId) await queryClient.invalidateQueries({ queryKey: PROJECT_MEMBERS_QUERY_KEY(review.projectId), refetchType: "all" });
      if (review.mode === "accept") await queryClient.invalidateQueries({ queryKey: queryKeys.globalSearch.hubRoot(), refetchType: "active" });
      setReview((current) => ({ ...current, open: false }));
      toast.success(review.mode === "accept" ? "Application accepted" : "Application rejected");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update application");
    } finally {
      setProcessingId(null);
    }
  };

  const cancelInvite = async (id: string) => {
    setProcessingId(id);
    try {
      const result = await resolveMessageWorkflowActionV2({ workflowItemId: id, action: "cancel" });
      if (!result.success) throw new Error(result.error || "Failed to cancel invitation");
      updateData((current) => ({ ...current, my: current.my.filter((app) => app.id !== id) }));
      toast.success("Invitation canceled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel invitation");
    } finally {
      setProcessingId(null);
    }
  };

  const saveEdit = async () => {
    if (!edit.applicationId || !edit.draft.trim()) return;
    setSavingEdit(true);
    try {
      const message = edit.draft.trim();
      const result = await editPendingApplicationAction(edit.applicationId, message);
      if (!result.success) throw new Error(result.error || "Failed to update application");
      updateData((current) => ({ ...current, my: current.my.map((app) => app.id === edit.applicationId ? { ...app, message, updatedAt: new Date() } : app) }));
      setEdit({ open: false, applicationId: null, projectId: null, draft: "" });
      toast.success("Application updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update application");
    } finally {
      setSavingEdit(false);
    }
  };

  if (!initialUser) return null;
  if (isLoading) return <div className="h-40 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />;
  if (!data.my.length && !data.incoming.length) return <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-zinc-500"><FolderOpen className="mx-auto mb-3 h-8 w-8" />No project applications</div>;

  return <div className="space-y-6">
    {data.incoming.length ? <section><h3 className="mb-3 text-sm font-semibold">Pending Review <span className="text-zinc-400">{data.incoming.length}</span></h3><div className="space-y-3">{data.incoming.map((app) => <ApplicationRow key={app.id} kind="incoming" app={app} busy={processingId === app.id} onAccept={() => openReview(app, "accept")} onReject={() => openReview(app, "reject")} />)}</div></section> : null}
    {data.my.length ? <section><h3 className="mb-3 text-sm font-semibold">My Applications <span className="text-zinc-400">{data.my.length}</span></h3><div className="space-y-3">{data.my.map((app) => <ApplicationRow key={app.id} kind="mine" app={app} busy={processingId === app.id} onEdit={() => setEdit({ open: true, applicationId: app.id, projectId: app.projectId, draft: app.message || "" })} onCancelInvite={() => void cancelInvite(app.id)} />)}</div></section> : null}
    <ApplicationReviewModal isOpen={review.open} onClose={() => setReview((current) => ({ ...current, open: false }))} onConfirm={confirmReview} mode={review.mode} applicantName={review.applicantName} roleTitle={review.roleTitle} />
    <Dialog open={edit.open} onOpenChange={(open) => { if (!open && !savingEdit) setEdit({ open: false, applicationId: null, projectId: null, draft: "" }); }}><DialogContent><DialogHeader><DialogTitle>Edit Application</DialogTitle><DialogDescription>Update the message mirrored to your application chat.</DialogDescription></DialogHeader><textarea value={edit.draft} onChange={(event) => setEdit((current) => ({ ...current, draft: event.target.value.slice(0, 2000) }))} rows={8} className="w-full rounded-xl border bg-background px-3 py-2 text-sm" disabled={savingEdit} /><DialogFooter><Button variant="outline" onClick={() => setEdit({ open: false, applicationId: null, projectId: null, draft: "" })} disabled={savingEdit}>Cancel</Button><Button onClick={() => void saveEdit()} disabled={savingEdit || !edit.draft.trim()}>{savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save Changes</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
