import { useState, useEffect } from 'react';
import { getDatabase, ProjectDoc } from '@/lib/rxdb';
import { replicateSupabase } from '@/lib/rxdb/replication';
import { createClient } from '@/lib/supabase/client';
import { CreateProjectInput } from '@/lib/validations/project';
import { RxDocument } from 'rxdb';

let singletonReplication: { cancel: () => Promise<void> } | null = null;
let singletonDbPromise: ReturnType<typeof getDatabase> | null = null;

function getSingletonDb() {
    if (!singletonDbPromise) {
        singletonDbPromise = getDatabase();
    }
    return singletonDbPromise;
}

export function useLocalProjects() {
    const [projects, setProjects] = useState<ProjectDoc[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let sub: any;
        let isActive = true;

        const init = async () => {
            const db = await getSingletonDb();
            if (!isActive) return;

            const initialDocs = await db.projects.find().sort({ created_at: 'desc' }).exec();
            if (!isActive) return;
            setProjects(initialDocs.map(d => d.toJSON()));
            setLoading(false);

            sub = db.projects.find().sort({ created_at: 'desc' }).$.subscribe(docs => {
                if (!isActive) return;
                setProjects(docs.map(d => d.toJSON()));
            });

            if (!singletonReplication) {
                const replicationState = await replicateSupabase(db.projects);
                if (!isActive) {
                    void replicationState.cancel();
                    return;
                }
                singletonReplication = replicationState;
            }
        };

        void init();

        return () => {
            isActive = false;
            if (sub) sub.unsubscribe();
        };
    }, []);

    // Create function (Mutation)
    // Create function (Mutation)
    const addProject = async (input: CreateProjectInput & { slug: string, project_id: string }) => {
        const db = await getDatabase();

        // Get current user for owner_id
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) throw new Error('User not authenticated');

        const id = crypto.randomUUID();

        // 1. Write to Supabase (Source of Truth for Hub)
        const { error } = await supabase.from('projects').insert({
            id,
            title: input.title,
            description: input.description,
            short_description: input.short_description,
            status: input.status || 'draft',
            visibility: input.visibility || 'public',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            owner_id: user.id,
            json_data: {
                slug: input.slug,
                project_id: input.project_id,
                tags: input.tags,
                skills: input.technologies_used,
                category: input.project_type,
                problem_statement: input.problem_statement,
                solution_statement: input.solution_statement,
                target_audience: input.target_audience,
                goals: input.goals,
                external_links: input.external_links
            }
        });

        if (error) throw error;

        // 2. Write to Local RxDB (Optimistic / Zero-Latency for Detail View)
        await db.projects.insert({
            id, // Use UUID for primary key
            title: input.title,
            description: input.description,
            short_description: input.short_description,
            status: input.status || 'draft',
            visibility: input.visibility || 'public',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            owner_id: user.id,
            json_data: {
                slug: input.slug,
                project_id: input.project_id, // Friendly ID
                tags: input.tags,
                skills: input.technologies_used,
                category: input.project_type,
                // Store other wizard fields
                problem_statement: input.problem_statement,
                solution_statement: input.solution_statement,
                target_audience: input.target_audience,
                goals: input.goals,
                external_links: input.external_links
            }
        });

        return id;
    };

    return { projects, loading, addProject };
}

export const useLocalProject = (projectId: string) => {
    const [project, setProject] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let sub: any = null;
        let isActive = true;

        const init = async () => {
            const db = await getDatabase();
            if (!db || !isActive) return;

            const query = db.projects.findOne(projectId);

            sub = query.$.subscribe(doc => {
                if (!isActive) return;
                if (doc) {
                    setProject(doc.toJSON());
                    setLoading(false);
                } else {
                    setLoading(false);
                }
            });
        };

        void init();

        return () => {
            isActive = false;
            if (sub) sub.unsubscribe();
        };
    }, [projectId]);

    return { project, loading };
};
