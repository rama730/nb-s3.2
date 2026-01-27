'use client'

import { useAuthContext } from '@/components/providers/AuthProvider'

// Re-export the hook that consumes the context
export function useAuth() {
    return useAuthContext()
}
