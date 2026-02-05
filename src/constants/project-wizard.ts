/**
 * Constants for the project creation wizard.
 * Pure optimization: Single source of truth for phases and labels.
 */

export const WIZARD_PHASES = [
    { id: 1, label: 'Start', description: 'Source Selection' },
    { id: 2, label: 'Type', description: 'Project Category' },
    { id: 3, label: 'Info', description: 'Basic Information' },
    { id: 4, label: 'Team', description: 'Roles & Skills' },
    { id: 5, label: 'Settings', description: 'Privacy & Terms' },
    { id: 6, label: 'Review', description: 'Final Preview' },
] as const;

export type WizardPhaseId = typeof WIZARD_PHASES[number]['id'];

export const TOTAL_PHASES = WIZARD_PHASES.length;

export const PHASE_LABELS = WIZARD_PHASES.reduce((acc, phase) => ({
    ...acc,
    [phase.id]: phase.label
}), {} as Record<number, string>);
