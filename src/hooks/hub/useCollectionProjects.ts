'use client';

import { useState, useEffect } from 'react';

export function useCollectionProjects(collectionId: string | null) {
    const [projectIds, setProjectIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!collectionId) {
            setProjectIds(new Set());
            return;
        }

        // Load collection from localStorage (simple implementation)
        try {
            const stored = localStorage.getItem(`collection-${collectionId}`);
            if (stored) {
                const data = JSON.parse(stored);
                setProjectIds(new Set(data.project_ids || []));
            }
        } catch {
            setProjectIds(new Set());
        }
    }, [collectionId]);

    return { projectIds };
}
