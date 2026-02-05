"use client";

import { Clock, UserPlus, Play, CheckCircle2, ChevronRight } from "lucide-react";
import {
    ProjectOverviewCard,
    TeamCard,
    OpenRolesCard,
    ProjectPulseCard
} from "@/components/projects/dashboard";

// Status & Priority Design Config
const DASH_STATUS_META = {
    todo: {
        label: "To do",
        className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700",
    },
    in_progress: {
        label: "In progress",
        className: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    },
    done: {
        label: "Done",
        className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
    },
} as const;

const DASH_PRIORITY_META: Record<string, { label: string; className: string }> = {
    urgent: {
        label: "Urgent",
        className: "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300 border-rose-200 dark:border-rose-800",
    },
    high: {
        label: "High",
        className: "bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300 border-orange-200 dark:border-orange-800",
    },
    medium: {
        label: "Medium",
        className: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 border-amber-200 dark:border-amber-800",
    },
    low: {
        label: "Low",
        className: "bg-zinc-50 text-zinc-600 dark:bg-zinc-900/30 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800",
    },
};

interface DashboardTabProps {
    project: any;
    isCreator: boolean;
    isOwnerOrMember: boolean;
    onViewBoard: () => void;
    onTaskClick: (taskId: string) => void;
    myFocus?: any[];
    needsOwner?: any[];
    overdue?: any[];
    activeSprintTasks?: any[];
    activeSprintName?: string;
    taskActionLoading?: Record<string, boolean>;
    onStart?: (task: any) => void;
    onDone?: (task: any) => void;
    onAssignToMe?: (taskId: string) => void;
    onMoveToActiveSprint?: (taskId: string) => void;
}

export function DashboardTab({
    project,
    isCreator,
    isOwnerOrMember,
    onViewBoard,
    onTaskClick,
    myFocus = [],
    needsOwner = [],
    overdue = [],
    activeSprintTasks = [],
    activeSprintName,
    taskActionLoading = {},
    onStart,
    onDone,
    onAssignToMe,
    onMoveToActiveSprint,
}: DashboardTabProps) {
    const pulseCard = (
        <ProjectPulseCard
            projectId={project.id}
            activities={[]} // TODO: wire up activities
            tasks={[...myFocus, ...needsOwner, ...activeSprintTasks]} // simplistic aggregation
            isCollaborator={isOwnerOrMember}
            isCreator={isCreator}
            currentUserId={null} // ProjectDetailShell doesn't pass this yet, handled gracefully inside
            onViewBoard={onViewBoard}
            onUploadFile={() => { }}
            onViewAnalytics={() => { }}
            onViewSprints={() => { }}
            onViewSettings={() => { }}
            onTaskClick={onTaskClick}
        />
    );

    const teamAndRoles = (
        <>
            <TeamCard
                project={project}
                members={project.project_collaborators || []} // Assuming mapped data
                openRoles={project.roles || []} // Assuming mapped data
                isCreator={isCreator}
                onManageTeam={() => { }}
                onInvite={() => { }}
            />
            {(project.roles || []).some((r: any) => (r.count || 0) > (r.filled || 0)) && (
                <OpenRolesCard
                    roles={project.roles || []}
                    isCreator={isCreator}
                    isCollaborator={isOwnerOrMember}
                    applicationStatus={{ status: 'none' }}
                    onApply={() => { }}
                    onManageRoles={() => { }}
                />
            )}
        </>
    );

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 space-y-6">
                <ProjectOverviewCard
                    project={project}
                    isCreator={isCreator}
                    bookmarked={false} // TODO: wire up
                    bookmarkCount={project.bookmark_count || 0}
                    followersCount={project.followers_count || 0}
                    membersCount={(project.project_collaborators?.length || 0) + 1}
                    hideActionBar={true}
                    onEdit={() => { }}
                    onShare={() => { }}
                    onBookmark={() => { }}
                    onFinalize={() => { }}
                    shareCopied={false}
                    bookmarkLoading={false}
                    lifecycleStages={[]} // TODO: wire up from project.lifecycle_stages if available
                    currentStageIndex={0}
                    onAdvanceStage={() => { }}
                />

                {/* Next actions (productivity cockpit) */}
                {isOwnerOrMember && (
                    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-5">
                        <div className="flex items-start justify-between gap-3 mb-4">
                            <div>
                                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Next actions</h3>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                    High-signal work lists with one-click actions.
                                </p>
                            </div>
                            <button
                                onClick={onViewBoard}
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                            >
                                View all tasks <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <ActionList
                                title="My Focus"
                                emptyText="No active tasks assigned to you."
                                items={myFocus}
                                taskActionLoading={taskActionLoading}
                                onOpen={onTaskClick}
                                onStart={onStart}
                                onDone={onDone}
                                onAssignToMe={undefined}
                                onMoveToActiveSprint={onMoveToActiveSprint}
                                activeSprintName={activeSprintName}
                            />

                            <ActionList
                                title="Needs Owner"
                                emptyText="No unassigned tasks right now."
                                items={needsOwner}
                                taskActionLoading={taskActionLoading}
                                onOpen={onTaskClick}
                                onStart={undefined}
                                onDone={undefined}
                                onAssignToMe={onAssignToMe}
                                onMoveToActiveSprint={onMoveToActiveSprint}
                                activeSprintName={activeSprintName}
                            />

                            <ActionList
                                title="Overdue"
                                emptyText="No overdue tasks."
                                items={overdue}
                                taskActionLoading={taskActionLoading}
                                onOpen={onTaskClick}
                                onStart={onStart}
                                onDone={onDone}
                                onAssignToMe={undefined}
                                onMoveToActiveSprint={undefined}
                                activeSprintName={undefined}
                                showDueDate
                            />

                            <ActionList
                                title={activeSprintName ? `Active Sprint: ${activeSprintName}` : "Active Sprint"}
                                emptyText={activeSprintName ? "No active sprint tasks right now." : "No active sprint. Create or start one in Sprints."}
                                items={activeSprintTasks}
                                taskActionLoading={taskActionLoading}
                                onOpen={onTaskClick}
                                onStart={onStart}
                                onDone={onDone}
                                onAssignToMe={undefined}
                                onMoveToActiveSprint={undefined}
                                activeSprintName={activeSprintName}
                                showDueDate
                            />
                        </div>
                    </div>
                )}
            </div>

            <div className="lg:col-span-5 space-y-6">
                {/* Pulse Card ordered first or second? Spec: "Pulse optionally shown first". Let's assume Pulse first since it's "Cockpit" */}
                {pulseCard}
                {teamAndRoles}
            </div>
        </div>
    );
}

function ActionList({
    title,
    emptyText,
    items,
    taskActionLoading,
    onOpen,
    onAssignToMe,
    onStart,
    onDone,
    onMoveToActiveSprint,
    activeSprintName,
    showDueDate,
}: {
    title: string;
    emptyText: string;
    items: any[];
    taskActionLoading: Record<string, boolean>;
    onOpen: (taskId: string) => void;
    onAssignToMe?: (taskId: string) => void;
    onStart?: (task: any) => void;
    onDone?: (task: any) => void;
    onMoveToActiveSprint?: (taskId: string) => void;
    activeSprintName?: string;
    showDueDate?: boolean;
}) {
    return (
        <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/40 dark:bg-zinc-800/10 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-700 dark:text-zinc-200">{title}</div>
                <div className="text-[11px] text-slate-500 dark:text-zinc-400">{items.length}</div>
            </div>
            <div className="p-2 space-y-1.5">
                {items.length === 0 ? (
                    <div className="px-2 py-4 text-xs text-slate-500 dark:text-zinc-400 text-center">
                        {emptyText}
                    </div>
                ) : (
                    items.map((t: any) => {
                        const busy = !!taskActionLoading[t.id];
                        const isUnassigned = !t?.assigned_to;
                        const isTodo = t?.status === "todo";
                        const isInProgress = t?.status === "in_progress";
                        const isDone = t?.status === "done";
                        const statusMeta = DASH_STATUS_META[t?.status as keyof typeof DASH_STATUS_META] ?? DASH_STATUS_META.todo;
                        const priorityKey = String(t?.priority || "medium").toLowerCase();
                        const priorityMeta = DASH_PRIORITY_META[priorityKey] ?? DASH_PRIORITY_META.medium!;

                        const canNextStart = !!onStart && isTodo && !isDone;
                        const canNextDone = !!onDone && isInProgress && !isDone;
                        const nextAction = canNextStart
                            ? { label: "Start", onClick: () => onStart?.(t), className: "bg-blue-600 text-white hover:bg-blue-700", icon: Play }
                            : canNextDone
                                ? { label: "Done", onClick: () => onDone?.(t), className: "bg-emerald-600 text-white hover:bg-emerald-700", icon: CheckCircle2 }
                                : null;

                        return (
                            <div
                                key={t.id}
                                className="flex items-start gap-2 p-2 rounded-lg bg-white dark:bg-zinc-900 border border-slate-200/70 dark:border-zinc-800 hover:border-indigo-200 dark:hover:border-indigo-900/60 transition-colors"
                            >
                                <button
                                    onClick={() => onOpen(t.id)}
                                    className="flex-1 min-w-0 text-left"
                                    title="Open task"
                                >
                                    <div className="text-sm font-medium text-slate-900 dark:text-zinc-100 truncate">
                                        {t.title}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${statusMeta.className}`}>
                                            {statusMeta.label}
                                        </span>
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${priorityMeta.className}`}>
                                            {priorityMeta.label}
                                        </span>
                                        {showDueDate && t?.due_date ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 bg-white dark:bg-zinc-900">
                                                <Clock className="w-3 h-3" />
                                                {new Date(t.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                                            </span>
                                        ) : null}
                                    </div>
                                </button>

                                <div className="flex items-center gap-1.5 pt-0.5">
                                    {onAssignToMe && isUnassigned && (
                                        <button
                                            disabled={busy}
                                            onClick={() => onAssignToMe(t.id)}
                                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-50"
                                            title="Assign to me"
                                        >
                                            <UserPlus className="w-3 h-3" />
                                            Me
                                        </button>
                                    )}

                                    {onMoveToActiveSprint && !t?.sprint_id && activeSprintName && (
                                        <button
                                            disabled={busy}
                                            onClick={() => onMoveToActiveSprint(t.id)}
                                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-50"
                                            title={`Move to ${activeSprintName}`}
                                        >
                                            <ChevronRight className="w-3 h-3" />
                                            Sprint
                                        </button>
                                    )}

                                    {nextAction && (
                                        <button
                                            disabled={busy}
                                            onClick={nextAction.onClick}
                                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium disabled:opacity-50 ${nextAction.className}`}
                                            title={nextAction.label}
                                        >
                                            <nextAction.icon className="w-3 h-3" />
                                            {nextAction.label}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
