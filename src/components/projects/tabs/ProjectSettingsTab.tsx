"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, Globe, Bell, AlertTriangle, Download, Info, Lock, Route, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
    archiveProjectAction,
    deleteProject,
    finalizeProjectAction,
    getProjectDangerZonePreflightAction,
    updateProjectLifecycleAction,
    updateProjectSettingsAction,
} from "@/app/actions/project";
import LifecycleEditor from "@/components/projects/settings/LifecycleEditor";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface ProjectSettingsTabProps {
    projectId: string;
    project: any;
    onProjectUpdated: () => void;
    isProjectOwner: boolean;
}

type ConfirmActionResult = {
    success: boolean;
    message: string;
    refresh?: boolean;
    redirectTo?: string;
};

type ConfirmAction = {
    title: string;
    description: string;
    confirmLabel: string;
    variant: "default" | "destructive";
    action: () => Promise<ConfirmActionResult>;
};

type DangerPreflight = {
    status: "draft" | "active" | "completed" | "archived";
    openRolesCount: number;
    pendingApplicationsCount: number;
    activeTasksCount: number;
    canFinalize: boolean;
    canArchive: boolean;
    canDelete: boolean;
    finalizeBlockers: string[];
};

export default function ProjectSettingsTab({
    projectId,
    project,
    onProjectUpdated,
    isProjectOwner,
}: ProjectSettingsTabProps) {
    const router = useRouter();
    const [activeSection, setActiveSection] = useState("general");
    const [savingSettings, setSavingSettings] = useState(false);
    const [savingLifecycle, setSavingLifecycle] = useState(false);
    const [loadingExport, setLoadingExport] = useState(false);
    const [confirmLoading, setConfirmLoading] = useState(false);
    const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
    const [dangerPreflight, setDangerPreflight] = useState<DangerPreflight | null>(null);
    const [dangerPreflightLoading, setDangerPreflightLoading] = useState(false);

    const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">(
        project?.visibility === "unlisted" ? "unlisted" : project?.visibility === "private" ? "private" : "public"
    );
    const [lookingForCollaborators, setLookingForCollaborators] = useState<boolean>(
        !!project?.lookingForCollaborators
    );
    const [maxCollaborators, setMaxCollaborators] = useState<string>(
        typeof project?.maxCollaborators === "string" ? project.maxCollaborators : ""
    );

    useEffect(() => {
        setVisibility(
            project?.visibility === "unlisted"
                ? "unlisted"
                : project?.visibility === "private"
                    ? "private"
                    : "public"
        );
        setLookingForCollaborators(!!project?.lookingForCollaborators);
        setMaxCollaborators(typeof project?.maxCollaborators === "string" ? project.maxCollaborators : "");
    }, [project?.visibility, project?.lookingForCollaborators, project?.maxCollaborators]);

    const loadDangerPreflight = useCallback(async () => {
        setDangerPreflightLoading(true);
        try {
            const result = await getProjectDangerZonePreflightAction(projectId);
            if (!result.success) {
                setDangerPreflight(null);
                toast.error(result.message);
                return;
            }
            setDangerPreflight(result.data);
        } catch (error) {
            console.error("Failed to load danger-zone preflight", error);
            setDangerPreflight(null);
            toast.error("Failed to load danger-zone checks.");
        } finally {
            setDangerPreflightLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        if (activeSection !== "danger") return;
        void loadDangerPreflight();
    }, [activeSection, loadDangerPreflight]);

    const handleSaveSettings = useCallback(async () => {
        setSavingSettings(true);
        try {
            const result = await updateProjectSettingsAction(projectId, {
                visibility,
                lookingForCollaborators,
                maxCollaborators: maxCollaborators.trim() || null,
            });
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            toast.success(result.message);
            onProjectUpdated();
        } catch (error) {
            console.error("Failed to save settings", error);
            toast.error("Failed to save settings.");
        } finally {
            setSavingSettings(false);
        }
    }, [lookingForCollaborators, maxCollaborators, onProjectUpdated, projectId, visibility]);

    const handleExport = useCallback(async () => {
        setLoadingExport(true);
        try {
            const payload = {
                exportedAt: new Date().toISOString(),
                projectId,
                project: {
                    id: project?.id ?? projectId,
                    title: project?.title ?? "Project",
                    slug: project?.slug ?? null,
                    visibility: project?.visibility ?? null,
                    status: project?.status ?? null,
                    lifecycleStages: project?.lifecycleStages ?? [],
                    currentStageIndex: project?.currentStageIndex ?? 0,
                    tags: project?.tags ?? [],
                    skills: project?.skills ?? [],
                    lookingForCollaborators: !!project?.lookingForCollaborators,
                    maxCollaborators: project?.maxCollaborators ?? null,
                },
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const href = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = href;
            anchor.download = `${(project?.slug || project?.title || "project").toString().replace(/\s+/g, "-").toLowerCase()}-settings-export.json`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(href);
            toast.success("Project export downloaded.");
        } catch (error) {
            console.error("Failed to export project settings", error);
            toast.error("Failed to export project data.");
        } finally {
            setLoadingExport(false);
        }
    }, [project, projectId]);

    const runConfirmAction = useCallback(async () => {
        if (!confirmAction) return;
        setConfirmLoading(true);
        try {
            const result = await confirmAction.action();
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            toast.success(result.message);
            if (result.refresh) onProjectUpdated();
            if (result.redirectTo) {
                router.push(result.redirectTo);
                return;
            }
            setConfirmAction(null);
        } catch (error) {
            console.error("Confirm action failed", error);
            toast.error("Action failed. Please try again.");
        } finally {
            setConfirmLoading(false);
        }
    }, [confirmAction, onProjectUpdated, router]);

    const prepareFinalize = useCallback(() => {
        if (dangerPreflight && !dangerPreflight.canFinalize) {
            const message = dangerPreflight.finalizeBlockers[0] || "Project cannot be finalized yet.";
            toast.error(message);
            return;
        }
        setConfirmAction({
            title: "Finalize Project",
            description: "Finalize marks the project completed and closes open roles. This should be done only after all active work is done.",
            confirmLabel: "Finalize",
            variant: "destructive",
            action: async () => {
                const result = await finalizeProjectAction(projectId);
                if (!result.success) {
                    return { success: false, message: result.message };
                }
                await loadDangerPreflight();
                return { success: true, message: result.message, refresh: true };
            },
        });
    }, [dangerPreflight, loadDangerPreflight, projectId]);

    const prepareArchive = useCallback(() => {
        if (dangerPreflight && !dangerPreflight.canArchive) {
            toast.error("Project is already archived.");
            return;
        }
        setConfirmAction({
            title: "Archive Project",
            description: "Archive hides this project from normal discovery and sets it to archived status.",
            confirmLabel: "Archive",
            variant: "destructive",
            action: async () => {
                const result = await archiveProjectAction(projectId);
                if (!result.success) {
                    return { success: false, message: result.message };
                }
                await loadDangerPreflight();
                return { success: true, message: result.message, refresh: true };
            },
        });
    }, [dangerPreflight, loadDangerPreflight, projectId]);

    const prepareDelete = useCallback(() => {
        if (dangerPreflight && !dangerPreflight.canDelete) {
            toast.error("Project cannot be deleted.");
            return;
        }
        setConfirmAction({
            title: "Delete Project",
            description: "This will permanently delete this project and all associated data. This action cannot be undone.",
            confirmLabel: "Delete Project",
            variant: "destructive",
            action: async () => {
                const result = await deleteProject(projectId);
                if (!result.success) {
                    return { success: false, message: result.message };
                }
                return {
                    success: true,
                    message: result.message,
                    redirectTo: result.data.redirectTo,
                };
            },
        });
    }, [dangerPreflight, projectId]);

    const statusLabel = (() => {
        const raw = (project?.status as string) || "draft";
        if (raw === "active" || raw === "completed" || raw === "archived") return raw;
        return "draft";
    })();

    if (!isProjectOwner) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-20 h-20 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
                    <Lock className="w-10 h-10 text-zinc-400" />
                </div>
                <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-2">Access Restricted</h3>
                <p className="text-sm text-zinc-500">Only project owners can access settings.</p>
            </div>
        );
    }

    const sections = [
        { id: "general", label: "General", icon: Settings },
        { id: "lifecycle", label: "Lifecycle", icon: Route },
        { id: "visibility", label: "Visibility", icon: Globe },
        { id: "notifications", label: "Notifications", icon: Bell },
        { id: "export", label: "Export", icon: Download },
        { id: "danger", label: "Danger Zone", icon: AlertTriangle },
    ];

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Settings</h2>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                                <Info className="w-5 h-5" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs p-4">
                            <p className="font-semibold mb-2">Project Settings</p>
                            <p className="text-xs text-zinc-500 mb-2">Only owner-controlled, persisted settings appear here.</p>
                            <ul className="list-disc pl-4 space-y-1 text-xs text-zinc-500">
                                <li>Changes save server-side</li>
                                <li>Danger Zone runs preflight checks</li>
                            </ul>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>

            <div className="flex gap-2 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg overflow-x-auto">
                {sections.map((section) => (
                    <button
                        key={section.id}
                        onClick={() => setActiveSection(section.id)}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap",
                            activeSection === section.id
                                ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm"
                                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50"
                        )}
                    >
                        <section.icon className="w-4 h-4" />
                        {section.label}
                    </button>
                ))}
            </div>

            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 min-h-[400px]">
                {activeSection === "general" && (
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-4">General Settings</h3>
                            <div className="space-y-4">
                                <div className="flex items-center justify-between p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                    <div>
                                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">Looking for collaborators</p>
                                        <p className="text-sm text-zinc-500 mt-1">Show this project as actively seeking collaborators.</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={lookingForCollaborators}
                                            onChange={(e) => setLookingForCollaborators(e.target.checked)}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-600"></div>
                                    </label>
                                </div>

                                <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">Max collaborators</p>
                                    <p className="text-sm text-zinc-500 mt-1">Optional cap for team size.</p>
                                    <select
                                        value={maxCollaborators}
                                        onChange={(e) => setMaxCollaborators(e.target.value)}
                                        className="mt-3 w-full max-w-xs rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                                    >
                                        <option value="">No cap</option>
                                        <option value="2">2</option>
                                        <option value="5">5</option>
                                        <option value="10">10</option>
                                        <option value="20">20</option>
                                        <option value="50">50</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <Button
                            onClick={() => void handleSaveSettings()}
                            disabled={savingSettings}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                            {savingSettings ? "Saving..." : "Save General Settings"}
                        </Button>
                    </div>
                )}

                {activeSection === "lifecycle" && (
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-2">Project Lifecycle</h3>
                            <p className="text-sm text-zinc-500 mb-4">
                                Define and manage your project journey stages.
                            </p>
                            <LifecycleEditor
                                initialStages={project?.lifecycle_stages || project?.lifecycleStages || ["Concept", "MVP", "Launch"]}
                                currentStageIndex={project?.current_stage_index ?? project?.currentStageIndex ?? 0}
                                isSaving={savingLifecycle}
                                onSave={async (stages, currentActiveStage) => {
                                    setSavingLifecycle(true);
                                    try {
                                        const result = await updateProjectLifecycleAction(projectId, stages, currentActiveStage);
                                        if (result.success) {
                                            toast.success("Lifecycle updated successfully");
                                            onProjectUpdated();
                                        } else {
                                            toast.error(result.error || "Failed to update lifecycle");
                                        }
                                    } catch (error) {
                                        console.error(error);
                                        toast.error("Failed to update lifecycle");
                                    } finally {
                                        setSavingLifecycle(false);
                                    }
                                }}
                            />
                        </div>
                    </div>
                )}

                {activeSection === "visibility" && (
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-4">Project Visibility</h3>
                            <div className="space-y-3">
                                {[
                                    { id: "public", title: "Public", desc: "Anyone can view and discover this project" },
                                    { id: "unlisted", title: "Unlisted", desc: "Only people with the link can view this project" },
                                    { id: "private", title: "Private", desc: "Only project members can view this project" }
                                ].map((opt) => (
                                    <label
                                        key={opt.id}
                                        className={cn(
                                            "flex items-start gap-3 p-4 rounded-lg border cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors",
                                            visibility === opt.id
                                                ? "border-indigo-500 bg-indigo-50/10"
                                                : "border-zinc-200 dark:border-zinc-700"
                                        )}
                                    >
                                        <input
                                            type="radio"
                                            name="visibility"
                                            value={opt.id}
                                            checked={visibility === opt.id}
                                            onChange={() => setVisibility(opt.id as "public" | "unlisted" | "private")}
                                            className="mt-1 w-4 h-4 text-indigo-600 border-zinc-300 focus:ring-indigo-500"
                                        />
                                        <div>
                                            <p className="font-semibold text-zinc-900 dark:text-zinc-100">{opt.title}</p>
                                            <p className="text-sm text-zinc-500 mt-1">{opt.desc}</p>
                                        </div>
                                    </label>
                                ))}
                            </div>
                            <Button
                                onClick={() => void handleSaveSettings()}
                                disabled={savingSettings}
                                className="mt-4 bg-blue-600 hover:bg-blue-700 text-white"
                            >
                                {savingSettings ? "Saving..." : "Save Visibility"}
                            </Button>
                        </div>
                    </div>
                )}

                {activeSection === "notifications" && (
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-4">Notification Preferences</h3>
                            <p className="text-sm text-zinc-500 mb-4">
                                Project notifications are managed from your global account settings to keep delivery channels consistent.
                            </p>
                            <div className="flex flex-wrap gap-3">
                                <Button variant="outline" onClick={() => router.push("/settings")}>
                                    Open Settings
                                </Button>
                                <Button variant="outline" onClick={() => router.push("/settings/security")}>
                                    Open Security
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {activeSection === "export" && (
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-4">Export Project Data</h3>
                            <p className="text-sm text-zinc-500 mb-4">Download a JSON snapshot of current project settings.</p>
                            <Button
                                onClick={() => void handleExport()}
                                disabled={loadingExport}
                                className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
                            >
                                {loadingExport ? (
                                    <>Exporting...</>
                                ) : (
                                    <>
                                        <Download className="w-4 h-4" />
                                        Export Settings Snapshot
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                )}

                {activeSection === "danger" && (
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-lg font-bold text-red-600 dark:text-red-400 mb-4">Danger Zone</h3>

                            <div className="mb-4 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 text-sm">
                                {dangerPreflightLoading ? (
                                    <div className="flex items-center gap-2 text-zinc-500">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Running preflight checks...
                                    </div>
                                ) : dangerPreflight ? (
                                    <div className="space-y-1 text-zinc-600 dark:text-zinc-300">
                                        <p>Current status: <span className="font-semibold capitalize">{statusLabel}</span></p>
                                        <p>Open roles: {dangerPreflight.openRolesCount}</p>
                                        <p>Pending applications: {dangerPreflight.pendingApplicationsCount}</p>
                                        <p>Non-completed tasks: {dangerPreflight.activeTasksCount}</p>
                                    </div>
                                ) : (
                                    <p className="text-zinc-500">Preflight data unavailable.</p>
                                )}
                            </div>

                            <div className="space-y-4">
                                <div className="p-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="font-semibold text-red-900 dark:text-red-100">Finalize Project</p>
                                            <p className="text-sm text-red-800 dark:text-red-200 mt-1">
                                                Mark this project as completed. Finalize is blocked when preflight checks fail.
                                            </p>
                                            {dangerPreflight?.finalizeBlockers?.length ? (
                                                <ul className="mt-2 list-disc pl-5 text-xs text-red-700 dark:text-red-300 space-y-1">
                                                    {dangerPreflight.finalizeBlockers.map((item) => (
                                                        <li key={item}>{item}</li>
                                                    ))}
                                                </ul>
                                            ) : null}
                                        </div>
                                        <Button
                                            onClick={prepareFinalize}
                                            disabled={confirmLoading || !!dangerPreflightLoading || !dangerPreflight?.canFinalize}
                                            className="whitespace-nowrap px-4 py-2 rounded-md bg-white border border-red-200 text-red-600 hover:bg-red-50 transition-colors text-sm font-medium"
                                        >
                                            Finalize
                                        </Button>
                                    </div>
                                </div>

                                <div className="p-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="font-semibold text-red-900 dark:text-red-100">Archive Project</p>
                                            <p className="text-sm text-red-800 dark:text-red-200 mt-1">Set project status to archived and hide it from normal discovery.</p>
                                        </div>
                                        <Button
                                            onClick={prepareArchive}
                                            disabled={confirmLoading || !!dangerPreflightLoading || !dangerPreflight?.canArchive}
                                            className="whitespace-nowrap px-4 py-2 rounded-md border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors text-sm font-medium"
                                        >
                                            Archive
                                        </Button>
                                    </div>
                                </div>

                                <div className="p-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="font-semibold text-red-900 dark:text-red-100">Delete Project</p>
                                            <p className="text-sm text-red-800 dark:text-red-200 mt-1">Permanently delete this project and all data. This action cannot be undone.</p>
                                        </div>
                                        <Button
                                            variant="destructive"
                                            onClick={prepareDelete}
                                            disabled={confirmLoading || !!dangerPreflightLoading || !dangerPreflight?.canDelete}
                                            className="whitespace-nowrap px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors text-sm font-medium"
                                        >
                                            Delete Project
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <ConfirmDialog
                open={!!confirmAction}
                onOpenChange={(open) => {
                    if (!open && !confirmLoading) setConfirmAction(null);
                }}
                title={confirmAction?.title ?? ""}
                description={confirmAction?.description}
                confirmLabel={confirmAction?.confirmLabel ?? "Confirm"}
                variant={confirmAction?.variant ?? "destructive"}
                loading={confirmLoading}
                autoCloseOnConfirm={false}
                onConfirm={runConfirmAction}
            />
        </div>
    );
}
