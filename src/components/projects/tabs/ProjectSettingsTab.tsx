"use client";

import React, { useState, useTransition, useCallback } from "react";
import { Settings, Globe, Bell, Archive, Trash2, AlertTriangle, Download, Info, Check, Lock, Route } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { deleteProject, updateProjectLifecycleAction, finalizeProjectAction } from "@/app/actions/project";
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

export default function ProjectSettingsTab({
    projectId,
    project,
    onProjectUpdated,
    isProjectOwner,
}: ProjectSettingsTabProps) {
    const [activeSection, setActiveSection] = useState("general");
    const [isPending, startTransition] = useTransition();

    // Fake states for UI demo
    const [autoArchive, setAutoArchive] = useState(true);
    const [savingVisibility, setSavingVisibility] = useState(false);
    const [loadingExport, setLoadingExport] = useState(false);
    const [savingLifecycle, setSavingLifecycle] = useState(false);
    const [confirmAction, setConfirmAction] = useState<{ title: string; description: string; action: () => void } | null>(null);

    const handleFinalize = useCallback(() => {
        startTransition(async () => {
            try {
                const result = await finalizeProjectAction(projectId);
                if (result.success) {
                    toast.success("Project finalized successfully!");
                    onProjectUpdated();
                } else {
                    const errorMsg = 'error' in result ? result.error : "Failed to finalize";
                    toast.error(errorMsg);
                }
            } catch {
                toast.error("Failed to finalize project");
            }
        });
    }, [projectId, onProjectUpdated]);

    const handleDelete = useCallback(() => {
        startTransition(async () => {
            try {
                await deleteProject(projectId);
                toast.success("Project deleted successfully");
            } catch (error) {
                toast.error("Failed to delete project");
                console.error(error);
            }
        });
    }, [projectId]);

    // Access Restricted
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
            {/* Header */}
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
                            <p className="font-semibold mb-2">Settings</p>
                            <p className="text-xs text-zinc-500 mb-2">Manage project configuration, visibility, and team-related preferences.</p>
                            <ul className="list-disc pl-4 space-y-1 text-xs text-zinc-500">
                                <li>Only project owners can access settings</li>
                                <li>Use Danger Zone carefully (permanent changes)</li>
                            </ul>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>

            {/* Section Tabs */}
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

            {/* Content Card */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 min-h-[400px]">

                {/* General */}
                {activeSection === "general" && (
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-4">General Settings</h3>
                            <div className="space-y-4">
                                <div className="flex items-center justify-between p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                    <div>
                                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">Auto-archive completed tasks</p>
                                        <p className="text-sm text-zinc-500 mt-1">Automatically move completed tasks to archive after 30 days</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={autoArchive}
                                            onChange={(e) => setAutoArchive(e.target.checked)}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-600"></div>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Lifecycle */}
                {activeSection === "lifecycle" && (
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-2">Project Lifecycle</h3>
                            <p className="text-sm text-zinc-500 mb-4">
                                Define and manage your project journey stages. Drag to reorder, edit names inline, or add/remove stages.
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
                                        toast.error("Failed to update lifecycle");
                                    } finally {
                                        setSavingLifecycle(false);
                                    }
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* Visibility */}
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
                                            project?.visibility === opt.id
                                                ? "border-indigo-500 bg-indigo-50/10"
                                                : "border-zinc-200 dark:border-zinc-700"
                                        )}
                                    >
                                        <input
                                            type="radio"
                                            name="visibility"
                                            value={opt.id}
                                            defaultChecked={project?.visibility === opt.id}
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
                                onClick={() => {
                                    setSavingVisibility(true);
                                    setTimeout(() => setSavingVisibility(false), 1000);
                                }}
                                disabled={savingVisibility}
                                className="mt-4 bg-blue-600 hover:bg-blue-700 text-white"
                            >
                                {savingVisibility ? "Saving..." : "Save Changes"}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Notifications */}
                {activeSection === "notifications" && (
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-4">Notification Preferences</h3>
                            <p className="text-sm text-zinc-500 mb-4">Configure how you receive notifications for this project</p>
                            <div className="space-y-4">
                                {[
                                    { title: "New applications", desc: "Get notified when someone applies to join" },
                                    { title: "Task assignments", desc: "Get notified when tasks are assigned to you" },
                                    { title: "Chat messages", desc: "Get notified for new messages in project chat" }
                                ].map((item, idx) => (
                                    <div key={idx} className="flex items-center justify-between p-4 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                        <div>
                                            <p className="font-semibold text-zinc-900 dark:text-zinc-100">{item.title}</p>
                                            <p className="text-sm text-zinc-500 mt-1">{item.desc}</p>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" defaultChecked className="sr-only peer" />
                                            <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-600"></div>
                                        </label>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Export */}
                {activeSection === "export" && (
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-4">Export Project Data</h3>
                            <p className="text-sm text-zinc-500 mb-4">Download all project data as a JSON file for backup or migration</p>
                            <Button
                                onClick={() => {
                                    setLoadingExport(true);
                                    setTimeout(() => setLoadingExport(false), 2000);
                                }}
                                disabled={loadingExport}
                                className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
                            >
                                {loadingExport ? (
                                    <>Exporting...</>
                                ) : (
                                    <>
                                        <Download className="w-4 h-4" />
                                        Export All Data
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Danger Zone */}
                {activeSection === "danger" && (
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-lg font-bold text-red-600 dark:text-red-400 mb-4">Danger Zone</h3>
                            <div className="space-y-4">
                                <div className="p-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="font-semibold text-red-900 dark:text-red-100">Finalize Project</p>
                                            <p className="text-sm text-red-800 dark:text-red-200 mt-1">Mark this project as successfully completed. This will freeze tasks and distribute reputation points.</p>
                                        </div>
                                        <Button
                                            onClick={() => setConfirmAction({ title: "Finalize Project", description: "Are you sure you want to finalize this project? This will mark it as Completed.", action: handleFinalize })}
                                            disabled={project?.status === 'completed' || isPending}
                                            className="whitespace-nowrap px-4 py-2 rounded-md bg-white border border-red-200 text-red-600 hover:bg-red-50 transition-colors text-sm font-medium"
                                        >
                                            {project?.status === 'completed' ? "Completed" : "Finalize"}
                                        </Button>
                                    </div>
                                </div>

                                <div className="p-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="font-semibold text-red-900 dark:text-red-100">Archive Project</p>
                                            <p className="text-sm text-red-800 dark:text-red-200 mt-1">Hide this project from public view. It can be restored later.</p>
                                        </div>
                                        <button className="whitespace-nowrap px-4 py-2 rounded-md border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors text-sm font-medium">
                                            Archive
                                        </button>
                                    </div>
                                </div>

                                <div className="p-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="font-semibold text-red-900 dark:text-red-100">Delete Project</p>
                                            <p className="text-sm text-red-800 dark:text-red-200 mt-1">Permanently delete this project and all its data. This action cannot be undone.</p>
                                        </div>
                                        <Button
                                            variant="destructive"
                                            onClick={() => setConfirmAction({ title: "Delete Project", description: "Are you sure you want to delete this project? This action cannot be undone.", action: handleDelete })}
                                            disabled={isPending}
                                            className="whitespace-nowrap px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors text-sm font-medium"
                                        >
                                            {isPending ? "Deleting..." : "Delete Project"}
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
                onOpenChange={(open) => { if (!open) setConfirmAction(null); }}
                title={confirmAction?.title ?? ""}
                description={confirmAction?.description}
                confirmLabel="Confirm"
                variant="destructive"
                onConfirm={() => confirmAction?.action()}
            />
        </div>
    );
}
