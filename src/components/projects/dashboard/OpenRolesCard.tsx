"use client";

import { Briefcase, CheckCircle, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import DashboardCard from "./DashboardCard";
import { motion } from "framer-motion";

interface OpenRolesCardProps {
    roles: any[];
    isCreator: boolean;
    isCollaborator: boolean;
    hasPendingApplication: boolean;
    onApply: (roleId?: string) => void;
    onManageRoles: () => void;
}

export default function OpenRolesCard({
    roles,
    isCreator,
    isCollaborator,
    hasPendingApplication,
    onApply,
    onManageRoles,
}: OpenRolesCardProps) {
    const openRoles = roles.filter((r: any) => {
        const remaining = (r?.count || 0) - (r?.filled || 0);
        return remaining > 0;
    });

    return (
        <DashboardCard
            title="Open Roles"
            icon={Briefcase}
            compact
        >
            <div className="space-y-3">
                {/* Status Banner */}
                {isCollaborator ? (
                    <motion.div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-400 p-2 rounded-lg border border-emerald-100 dark:border-emerald-900/20">
                        <CheckCircle className="w-3.5 h-3.5 fill-current" />
                        <span className="text-xs font-medium">Team member</span>
                    </motion.div>
                ) : hasPendingApplication ? (
                    <motion.div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-400 p-2 rounded-lg border border-amber-100 dark:border-amber-900/20">
                        <Clock className="w-3.5 h-3.5 fill-current" />
                        <span className="text-xs font-medium">Application pending review</span>
                    </motion.div>
                ) : null}

                {/* Roles List */}
                {openRoles.length > 0 ? (
                    <motion.div className="space-y-1.5">
                        {openRoles.map((role) => {
                            const remaining = (role?.count || 0) - (role?.filled || 0);
                            return (
                                <motion.div
                                    key={role.id}
                                    className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors group relative"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="pr-16">
                                            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{role.role}</p>
                                            <div className="flex flex-wrap gap-1.5">
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                                                    {remaining} spot{remaining !== 1 ? 's' : ''}
                                                </span>
                                                {role.skills?.slice(0, 2).map((skill: string) => (
                                                    <span key={skill} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/30">
                                                        {skill}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>

                                        {!isCreator && !isCollaborator && (
                                            <button
                                                onClick={() => onApply(role.id)}
                                                className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-2.5 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 font-semibold shadow-sm"
                                            >
                                                Apply
                                            </button>
                                        )}
                                    </div>
                                    {role.description && (
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2 line-clamp-2">
                                            {role.description}
                                        </p>
                                    )}
                                </motion.div>
                            );
                        })}
                    </motion.div>
                ) : (
                    <div className="text-center py-3 text-xs text-zinc-400 italic">
                        No open positions listed
                    </div>
                )}

                {/* Generic Apply Button */}
                {!isCreator && !isCollaborator && (
                    <button
                        onClick={() => onApply()}
                        disabled={hasPendingApplication}
                        className={cn(
                            "w-full py-2 flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg transition-all",
                            hasPendingApplication
                                ? "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                                : "bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-700 shadow-sm"
                        )}
                    >
                        {hasPendingApplication ? "Application Submitted" : "Apply General"}
                    </button>
                )}
            </div>
        </DashboardCard>
    );
}

// Needed for the Clock icon which was referenced but not imported in my paste above
import { Clock } from "lucide-react";
