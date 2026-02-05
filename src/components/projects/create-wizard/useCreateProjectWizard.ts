'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createProjectSchema, type CreateProjectInput, type OpenRoleInput } from '@/lib/validations/project';
import { generateSlug, generateProjectId } from '@/lib/utils/project-ids';
import { toast } from 'sonner';
import { TOTAL_PHASES, WizardPhaseId } from '@/constants/project-wizard';
import { createProjectAction } from '@/app/actions/project';

export interface WizardContextType {
    openRoles: OpenRoleInput[];
    setOpenRoles: (roles: OpenRoleInput[]) => void;
    addRole: () => void;
    updateRole: (index: number, updates: Partial<OpenRoleInput>) => void;
    removeRole: (index: number) => void;
}

interface UseCreateProjectWizardProps {
    onClose: () => void;
    onSuccess?: (projectId: string) => void;
    draftId?: string;
}

/**
 * useCreateProjectWizard - The master hook for project creation.
 * Pure Optimization: Unified constants, reactive draft management, and scalable logic.
 */
export function useCreateProjectWizard({ onClose, onSuccess, draftId }: UseCreateProjectWizardProps) {
    const supabase = createClient();
    const [phase, setPhase] = useState<WizardPhaseId>(1);
    const [openRoles, setOpenRoles] = useState<OpenRoleInput[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSavingDraft, setIsSavingDraft] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [showExitConfirm, setShowExitConfirm] = useState(false);
    const [draftInfo, setDraftInfo] = useState<{
        exists: boolean;
        phase: number;
        savedAt: Date | null;
    } | null>(null);

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
            goals: [],
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
            import_source: { type: 'scratch' },
            metadata: {},
        },
    });

    const { getValues, trigger, formState: { isDirty }, watch, reset } = methods;

    // --- Draft Management ---

    // Check for existing draft on mount
    useEffect(() => {
        const checkDraft = async () => {
            const { draftStore } = await import('@/lib/storage/draft-store');
            const info = await draftStore.getInfo();
            if (info.exists) {
                setDraftInfo({
                    exists: true,
                    phase: info.phase,
                    savedAt: info.savedAt,
                });
            }
        };
        checkDraft();
    }, []);

    const restoreDraft = useCallback(async () => {
        const { draftStore } = await import('@/lib/storage/draft-store');
        const draft = await draftStore.load();
        if (draft) {
            reset(draft);
            if (draft._timestamp) setLastSaved(new Date(draft._timestamp));
            if (draft._phase) setPhase(draft._phase as WizardPhaseId);
            setDraftInfo(null);
            toast.success("Draft restored");
        }
    }, [reset]);

    const deleteDraft = useCallback(async () => {
        const { draftStore } = await import('@/lib/storage/draft-store');

        // 1. Server-side deep wipe (if draftId exists)
        if (draftId) {
            try {
                const { deleteProjectDraftAction } = await import('@/app/actions/project');
                await deleteProjectDraftAction(draftId);
            } catch (err) {
                console.error("Server draft wipe failed", err);
            }
        }

        // 2. Client-side total wipe
        await draftStore.clear();
        setDraftInfo(null);
        reset();
        setPhase(1);
        toast.success("Draft erased completely");
    }, [draftId, reset]);

    const saveDraft = useCallback(async (silent = false) => {
        const { draftStore } = await import('@/lib/storage/draft-store');
        await draftStore.save(getValues(), phase);
        setLastSaved(new Date());

        if (silent) return;

        setIsSavingDraft(true);
        setSaveStatus('saving');
        // Pure Optimization: Minimal visual delay for confidence
        await new Promise(r => setTimeout(r, 400));
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
        setIsSavingDraft(false);
    }, [getValues, phase]);

    // Auto-Save Optimization (Debounced subscription)
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    useEffect(() => {
        const subscription = watch((_, { type }) => {
            if (!isDirty || type === undefined) return;

            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = setTimeout(() => saveDraft(true), 5000);
        });
        return () => {
            subscription.unsubscribe();
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        };
    }, [isDirty, watch, saveDraft]);

    // --- Role Management ---
    const addRole = useCallback(() => {
        setOpenRoles(prev => [{
            role: '',
            count: 1,
            description: '',
            skills: [],
            experience_level: 'any',
            compensation_type: 'unpaid',
            compensation_details: '',
        }, ...prev]);
    }, []);

    const updateRole = useCallback((index: number, updates: Partial<OpenRoleInput>) => {
        setOpenRoles(prev => prev.map((r, i) => i === index ? { ...r, ...updates } : r));
    }, []);

    const removeRole = useCallback((index: number) => {
        setOpenRoles(prev => prev.filter((_, i) => i !== index));
    }, []);

    const wizardContext: WizardContextType = useMemo(() => ({
        openRoles, setOpenRoles, addRole, updateRole, removeRole
    }), [openRoles, addRole, updateRole, removeRole]);

    // --- Navigation ---
    const handleNext = useCallback(async () => {
        let isValid = false;
        if (phase === 1) isValid = true;
        else if (phase === 2) isValid = await trigger('project_type');
        else if (phase === 3) isValid = await trigger(['title', 'description']);
        else if (phase === 4) isValid = true;
        else if (phase === 5) isValid = true;

        if (isValid && phase < TOTAL_PHASES) {
            setPhase(prev => (prev + 1) as WizardPhaseId);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, [phase, trigger]);

    const handleBack = useCallback(() => {
        if (phase > 1) {
            setPhase(prev => (prev - 1) as WizardPhaseId);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, [phase]);

    const goToPhase = useCallback((target: WizardPhaseId) => {
        setPhase(target);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const handleCloseAttempt = useCallback(() => {
        if (isDirty || phase > 1) setShowExitConfirm(true);
        else onClose();
    }, [isDirty, phase, onClose]);

    // --- Submission ---
    const onSubmit = useCallback(async (data: CreateProjectInput) => {
        if (phase !== TOTAL_PHASES) return;

        setIsSubmitting(true);
        try {
            const result = await createProjectAction({
                ...data,
                slug: generateSlug(data.title.trim()),
                project_id: generateProjectId(data.title.trim()),
            });

            if (!result.success || !result.project) throw new Error(result.error || 'Creation failed');

            toast.success('Project created successfully!');
            const { draftStore } = await import('@/lib/storage/draft-store');
            await draftStore.clear();
            onSuccess?.(result.project.id);
            onClose();
        } catch (error: any) {
            toast.error(error.message || 'Failed to create project');
        } finally {
            setIsSubmitting(false);
        }
    }, [onSuccess, onClose, phase]);

    return {
        phase, methods, wizardContext, isSubmitting, isSavingDraft,
        saveStatus, lastSaved, showExitConfirm, setShowExitConfirm,
        handleNext, handleBack, goToPhase, saveDraft, handleCloseAttempt,
        onSubmit, draftInfo, restoreDraft, deleteDraft
    };
}
