import { useEffect } from "react";
import Image from "next/image";
import { useChatStore } from "@/stores/chatStore";
import { formatDistanceToNow } from "date-fns";
import { Briefcase, Loader2, ArrowRight, ArrowLeft } from "lucide-react";

export function ApplicationList() {
    const { 
        applications, 
        applicationsLoading, 
        fetchApplications, 
        openConversation 
    } = useChatStore();

    // Fetch applications on mount (store handles caching)
    useEffect(() => {
        fetchApplications(true);
    }, [fetchApplications]);

    if (applicationsLoading && applications.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            </div>
        );
    }

    if (applications.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/20 rounded-full flex items-center justify-center mb-4">
                    <Briefcase className="w-8 h-8 text-indigo-400" />
                </div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    No applications
                </p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                    Your hiring and application history
                </p>
            </div>
        );
    }

    return (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {applications.map((app) => (
                <button
                    key={app.id}
                    onClick={() => app.conversationId && openConversation(app.conversationId)}
                    className="w-full flex items-start gap-3 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors text-left group"
                >
                    {/* Avatar */}
                    <div className="relative flex-shrink-0">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center overflow-hidden ring-2 ring-white dark:ring-zinc-900">
                            {app.displayUser.avatarUrl ? (
                                <Image
                                    src={app.displayUser.avatarUrl}
                                    alt={app.displayUser.fullName || ''}
                                    width={40}
                                    height={40}
                                    unoptimized
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <span className="text-white text-xs font-bold">
                                    {(app.displayUser.fullName || app.displayUser.username || '?')[0].toUpperCase()}
                                </span>
                            )}
                        </div>
                        <div className="absolute -bottom-1 -right-1 bg-white dark:bg-zinc-900 rounded-full p-0.5">
                            <div className={`w-4 h-4 rounded-full flex items-center justify-center ${
                                app.type === 'incoming' 
                                    ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400'
                                    : 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400'
                            }`}>
                                {app.type === 'incoming' ? (
                                    <ArrowLeft className="w-2.5 h-2.5 transform -rotate-45" />
                                ) : (
                                    <ArrowRight className="w-2.5 h-2.5 transform -rotate-45" />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                            <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate">
                                {app.displayUser.fullName || app.displayUser.username || 'Unknown'}
                            </span>
                            <span className="text-[10px] text-zinc-400 flex-shrink-0 ml-2">
                                {formatDistanceToNow(new Date(app.createdAt), { addSuffix: false })}
                            </span>
                        </div>
                        
                        <div className="flex flex-col gap-0.5">
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                                <span className={
                                    (app.lifecycleStatus || app.status) === 'accepted' ? 'text-emerald-600 dark:text-emerald-400' :
                                    (app.lifecycleStatus || app.status) === 'role_filled' ? 'text-blue-600 dark:text-blue-400' :
                                    (app.lifecycleStatus || app.status) === 'rejected' || (app.lifecycleStatus || app.status) === 'withdrawn' ? 'text-red-600 dark:text-red-400' :
                                    'text-indigo-600 dark:text-indigo-400'
                                }>
                                    {app.type === 'incoming' ? 'Applying for ' : 'Applied for '}
                                    {app.roleTitle}
                                </span>
                            </p>
                            <p className="text-[10px] text-zinc-400 truncate flex items-center gap-1">
                                {app.projectTitle}
                                {(app.lifecycleStatus || app.status) !== 'pending' && (
                                    <span className={`px-1 rounded-full text-[8px] font-bold uppercase ${
                                        (app.lifecycleStatus || app.status) === 'accepted'
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : (app.lifecycleStatus || app.status) === 'role_filled'
                                                ? 'bg-blue-100 text-blue-700'
                                                : 'bg-red-100 text-red-700'
                                    }`}>
                                        {(app.lifecycleStatus || app.status) === 'role_filled' ? 'filled' : (app.lifecycleStatus || app.status)}
                                    </span>
                                )}
                            </p>
                            {app.decisionReason === 'role_filled' && (
                                <p className="text-[10px] text-blue-500 dark:text-blue-300">Role filled</p>
                            )}
                        </div>
                    </div>
                </button>
            ))}
        </div>
    );
}
