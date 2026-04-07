'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import CreateProjectWizard from './CreateProjectWizard'

type CreateProjectSource = 'scratch' | 'github' | 'upload' | null

interface CreateProjectRouteClientProps {
    initialSource?: CreateProjectSource
}

export function CreateProjectRouteClient({
    initialSource = null,
}: CreateProjectRouteClientProps) {
    const router = useRouter()

    const handleClose = useCallback(() => {
        if (typeof window !== 'undefined' && window.history.length > 1) {
            router.back()
            return
        }

        router.push('/hub')
    }, [router])

    const handleSuccess = useCallback((projectId: string) => {
        router.push(`/projects/${encodeURIComponent(projectId)}?tab=files`)
    }, [router])

    return (
        <div className="h-full min-h-0 bg-zinc-50 dark:bg-zinc-950">
            <CreateProjectWizard
                onClose={handleClose}
                onSuccess={handleSuccess}
                initialSource={initialSource}
            />
        </div>
    )
}
