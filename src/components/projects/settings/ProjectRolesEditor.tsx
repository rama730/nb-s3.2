"use client";

import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import type { ProjectRoleFormValue } from "@/lib/projects/project-roles-form";
import type { ProjectSettingsMember } from "@/lib/projects/settings-policies";

export { normalizeProjectRoleFormValues } from "@/lib/projects/project-roles-form";
export type { ProjectRoleFormValue, ProjectRolesFormValues } from "@/lib/projects/project-roles-form";

type ProjectRoleField = ProjectRoleFormValue & {
    fieldKey?: string;
};

type ProjectRolesEditorProps = {
    fields: ProjectRoleField[];
    register: UseFormRegister<any>;
    errors?: FieldErrors<any>;
    disabled?: boolean;
    className?: string;
    title?: string;
    description?: string;
    emptyText?: string;
    addLabel?: string;
    onAddRole: () => void;
    onRemoveRole: (index: number, roleId?: string) => void;
    members?: ProjectSettingsMember[];
};

export function ProjectRolesEditor({
    fields,
    register,
    errors,
    disabled = false,
    className = "",
    title = "Project Roles",
    description = "Define open positions for collaborators",
    emptyText = "No open roles listed. Add one to invite collaborators.",
    addLabel = "Add Role",
    onAddRole,
    onRemoveRole,
    members,
}: ProjectRolesEditorProps) {
    const roleErrors = errors?.roles as
        | Array<{
            role?: { message?: string };
            count?: { message?: string };
            description?: { message?: string };
        }>
        | undefined;

    return (
        <div className={`space-y-6 ${className}`}>
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{title}</h3>
                    <p className="text-sm text-zinc-500">{description}</p>
                </div>
                <button
                    type="button"
                    onClick={onAddRole}
                    disabled={disabled}
                    className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <Plus className="h-4 w-4" />
                    {addLabel}
                </button>
            </div>

            <div className="grid gap-4">
                {fields.length === 0 ? (
                    <div className="rounded-xl border-2 border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-400 dark:border-zinc-800">
                        {emptyText}
                    </div>
                ) : (
                    fields.map((field, index) => (
                        <div
                            key={field.fieldKey ?? field.id ?? index}
                            className="animate-in zoom-in-95 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm duration-200 dark:border-zinc-800 dark:bg-zinc-900"
                        >
                            <div className="flex items-start gap-4">
                                <div className="flex-1 space-y-1.5">
                                    <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                        Role Title
                                    </label>
                                    <input
                                        {...register(`roles.${index}.role`)}
                                        disabled={disabled}
                                        placeholder="e.g. Frontend Developer"
                                        className="w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700"
                                    />
                                    {roleErrors?.[index]?.role?.message ? (
                                        <p className="text-xs text-red-500">{roleErrors[index]?.role?.message}</p>
                                    ) : null}
                                </div>
                                <div className="w-24 space-y-1.5">
                                    <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                        Count
                                    </label>
                                    <input
                                        type="number"
                                        min={1}
                                        {...register(`roles.${index}.count`, { valueAsNumber: true })}
                                        disabled={disabled || field.id === 'lead-role'}
                                        className="w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700"
                                    />
                                    {roleErrors?.[index]?.count?.message ? (
                                        <p className="text-xs text-red-500">{roleErrors[index]?.count?.message}</p>
                                    ) : null}
                                </div>
                                <button
                                    type="button"
                                    aria-label={`Remove role ${index + 1}`}
                                    onClick={() => onRemoveRole(index, field.id)}
                                    disabled={disabled || field.id === 'lead-role'}
                                    className="mt-6 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-950/30"
                                    style={field.id === 'lead-role' ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}
                                >
                                    <Trash2 className="h-5 w-5" />
                                </button>
                            </div>
                            <div className="mt-4">
                                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                    Description (Optional)
                                </label>
                                <textarea
                                    {...register(`roles.${index}.description`)}
                                    disabled={disabled}
                                    placeholder="Describe the responsibilities and requirements..."
                                    className="mt-1.5 min-h-[80px] w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700"
                                />
                            </div>

                            {/* Display assigned members if any */}
                            {members && members.length > 0 && (() => {
                                const assignedMembers = members.filter(m => {
                                    if (field.id === 'lead-role') {
                                        return m.membershipRole === 'owner';
                                    }
                                    return m.projectRoleTitle?.trim().toLowerCase() === field.role?.trim().toLowerCase();
                                });
                                if (assignedMembers.length === 0) return null;
                                return (
                                    <div className="mt-4 border-t border-zinc-100 dark:border-zinc-800 pt-3">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 block mb-2">
                                            {field.id === 'lead-role' ? 'Project Lead' : 'Assigned Members'}
                                        </label>
                                        <div className="flex flex-wrap gap-2">
                                            {assignedMembers.map(member => (
                                                <div 
                                                    key={member.id}
                                                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm"
                                                >
                                                    {member.avatarUrl ? (
                                                        <img 
                                                            src={member.avatarUrl} 
                                                            alt={member.fullName || member.username || 'Member'} 
                                                            className="w-6 h-6 rounded-full object-cover shrink-0"
                                                        />
                                                    ) : (
                                                        <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center text-[11px] font-bold text-indigo-600 dark:text-indigo-400 shrink-0">
                                                            {(member.fullName || member.username || 'M').charAt(0).toUpperCase()}
                                                        </div>
                                                    )}
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="font-semibold text-zinc-800 dark:text-zinc-200 leading-tight truncate">
                                                            {member.fullName || member.username}
                                                        </span>
                                                        {member.username && (
                                                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-none">
                                                                @{member.username}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/50 shrink-0">
                                                        {member.membershipRole === 'owner' ? 'Lead' : member.membershipRole === 'admin' ? 'Co-leader' : 'Member'}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
