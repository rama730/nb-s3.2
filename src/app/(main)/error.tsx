'use client'

import { AlertTriangle, RefreshCw } from 'lucide-react'

export default function MainError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    return (
        <div className="min-h-[400px] flex items-center justify-center">
            <div className="text-center p-8 max-w-md">
                <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">
                    Something went wrong
                </h2>
                <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
                    {error.message || 'An unexpected error occurred. Please try again.'}
                </p>
                <button
                    onClick={reset}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                >
                    <RefreshCw className="w-4 h-4" />
                    Try again
                </button>
            </div>
        </div>
    )
}
