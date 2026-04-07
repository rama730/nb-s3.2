import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { CreateProjectRouteClient } from '@/components/projects/create-wizard/CreateProjectRouteClient'
import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { getViewerAuthContext } from '@/lib/server/viewer-context'

const VALID_CREATE_PROJECT_SOURCES = new Set(['scratch', 'github', 'upload'] as const)

export const metadata: Metadata = buildRouteMetadata({
    title: 'Create Project | Edge',
    description: 'Start a new project on Edge.',
    path: '/projects/new',
})

export default async function NewProjectPage({
    searchParams,
}: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
    const { user } = await getViewerAuthContext()

    if (!user) {
        redirect('/login')
    }

    const resolvedSearchParams = (await searchParams) ?? {}
    const rawSource = typeof resolvedSearchParams.source === 'string'
        ? resolvedSearchParams.source
        : null
    const initialSource = rawSource && VALID_CREATE_PROJECT_SOURCES.has(rawSource as 'scratch' | 'github' | 'upload')
        ? (rawSource as 'scratch' | 'github' | 'upload')
        : null

    return <CreateProjectRouteClient initialSource={initialSource} />
}
