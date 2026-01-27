"use client";

import React, { useState } from "react";
import { Send, Heart, Loader2, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { createCommentAction, toggleCommentLikeAction, deleteCommentAction } from "@/app/actions/task-comment";

import { useTaskComments } from "@/hooks/useTaskComments";

interface CommentsTabProps {
    taskId: string;
    isOwnerOrMember: boolean;
    projectId: string;
    currentUserId?: string;
}

export default function CommentsTab({ 
    taskId, 
    isOwnerOrMember, 
    projectId, 
    currentUserId
}: CommentsTabProps) {
    const { comments, isLoading, isLiked } = useTaskComments(taskId, currentUserId);
    const [newComment, setNewComment] = useState("");
    const [isAdding, setIsAdding] = useState(false);

    const handleAddComment = async () => {
        if (!newComment.trim() || !isOwnerOrMember) return;
        
        setIsAdding(true);
        try {
            const result = await createCommentAction(taskId, newComment, projectId);
            if (result.success) {
                setNewComment("");
            }
        } catch (error) {
            console.error("Error adding comment:", error);
        } finally {
            setIsAdding(false);
        }
    };

    const handleToggleLike = async (commentId: string) => {
        if (!isOwnerOrMember) return;
        
        try {
            await toggleCommentLikeAction(commentId, projectId);
        } catch (error) {
            console.error("Error toggling like:", error);
        }
    };

    const handleDelete = async (commentId: string) => {
        if (!isOwnerOrMember) return;
        
        try {
            await deleteCommentAction(commentId, projectId);
        } catch (error) {
            console.error("Error deleting comment:", error);
        }
    };

    if (isLoading) {
        return (
            <div className="p-6 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6">
            {/* Add Comment */}
            {isOwnerOrMember && (
                <div className="space-y-2">
                    <textarea
                        placeholder="Add a comment..."
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        rows={3}
                        disabled={isAdding}
                        className="w-full p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none resize-none"
                    />
                    <div className="flex justify-end">
                        <button 
                            onClick={handleAddComment}
                            disabled={!newComment.trim() || isAdding}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isAdding ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Send className="w-3.5 h-3.5" />
                            )}
                            Post Comment
                        </button>
                    </div>
                </div>
            )}

            {/* Comments List */}
            <div className="space-y-6">
                {comments.map((comment) => (
                    <div key={comment.id} className="flex gap-4">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                            {comment.user_profile?.full_name?.[0]?.toUpperCase() || 'U'}
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-sm">
                                    {comment.user_profile?.full_name || comment.user_profile?.username || 'Unknown'}
                                </span>
                                <span className="text-xs text-zinc-500">
                                    {formatDistanceToNow(new Date(comment.created_at))} ago
                                </span>
                                {currentUserId === comment.user_id && (
                                    <button
                                        onClick={() => handleDelete(comment.id)}
                                        className="ml-auto text-zinc-400 hover:text-red-500 transition-colors"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                            <div className="text-sm text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-lg rounded-tl-none">
                                {comment.content}
                            </div>
                            <div className="flex items-center gap-4 mt-2">
                                <button
                                    onClick={() => handleToggleLike(comment.id)}
                                    disabled={!isOwnerOrMember}
                                    className={cn(
                                        "flex items-center gap-1.5 text-xs font-medium transition-colors",
                                        isLiked(comment)
                                            ? "text-red-500"
                                            : "text-zinc-500 hover:text-red-500",
                                        !isOwnerOrMember && "cursor-not-allowed opacity-50"
                                    )}
                                >
                                    <Heart className={cn("w-4 h-4", isLiked(comment) && "fill-current")} />
                                    {comment.like_count || 0}
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Empty State */}
            {comments.length === 0 && (
                <p className="text-sm text-zinc-400 text-center py-8">No comments yet</p>
            )}
        </div>
    );
}
