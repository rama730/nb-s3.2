'use client'

import { Pencil, User } from 'lucide-react'
import { Card } from './Card'

interface AboutCardProps {
    profile: any
    isOwner: boolean
    onEdit?: () => void
}

export function AboutCard({ profile, isOwner, onEdit }: AboutCardProps) {
    const bio = typeof profile?.bio === 'string' ? profile.bio.trim() : ''
    const hasBio = bio.length > 0

    return (
        <Card
            title="About"
            icon={<User className="w-5 h-5" />}
            action={isOwner && onEdit ? (
                <button
                    type="button"
                    onClick={onEdit}
                    aria-label="Edit about section"
                    className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
                >
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                </button>
            ) : null}
        >
            <div className="px-5 py-4">
                {hasBio ? (
                    <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                        {bio}
                    </p>
                ) : (
                    <div className="text-center py-6">
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            {isOwner ? 'Add a bio to tell others about yourself' : 'No bio added yet'}
                        </p>
                        {isOwner && onEdit ? (
                            <button
                                type="button"
                                onClick={onEdit}
                                className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-500"
                            >
                                Add Bio
                            </button>
                        ) : null}
                    </div>
                )}
            </div>
        </Card>
    )
}
