"use client";

import { createContext, useContext, ReactNode, useState, useEffect, useMemo, useCallback } from "react";

// Types
interface IntelligenceContextType {
    translate: (text: string) => string;
    isTranslating: boolean;
    locale: string;
    summarize: (events: unknown[]) => Promise<string>;
}

const IntelligenceContext = createContext<IntelligenceContextType | undefined>(undefined);

export function useProjectIntelligence() {
    const context = useContext(IntelligenceContext);
    if (!context) {
        throw new Error("useProjectIntelligence must be used within a ProjectIntelligenceProvider");
    }
    return context;
}

interface ProjectIntelligenceProviderProps {
    children: ReactNode;
    enableTranslation?: boolean; // Managed by user settings eventually
}

export function ProjectIntelligenceProvider({ children, enableTranslation = false }: ProjectIntelligenceProviderProps) {
    const [locale, setLocale] = useState('en');
    const isTranslating = false;

    // Mock detection of browser locale
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const browserLocale = navigator.language.split('-')[0];
            setLocale(browserLocale);
        }
    }, []);

    // Intelligent Translation Mock
    // In production, this would call an Edge Function with caching
    const translate = useCallback((text: string) => {
        if (!enableTranslation || locale === 'en') return text;
        // Stub: Append [Translated] to show it works
        return `[${locale.toUpperCase()}] ${text}`;
    }, [enableTranslation, locale]);

    const summarize = useCallback(async (events: unknown[]) => {
        void events;
        // Stub: AI Summary
        return "Project activity is healthy. Team has completed 5 tasks this week.";
    }, []);

    const contextValue = useMemo(() => ({
        translate,
        isTranslating,
        locale,
        summarize
    }), [locale, isTranslating, summarize, translate]);

    return (
        <IntelligenceContext.Provider value={contextValue}>
            {children}
        </IntelligenceContext.Provider>
    );
}
