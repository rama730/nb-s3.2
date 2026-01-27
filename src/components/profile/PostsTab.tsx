"use client";

import { FileText, Plus } from "lucide-react";
import PostCard from "./PostCard";
import type { Profile } from "@/lib/db/schema";

// Post type definition (posts table not in current schema)
interface Post {
    id: string;
    content: string;
    mediaUrls?: string[] | null;
    createdAt: Date;
    authorId: string;
}

interface PostsTabProps {
    profile: Profile;
    isOwner: boolean;
    posts?: Post[];
}

export default function PostsTab({ profile, isOwner, posts = [] }: PostsTabProps) {
    return (
        <div className="space-y-4">
            {isOwner && posts.length === 0 && (
                <div className="rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50 p-12 text-center">
                    <FileText className="w-12 h-12 text-zinc-400 dark:text-zinc-600 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">
                        No posts yet
                    </h3>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
                        Share your thoughts, projects, or updates with the community.
                    </p>
                    <button className="px-6 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-2 mx-auto">
                        <Plus className="w-4 h-4" />
                        Create your first post
                    </button>
                </div>
            )}

            {posts.length > 0 && (
                <div className="space-y-4">
                    {posts.map((post) => (
                        <PostCard key={post.id} post={post} author={profile} />
                    ))}
                </div>
            )}

            {!isOwner && posts.length === 0 && (
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 text-center">
                    <FileText className="w-12 h-12 text-zinc-400 dark:text-zinc-600 mx-auto mb-4" />
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        No posts to display yet.
                    </p>
                </div>
            )}
        </div>
    );
}
