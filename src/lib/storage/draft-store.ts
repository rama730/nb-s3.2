'use client';

import { get, set, del } from 'idb-keyval';
import { CreateProjectInput } from '@/lib/validations/project';

const DRAFT_KEY = 'project_wizard_draft';
const EXPIRY_DAYS = 3;  // Draft expires after 3 days

export interface WizardDraft extends Partial<CreateProjectInput> {
    _timestamp: number;
    _phase: number;
}

export interface DraftInfo {
    exists: boolean;
    phase: number;
    savedAt: Date | null;
    isExpired: boolean;
}

/**
 * IndexedDB-backed draft storage with expiration.
 */
export const draftStore = {
    /**
     * Save draft to IndexedDB
     */
    async save(data: Partial<CreateProjectInput>, phase: number): Promise<void> {
        const draft: WizardDraft = {
            ...data,
            _timestamp: Date.now(),
            _phase: phase,
        };

        try {
            await set(DRAFT_KEY, draft);
        } catch {
            try {
                localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
            } catch { /* Silent */ }
        }
    },

    /**
     * Load draft (returns null if expired or not found)
     */
    async load(): Promise<WizardDraft | null> {
        const draft = await this._getRaw();
        if (!draft) return null;

        // Check expiration (3 days)
        const ageMs = Date.now() - draft._timestamp;
        const expiryMs = EXPIRY_DAYS * 24 * 60 * 60 * 1000;

        if (ageMs > expiryMs) {
            // Auto-clear expired draft
            await this.clear();
            return null;
        }

        return draft;
    },

    /**
     * Get draft info without loading full data (for UI display)
     */
    async getInfo(): Promise<DraftInfo> {
        const draft = await this._getRaw();

        if (!draft) {
            return { exists: false, phase: 1, savedAt: null, isExpired: false };
        }

        const ageMs = Date.now() - draft._timestamp;
        const expiryMs = EXPIRY_DAYS * 24 * 60 * 60 * 1000;
        const isExpired = ageMs > expiryMs;

        if (isExpired) {
            await this.clear();
            return { exists: false, phase: 1, savedAt: null, isExpired: true };
        }

        return {
            exists: true,
            phase: draft._phase || 1,
            savedAt: new Date(draft._timestamp),
            isExpired: false,
        };
    },

    /**
     * Clear draft
     */
    async clear(): Promise<void> {
        try { await del(DRAFT_KEY); } catch { /* Silent */ }
        try { localStorage.removeItem(DRAFT_KEY); } catch { /* Silent */ }
    },

    /**
     * Internal: Get raw draft without expiry check
     */
    async _getRaw(): Promise<WizardDraft | null> {
        try {
            const draft = await get<WizardDraft>(DRAFT_KEY);
            if (draft) return draft;
        } catch { /* IndexedDB failed */ }

        try {
            const stored = localStorage.getItem(DRAFT_KEY);
            if (stored) return JSON.parse(stored) as WizardDraft;
        } catch { /* Parse failed */ }

        return null;
    },
};
