"use client";

import React, { useState } from "react";
import { Plus, LayoutTemplate, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Template {
    id: string;
    title: string;
    description?: string;
    priority: string;
}

interface TaskTemplatesProps {
    projectId?: string;
    onSelectTemplate: (template: Template) => void;
}

const MOCK_TEMPLATES: Template[] = [
    { id: '1', title: 'Bug Report', description: 'Standard bug report template', priority: 'high' },
    { id: '2', title: 'Feature Request', description: 'New feature proposal structure', priority: 'medium' },
    { id: '3', title: 'Code Review', description: 'Checklist for code reviews', priority: 'medium' },
];

export default function TaskTemplates({ projectId, onSelectTemplate }: TaskTemplatesProps) {
    const [templates, setTemplates] = useState<Template[]>(MOCK_TEMPLATES);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <LayoutTemplate className="w-4 h-4 text-indigo-500" />
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Task Templates</h3>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors"
                >
                    <Plus className="w-3.5 h-3.5" />
                    New Template
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {templates.map((template) => (
                    <div
                        key={template.id}
                        onClick={() => {
                            setSelectedId(template.id);
                            onSelectTemplate(template);
                        }}
                        className={cn(
                            "group cursor-pointer rounded-xl border p-3 transition-all relative",
                            selectedId === template.id
                                ? "border-indigo-500 bg-indigo-50/50 dark:bg-indigo-900/20 ring-1 ring-indigo-500"
                                : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-sm"
                        )}
                    >
                        {selectedId === template.id && (
                            <div className="absolute top-2 right-2 text-indigo-600">
                                <Check className="w-4 h-4" />
                            </div>
                        )}
                        <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 mb-1">{template.title}</h4>
                        <p className="text-xs text-zinc-500 line-clamp-2">{template.description || "No description"}</p>
                        <div className="mt-2 flex items-center gap-2">
                            <span className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-500 capitalize">
                                {template.priority}
                            </span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Create Template Modal (Internal) */}
            {showCreateModal && (
                <div className="fixed inset-0 z-[250] flex items-center justify-center p-4">
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowCreateModal(false)} />
                    <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-800 p-6 z-[251]">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Create Template</h3>
                            <button onClick={() => setShowCreateModal(false)}>
                                <X className="w-5 h-5 text-zinc-500" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-zinc-500 mb-1">Template Name</label>
                                <input type="text" className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm" placeholder="e.g. Daily Standup" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-zinc-500 mb-1">Default Description</label>
                                <textarea className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm" rows={3} placeholder="Template content..." />
                            </div>
                            <Button className="w-full" onClick={() => setShowCreateModal(false)}>Save Template</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
