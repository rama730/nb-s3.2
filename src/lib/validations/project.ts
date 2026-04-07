import { z } from 'zod';
import { isValidGithubBranchName, normalizeGithubRepoUrl } from '@/lib/github/repo-validation';

// Open Role Schema
export const openRoleSchema = z.object({
    role: z.string().min(1, 'Role is required'),
    count: z.number().min(1).default(1),
    description: z.string().optional(),
    skills: z.array(z.string()).default([]),
    experience_level: z.enum(['any', 'junior', 'mid', 'senior']).default('any'),
    compensation_type: z.enum(['unpaid', 'equity', 'paid', 'rev_share']).default('unpaid'),
    compensation_details: z.string().optional(),
});

export type OpenRoleInput = z.infer<typeof openRoleSchema>;

// Creator Role Schema
export const creatorRoleSchema = z.object({
    // Keep legacy enum values for backward-compat drafts; wizard now always sets `lead`.
    role_type: z.enum(['founder', 'lead', 'contributor', 'advisor']).default('lead'),
    // Optional lead focus (e.g. Frontend, Product, AI).
    title: z.string().max(80).optional(),
    time_commitment: z.number().min(0).max(168).optional(), // hours per week
});

export type CreatorRoleInput = z.infer<typeof creatorRoleSchema>;

// Application Settings
export const applicationSettingsSchema = z.object({
    allow_applications: z.boolean().default(true),
    require_portfolio: z.boolean().default(false),
    custom_questions: z.array(z.string()).default([]),
    auto_decline_days: z.number().min(1).max(90).default(30),
});

// Terms Schema
export const termsSchema = z.object({
    ip_agreement: z.enum(['discuss', 'company_owned', 'contributor_owned', 'shared']).default('discuss'),
    license: z.string().optional(),
    nda_required: z.enum(['none', 'mutual', 'one_way']).default('none'),
    portfolio_showcase_allowed: z.boolean().default(true),
    additional_terms: z.string().optional(),
});

// External Links Schema
export const externalLinksSchema = z.object({
    discord: z.string().url().optional().or(z.literal('')),
    github: z.string().url().optional().or(z.literal('')),
    website: z.string().url().optional().or(z.literal('')),
    figma: z.string().url().optional().or(z.literal('')),
    slack: z.string().url().optional().or(z.literal('')),
    notion: z.string().url().optional().or(z.literal('')),
});

// Notification Preferences
export const notificationPreferencesSchema = z.object({
    on_application: z.boolean().default(true),
    on_task_complete: z.boolean().default(true),
    on_chat_message: z.boolean().default(true),
    daily_digest: z.boolean().default(false),
});

// Main Project Schema
export const createProjectSchema = z.object({
    title: z.string().trim().min(3, 'Title must be at least 3 characters').max(100, 'Title must be less than 100 characters'),
    description: z.string().trim().min(20, 'Description must be at least 20 characters').max(5000).optional(),
    short_description: z.string().trim().max(200).optional(),
    project_type: z.string().min(1, 'Project type is required'),
    custom_project_type: z.string().optional(),
    status: z.enum(['draft', 'open', 'active', 'completed', 'archived']).default('open'),
    visibility: z.enum(['public', 'private', 'unlisted']).default('public'),
    tags: z.array(z.string()).default([]),
    technologies_used: z.array(z.string()).default([]),
    lifecycle_stages: z.array(z.string()).default([]),
    current_stage_index: z.number().default(0),
    problem_statement: z.string().optional(),
    solution_statement: z.string().optional(),
    target_audience: z.string().optional(),
    expected_start_date: z.string().optional(),
    expected_end_date: z.string().optional(),
    goals: z.array(z.string()).default([]),
    creator_role: creatorRoleSchema.nullable().optional(),
    roles: z.array(openRoleSchema).optional(),
    team_settings: z.any().nullable().optional(),
    application_settings: applicationSettingsSchema.optional(),
    terms: termsSchema.optional(),
    external_links: externalLinksSchema.optional(),
    notification_preferences: notificationPreferencesSchema.optional(),
    is_draft: z.boolean().default(false),
    metadata: z.record(z.string(), z.any()).default({}),
    import_source: z.object({
        type: z.enum(['github', 'upload', 'scratch']),
        repoUrl: z.string().optional(),
        branch: z.string().optional(),
        s3Key: z.string().optional(),
        metadata: z.record(z.string(), z.any()).optional(),
    }).optional(),
}).superRefine((val, ctx) => {
    const src = val.import_source;
    if (!src) return;

    if (src.type === 'github') {
        const normalized = normalizeGithubRepoUrl(src.repoUrl || '');
        if (!normalized) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['import_source', 'repoUrl'],
                message: 'Enter a valid GitHub repository URL (https://github.com/owner/repo).',
            });
        }

        if (src.branch && !isValidGithubBranchName(src.branch)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['import_source', 'branch'],
                message: 'Branch name is invalid.',
            });
        }
    }
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
