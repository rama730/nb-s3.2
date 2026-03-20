"use client";

import Image from "next/image";
import { Heart, MessageCircle, Repeat2, Share2, MoreHorizontal } from "lucide-react";
import type { Profile } from "@/lib/db/schema";

// Post type definition (posts table not in current schema)
interface Post {
    id: string;
    content: string;
    mediaUrls?: string[] | null;
    createdAt: Date;
    authorId: string;
}

interface PostCardProps {
    post: Post;
    author: Profile;
}

export default function PostCard({ post, author }: PostCardProps) {
    const mediaUrls = (post.mediaUrls as string[]) || [];

    return (
        <article className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 hover:shadow-lg transition-all duration-300 hover:scale-[1.01]">
            {/* Post Header */}
            <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="relative w-10 h-10 rounded-full app-accent-gradient flex items-center justify-center text-white font-semibold overflow-hidden">
                        {author?.avatarUrl ? (
                            <Image
                                src={author.avatarUrl}
                                alt={author.fullName || "User"}
                                fill
                                className="rounded-full object-cover"
                            />
                        ) : (
                            <span>{author?.fullName?.[0] || "U"}</span>
                        )}
                    </div>
                    <div>
                        <p className="font-semibold text-zinc-900 dark:text-white">
                            {author?.fullName || "Anonymous"}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {new Date(post.createdAt).toLocaleDateString()}
                        </p>
                    </div>
                </div>
                <button className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                    <MoreHorizontal className="w-4 h-4 text-zinc-500" />
                </button>
            </div>

            {/* Post Content */}
            <p className="text-zinc-900 dark:text-white mb-4 whitespace-pre-wrap leading-relaxed">
                {post.content}
            </p>

            {/* Post Media */}
            {mediaUrls.length > 0 && (
                <div className="rounded-lg overflow-hidden mb-4">
                    <Image
                        src={mediaUrls[0]}
                        alt="Post media"
                        width={600}
                        height={400}
                        className="w-full h-auto object-cover"
                    />
                </div>
            )}

            {/* Post Actions */}
            <div className="flex items-center gap-6 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <button className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 hover:text-red-500 transition-colors">
                    <Heart className="w-5 h-5" />
                    <span className="text-sm">0</span>
                </button>
                <button className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 hover:text-blue-500 transition-colors">
                    <MessageCircle className="w-5 h-5" />
                    <span className="text-sm">0</span>
                </button>
                <button className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 hover:text-green-500 transition-colors">
                    <Repeat2 className="w-5 h-5" />
                    <span className="text-sm">0</span>
                </button>
                <button className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors ml-auto">
                    <Share2 className="w-5 h-5" />
                </button>
            </div>
        </article>
    );
}
