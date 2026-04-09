"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import {
    addDaysToSprintDateInput,
    createSprintDraftSchema,
    getDefaultSprintDateRange,
    type CreateSprintDraftInput,
} from "@/lib/projects/sprints";

interface CreateSprintModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreate: (data: CreateSprintDraftInput) => Promise<{ success: boolean; error?: string }>;
    sprint?: any; // If editing
    sprintCount?: number; // To auto-generate name "Sprint N"
}

export default function CreateSprintModal({ 
    isOpen, 
    onClose, 
    onCreate,
    sprint,
    sprintCount = 1
}: CreateSprintModalProps) {
    const [name, setName] = useState("");
    const [goal, setGoal] = useState("");
    const [description, setDescription] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");

    // Initialize form
    useEffect(() => {
        if (isOpen) {
            const defaultDateRange = getDefaultSprintDateRange();
            if (sprint) {
                setName(sprint.name);
                setGoal(sprint.goal || "");
                setDescription(sprint.description || "");
                const sprintStartDate = typeof sprint.startDate === "string"
                    ? sprint.startDate
                    : typeof sprint.start_date === "string"
                        ? sprint.start_date
                        : "";
                const sprintEndDate = typeof sprint.endDate === "string"
                    ? sprint.endDate
                    : typeof sprint.end_date === "string"
                        ? sprint.end_date
                        : "";
                setStartDate(sprintStartDate ? sprintStartDate.split('T')[0] : defaultDateRange.startDate);
                setEndDate(sprintEndDate ? sprintEndDate.split('T')[0] : defaultDateRange.endDate);
            } else {
                // New sprint - initialize with a valid default sprint window.
                setName(`Sprint ${sprintCount + 1}`);
                setGoal("");
                setDescription("");
                setStartDate(defaultDateRange.startDate);
                setEndDate(defaultDateRange.endDate);
            }
            setErrorMessage("");
        }
    }, [isOpen, sprint, sprintCount]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage("");

        const parsed = createSprintDraftSchema.safeParse({
            ...sprint,
            name,
            goal,
            description,
            startDate,
            endDate,
        });
        if (!parsed.success) {
            setErrorMessage(parsed.error.issues[0]?.message ?? "Sprint details are invalid");
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await onCreate(parsed.data);
            if (!result.success) {
                setErrorMessage(result.error ?? "Failed to save sprint");
                return;
            }
            onClose();
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "Failed to save sprint");
        } finally {
            setIsSubmitting(false);
        }
    };

    const setDuration = (weeks: number) => {
        if (!startDate) return;
        setEndDate(addDaysToSprintDateInput(startDate, weeks * 7));
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />
            
            {/* Modal Card */}
            <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 10 }}
                className="relative z-10 w-full max-w-lg rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 flex-shrink-0">
                    <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                        {sprint ? "Edit Sprint" : "Create Sprint"}
                    </h3>
                    <button 
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Form Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Error Message */}
                        {errorMessage && (
                            <div className="rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                                {errorMessage}
                            </div>
                        )}

                        {/* Sprint Name */}
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                                Sprint Name *
                            </label>
                            <input
                                required
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g., Sprint 1"
                                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
                            />
                        </div>

                        {/* Sprint Goal */}
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                                Sprint Goal
                            </label>
                            <input
                                value={goal}
                                onChange={(e) => setGoal(e.target.value)}
                                placeholder="What do you want to achieve?"
                                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
                            />
                        </div>

                        {/* Description */}
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                                Description
                            </label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={2}
                                placeholder="Optional description..."
                                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none resize-none text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
                            />
                        </div>

                        <div className="space-y-4 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/30">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Sprint Duration</span>
                                <span className="text-xs text-zinc-500 dark:text-zinc-400">Required</span>
                            </div>

                            {/* Quick Duration Buttons */}
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mr-2">Quick set:</span>
                                <button
                                    type="button"
                                    onClick={() => setDuration(1)}
                                    className="px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-xs font-medium hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors text-zinc-700 dark:text-zinc-300"
                                >
                                    1 week
                                </button>
                                <button 
                                    type="button"
                                    onClick={() => setDuration(2)}
                                    className="px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-xs font-medium hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors text-zinc-700 dark:text-zinc-300"
                                >
                                    2 weeks
                                </button>
                                <button 
                                    type="button"
                                    onClick={() => setDuration(4)}
                                    className="px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-xs font-medium hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors text-zinc-700 dark:text-zinc-300"
                                >
                                    4 weeks
                                </button>
                            </div>

                            {/* Date Range */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                                        Start Date *
                                    </label>
                                    <input
                                        type="date"
                                        value={startDate}
                                        required
                                        onChange={(e) => setStartDate(e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-zinc-900 dark:text-zinc-100"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                                        End Date *
                                    </label>
                                    <input
                                        type="date"
                                        value={endDate}
                                        required
                                        min={startDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-zinc-900 dark:text-zinc-100"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex justify-end gap-3 pt-4">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-700 dark:text-zinc-300"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-lg shadow-blue-500/20"
                            >
                                {isSubmitting ? "Saving..." : sprint ? "Update Sprint" : "Create Sprint"}
                            </button>
                        </div>
                    </form>
                </div>
            </motion.div>
        </div>
    );
}
