import { useState, useEffect } from 'react';
import { getDatabase, ProjectDoc } from '@/lib/rxdb';
import { replicateSupabase } from '@/lib/rxdb/replication';
import { createClient } from '@/lib/supabase/client';
import { CreateProjectInput } from '@/lib/validations/project';
import { RxDocument } from 'rxdb';

export function useLocalProjects() {
    const [projects, setProjects] = useState<ProjectDoc[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let sub: any;

        const init = async () => {
            const db = await getDatabase();

            // 1. Initial Load from Local DB (Instant)
            const initialDocs = await db.projects.find().sort({ created_at: 'desc' }).exec();
            setProjects(initialDocs.map(d => d.toJSON()));
            setLoading(false);

            // 2. Subscribe to local changes
            sub = db.projects.find().sort({ created_at: 'desc' }).$.subscribe(docs => {
                setProjects(docs.map(d => d.toJSON()));
            });

            // 3. Start Sync (Background)
            // In a real app, replication should be a singleton service, not inside hook
            // But for demo/MVP this ensures it runs when component mounts
            replicateSupabase(db.projects);
        };

        init();

        return () => {
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
                solution_overview: input.solution_overview,
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
                solution_overview: input.solution_overview,
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

        const init = async () => {
            const db = await getDatabase();
            if (!db) return;

            const query = db.projects.findOne(projectId);

            sub = query.$.subscribe(doc => {
                if (doc) {
                    setProject(doc.toJSON());
                    setLoading(false);
                } else {
                    setLoading(false);
                }
            });
        };

        init();

        return () => {
            if (sub) sub.unsubscribe();
        };
    }, [projectId]);

    return { project, loading };
};
