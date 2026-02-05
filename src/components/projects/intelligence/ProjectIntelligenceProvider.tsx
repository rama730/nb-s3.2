"use client";

import { createContext, useContext, ReactNode, useState, useEffect, useMemo } from "react";

// Types
interface IntelligenceContextType {
    translate: (text: string) => string;
    isTranslating: boolean;
    locale: string;
    summarize: (events: any[]) => Promise<string>;
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
    const [isTranslating, setIsTranslating] = useState(false);

    // Mock detection of browser locale
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const browserLocale = navigator.language.split('-')[0];
            setLocale(browserLocale);
        }
    }, []);

    // Intelligent Translation Mock
    // In production, this would call an Edge Function with caching
    const translate = (text: string) => {
        if (!enableTranslation || locale === 'en') return text;
        // Stub: Append [Translated] to show it works
        return `[${locale.toUpperCase()}] ${text}`;
    };

    const summarize = async (events: any[]) => {
        // Stub: AI Summary
        return "Project activity is healthy. Team has completed 5 tasks this week.";
    };

    const contextValue = useContextMemo(() => ({
        translate,
        isTranslating,
        locale,
        summarize
    }), [locale, isTranslating, enableTranslation]);

    return (
        <IntelligenceContext.Provider value={contextValue}>
            {children}
        </IntelligenceContext.Provider>
    );
}

// Helper for cleaner memoization in providers
function useContextMemo<T>(factory: () => T, deps: any[]): T {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(factory, deps);
}
