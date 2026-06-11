'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, useEffect, type ReactNode } from 'react'
import { QUERY_DEFAULTS } from '@/lib/query-defaults'

interface QueryProviderProps {
    children: ReactNode
}

export function QueryProvider({ children }: QueryProviderProps) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: QUERY_DEFAULTS.staleTime,
                        gcTime: QUERY_DEFAULTS.gcTime,
                        retry: QUERY_DEFAULTS.retry,
                        refetchOnWindowFocus: QUERY_DEFAULTS.refetchOnWindowFocus,
                    },
                    mutations: {
                        retry: 1,
                    },
                },
            })
    )

    useEffect(() => {
        const handleSignOut = () => {
            queryClient.clear();
        };
        window.addEventListener('auth:signout', handleSignOut);
        return () => window.removeEventListener('auth:signout', handleSignOut);
    }, [queryClient]);

    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    )
}
