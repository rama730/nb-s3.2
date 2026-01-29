'use client'

import { User } from 'lucide-react'
import { Card } from './Card'
import { Pencil } from 'lucide-react'
import { useState } from 'react'

interface AboutCardProps {
    profile: any
    isOwner: boolean
    onBioUpdated: (bio: string) => void
}

export function AboutCard({ profile, isOwner, onBioUpdated }: AboutCardProps) {
    const hasBio = profile?.bio && profile.bio.trim().length > 0
    const [isEditing, setIsEditing] = useState(false)
    const [bio, setBio] = useState(profile?.bio || '')

    const [saving, setSaving] = useState(false)
    
    // Dynamically import toast/action to avoid circular deps if any (standard import is fine usually)
    // We need toast for error feedback
    
    const handleSave = async () => {
        setSaving(true)
        try {
            // Import action dynamically here or at top
            const { updateBioAction } = await import('@/app/actions/profile')
            const { toast } = await import('sonner')
            
            const result = await updateBioAction(bio)
            
            if (result.success) {
                onBioUpdated(bio)
                setIsEditing(false)
                toast.success("Bio updated")
            } else {
                toast.error(result.error || "Failed to update bio")
            }
        } catch (e) {
            console.error(e)
            // toast.error("An error occurred") 
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card
            title="About"
            icon={<User className="w-5 h-5" />}
            action={isOwner && !isEditing ? (
                <button
                    onClick={() => setIsEditing(true)}
                    className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
                >
                    <Pencil className="w-4 h-4" />
                </button>
            ) : null}
        >
            <div className="px-5 py-4">
                {isEditing ? (
                    <div className="space-y-3">
                        <textarea
                            value={bio}
                            onChange={(e) => setBio(e.target.value)}
                            className="w-full min-h-[100px] p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                            placeholder="Tell us about yourself..."
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setIsEditing(false)}
                                className="px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
                            >
                                {saving ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </div>
                ) : hasBio ? (
                    <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                        {profile.bio}
                    </p>
                ) : (
                    <div className="text-center py-6">
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            {isOwner ? 'Add a bio to tell others about yourself' : 'No bio added yet'}
                        </p>
                        {isOwner && (
                            <button
                                onClick={() => setIsEditing(true)}
                                className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-500"
                            >
                                Add Bio
                            </button>
                        )}
                    </div>
                )}
            </div>
        </Card>
    )
}
