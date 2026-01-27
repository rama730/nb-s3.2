'use client';

import { useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createProjectSchema, type CreateProjectInput, type OpenRoleInput } from '@/lib/validations/project';
import { generateSlug, generateProjectId } from '@/lib/utils/project-ids';
import { toast } from 'sonner';
import { createProjectAction } from '@/app/actions/project';

export interface WizardContextType {
    openRoles: OpenRoleInput[];
    setOpenRoles: (roles: OpenRoleInput[]) => void;
    addRole: () => void;
    updateRole: (index: number, role: Partial<OpenRoleInput>) => void;
    removeRole: (index: number) => void;
}

interface UseCreateProjectWizardProps {
    onClose: () => void;
    onSuccess?: (projectId: string) => void;
    draftId?: string;
}

export function useCreateProjectWizard({ onClose, onSuccess, draftId }: UseCreateProjectWizardProps) {
    const supabase = createClient();
    const [phase, setPhase] = useState<1 | 2 | 3 | 4 | 5>(1);
    const [openRoles, setOpenRoles] = useState<OpenRoleInput[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSavingDraft, setIsSavingDraft] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [showExitConfirm, setShowExitConfirm] = useState(false);

    // Form Setup
    const methods = useForm<CreateProjectInput>({
        resolver: zodResolver(createProjectSchema) as any,
        mode: 'onChange',
        defaultValues: {
            title: '',
            description: '',
            short_description: '',
            project_type: '',
            custom_project_type: '',
            status: 'open',
            visibility: 'public',
            tags: [],
            technologies_used: [],
            lifecycle_stages: [],
            current_stage_index: 0,
            problem_statement: '',
            solution_overview: '',
            target_audience: '',
            expected_start_date: '',
            expected_end_date: '',
            goals: [],
            creator_role: null,
            team_settings: null,
            application_settings: {
                allow_applications: true,
                require_portfolio: false,
                custom_questions: [],
                auto_decline_days: 30,
            },
            terms: {
                ip_agreement: 'discuss',
                license: '',
                nda_required: 'none',
                portfolio_showcase_allowed: true,
                additional_terms: '',
            },
            external_links: {
                discord: '',
                github: '',
                website: '',
                figma: '',
                slack: '',
                notion: '',
            },
            notification_preferences: {
                on_application: true,
                on_task_complete: true,
                on_chat_message: true,
                daily_digest: false,
            },
            is_draft: false,
            metadata: {},
        },
    });

    const { getValues, trigger, formState: { isDirty } } = methods;

    // Save Draft Function
    const saveDraft = useCallback(async (silent = false) => {
        if (!isDirty && !draftId) return;

        if (!silent) {
            setIsSavingDraft(true);
            setSaveStatus('saving');
        }

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                if (!silent) {
                    toast.error('You must be logged in');
                    setSaveStatus('error');
                }
                return;
            }

            // For now, just show success - drafts table can be added later
            setLastSaved(new Date());
            if (!silent) setSaveStatus('saved');

            if (!silent) {
                setTimeout(() => setSaveStatus('idle'), 2000);
            }
        } catch (error) {
            if (!silent) {
                console.error('Error saving draft', error);
                toast.error('Failed to save draft');
                setSaveStatus('error');
            }
        } finally {
            if (!silent) setIsSavingDraft(false);
        }
    }, [supabase, draftId, isDirty]);

    // Role Management
    const addRole = useCallback(() => {
        setOpenRoles((prev) => [
            {
                role: '',
                count: 1,
                description: '',
                skills: [],
                experience_level: 'any',
                compensation_type: 'unpaid',
                compensation_details: '',
            },
            ...prev,
        ]);
    }, []);

    const updateRole = useCallback((index: number, updates: Partial<OpenRoleInput>) => {
        setOpenRoles((prev) =>
            prev.map((role, i) => (i === index ? { ...role, ...updates } : role))
        );
    }, []);

    const removeRole = useCallback((index: number) => {
        setOpenRoles((prev) => prev.filter((_, i) => i !== index));
    }, []);

    // Wizard Navigation
    const handleNext = useCallback(async () => {
        let isValid = false;

        if (phase === 1) {
            isValid = await trigger('project_type');
        } else if (phase === 2) {
            isValid = await trigger(['title', 'description']);
        } else if (phase === 3) {
            // Skip validation for optional creator role
            isValid = true;
        } else {
            isValid = true;
        }

        if (isValid && phase < 5) {
            setPhase((prev) => (prev + 1) as 1 | 2 | 3 | 4 | 5);
        }
    }, [phase, trigger]);

    const handleBack = useCallback(() => {
        if (phase > 1) {
            setPhase((prev) => (prev - 1) as 1 | 2 | 3 | 4 | 5);
        }
    }, [phase]);

    const goToPhase = useCallback((p: 1 | 2 | 3 | 4 | 5) => {
        setPhase(p);
    }, []);

    // Submission
    const onSubmit = useCallback(
        async (data: CreateProjectInput) => {
            if (phase !== 5) return;

            setIsSubmitting(true);
            try {
                // Generate slugs/IDs for optimistic readiness, but let Server Action handle creation
                const trimmedTitle = data.title.trim();
                const baseSlug = generateSlug(trimmedTitle);
                const baseProjectId = generateProjectId(trimmedTitle);

                const result = await createProjectAction({
                    ...data,
                    slug: baseSlug,
                    project_id: baseProjectId,
                });

                if (!result.success || !result.project) {
                    throw new Error(result.error || 'Failed to create project');
                }

                toast.success('Project created successfully!');
                onSuccess?.(result.project.id);
                onClose();
            } catch (error: any) {
                console.error('Error creating project', error);
                toast.error(error.message || 'Failed to create project');
            } finally {
                setIsSubmitting(false);
            }
        },
        [onSuccess, onClose, phase]
    );

    // Close Handler
    const handleCloseAttempt = useCallback(() => {
        if (isDirty || phase > 1) {
            setShowExitConfirm(true);
        } else {
            onClose();
        }
    }, [isDirty, phase, onClose]);

    const wizardContext: WizardContextType = useMemo(
        () => ({
            openRoles,
            setOpenRoles,
            addRole,
            updateRole,
            removeRole,
        }),
        [openRoles, addRole, updateRole, removeRole]
    );

    return {
        phase,
        methods,
        wizardContext,
        isSubmitting,
        isSavingDraft,
        saveStatus,
        lastSaved,
        showExitConfirm,
        setShowExitConfirm,
        handleNext,
        handleBack,
        goToPhase,
        saveDraft,
        handleCloseAttempt,
        onSubmit,
    };
}
