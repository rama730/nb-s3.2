'use client'

import { Card } from './Card'
import { MessageSquare } from 'lucide-react'

interface ActivityFeedContainerProps {
    initialPosts: any[]
    profile: any
    currentUser: any
}

export function ActivityFeedContainer({ initialPosts, profile, currentUser }: ActivityFeedContainerProps) {
    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 px-1">Activity</h3>
            {initialPosts && initialPosts.length > 0 ? (
                initialPosts.map((post) => (
                    <Card key={post.id} title="" className="p-0 overflow-hidden">
                        <div className="p-4">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                                <div>
                                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">{profile.full_name || profile.username}</div>
                                    <div className="text-xs text-zinc-500 dark:text-zinc-400">{new Date(post.created_at).toLocaleDateString()}</div>
                                </div>
                            </div>
                            <p className="text-zinc-700 dark:text-zinc-300 mb-4">{post.content}</p>
                            <div className="flex items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400 border-t border-zinc-100 dark:border-zinc-800 pt-3">
                                <button className="flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-200">
                                    <MessageSquare className="w-4 h-4" />
                                    Comment
                                </button>
                            </div>
                        </div>
                    </Card>
                ))
            ) : (
                <div className="text-center py-12 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800">
                    <p className="text-zinc-500 dark:text-zinc-400">No recent activity</p>
                </div>
            )}
        </div>
    )
}
